import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import {
  applyAdminCommand,
  castVote,
  registerGuest,
  submitMessage,
  submitQuizAnswer,
  type EventState,
  type Ids,
} from '@olu/event-core';
import type { AdminCommand } from '@olu/shared';
import { diff } from '../domain/changeset';
import { freshState } from '../testing/support';
import { ConcurrencyError, combinedRevision, type EventRepository } from './EventRepository';
import { DynamoEventRepository, createDocumentClient } from './dynamo/DynamoEventRepository';
import { FakeDynamoDb } from './dynamo/testing/FakeDynamoDb';
import { MemoryEventRepository } from './memory/MemoryEventRepository';

/*
 * One behavioral contract, three implementations. Set DYNAMODB_TEST_ENDPOINT
 * to also run it against a real DynamoDB engine; a throwaway table is created
 * and deleted:
 *   DynamoDB Local:  DYNAMODB_TEST_ENDPOINT=http://localhost:8000
 *   AWS (dev):       DYNAMODB_TEST_ENDPOINT=https://dynamodb.eu-central-1.amazonaws.com AWS_REGION=eu-central-1
 */

let counter = 0;
const ids: Ids = {
  guestId: () => `gst_${String(++counter).padStart(24, '0')}`,
  sessionToken: () => `hash_${counter}`,
  messageId: (guestId, clientMessageId) => `msg_${guestId}_${clientMessageId}`,
};

interface Target {
  name: string;
  create: () => Promise<EventRepository>;
  cleanup?: () => Promise<void>;
}

const targets: Target[] = [
  { name: 'memory', create: async () => new MemoryEventRepository() },
  { name: 'DynamoDB (strict fake)', create: async () => new DynamoEventRepository(new FakeDynamoDb(), 'olu-test') },
];

const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
if (endpoint) {
  const tableName = `olu-contract-${Date.now()}`;
  const region = process.env.AWS_REGION ?? 'eu-central-1';
  const raw = new DynamoDBClient({ region, endpoint });
  let created = false;
  targets.push({
    name: `DynamoDB at ${endpoint}`,
    create: async () => {
      if (!created) {
        await raw.send(
          new CreateTableCommand({
            TableName: tableName,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [
              { AttributeName: 'pk', AttributeType: 'S' },
              { AttributeName: 'sk', AttributeType: 'S' },
            ],
            KeySchema: [
              { AttributeName: 'pk', KeyType: 'HASH' },
              { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
          }),
        );
        created = true;
        // AWS creates tables asynchronously; DynamoDB Local is immediate.
        await waitUntilTableExists({ client: raw, maxWaitTime: 120 }, { TableName: tableName });
      }
      return new DynamoEventRepository(createDocumentClient({ region, endpoint }), tableName);
    },
    cleanup: async () => {
      if (created) await raw.send(new DeleteTableCommand({ TableName: tableName }));
    },
  });
}

describe.each(targets)('event repository: $name', (target) => {
  let repo: EventRepository;
  let eventId: string;

  beforeAll(async () => {
    repo = await target.create();
  });
  afterAll(async () => {
    await target.cleanup?.();
  });
  beforeEach(() => {
    eventId = `evt-${++counter}`;
  });

  /** Applies a rule to the stored state and commits the diff, like the service does. */
  async function step(rule: (draft: EventState) => void, expectedVersion?: number) {
    const snapshot = await repo.load(eventId);
    if (!snapshot) throw new Error('missing event');
    const draft = structuredClone(snapshot.state);
    rule(draft);
    await repo.commit(eventId, expectedVersion ?? snapshot.stateVersion, diff(snapshot.state, draft));
  }
  const command = (type: AdminCommand['type'], now = 1000) => step((s) => applyAdminCommand(s, { type } as AdminCommand, now));

  it('reports a missing event as null', async () => {
    expect(await repo.readRevision(eventId)).toBeNull();
    expect(await repo.load(eventId)).toBeNull();
  });

  it('creates an event once and never overwrites it', async () => {
    await repo.create(freshState(eventId));
    const loaded = await repo.load(eventId);
    expect(loaded?.state).toEqual({ ...freshState(eventId), revision: 1 });
    await command('START_VOTING');
    await repo.create(freshState(eventId));
    expect((await repo.load(eventId))?.state.phase).toBe('VOTING');
  });

  it('writes a control change only against the expected version', async () => {
    await repo.create(freshState(eventId));
    await command('START_VOTING');
    const info = await repo.readRevision(eventId);
    expect(info).toMatchObject({ stateVersion: 2, activityVersion: 0, settleAt: null });

    const snapshot = await repo.load(eventId);
    const draft = structuredClone(snapshot!.state);
    applyAdminCommand(draft, { type: 'CLOSE_VOTING' }, 1000);
    await expect(repo.commit(eventId, 1, diff(snapshot!.state, draft))).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await repo.load(eventId))?.state.voting.open).toBe(true);
  });

  it('stores guests, votes, answers and messages, bumping the activity version', async () => {
    await repo.create(freshState(eventId));
    let guestId = '';
    await step((s) => {
      guestId = registerGuest(s, { displayName: 'Mia' }, ids, 500).id;
    });
    await command('START_VOTING');
    await step((s) => castVote(s, s.guests[0]!, { choice: 'GIRL' }, 600));
    await command('START_QUIZ');
    await command('OPEN_QUESTION', 1000);
    await step((s) => submitQuizAnswer(s, s.guests[0]!, { questionId: 'q01', optionIndex: 2 }, 3000));

    const loaded = await repo.load(eventId);
    expect(loaded?.state.guests).toEqual([{ id: guestId, displayName: 'Mia', sessionToken: expect.any(String), joinedAt: 500 }]);
    expect(loaded?.state.voting.votes[guestId]).toEqual({ choice: 'GIRL', castAt: 600 });
    expect(loaded?.state.quiz.answers.q01?.[guestId]).toEqual({ optionIndex: 2, answeredAt: 3000 });
    expect(loaded?.activityVersion).toBe(3);
    const info = await repo.readRevision(eventId);
    expect(combinedRevision(info!)).toBe(loaded!.state.revision);
    expect(info?.settleAt).toBe(1000 + 20_000 + 1500);
  });

  it('rejects a second vote for the same guest', async () => {
    await repo.create(freshState(eventId));
    await step((s) => void registerGuest(s, { displayName: 'Mia' }, ids, 500));
    await command('START_VOTING');
    const snapshot = await repo.load(eventId);
    const first = structuredClone(snapshot!.state);
    castVote(first, first.guests[0]!, { choice: 'BOY' }, 600);
    const second = structuredClone(snapshot!.state);
    castVote(second, second.guests[0]!, { choice: 'GIRL' }, 601);
    // Two requests raced: both validated against the same snapshot.
    await repo.commit(eventId, snapshot!.stateVersion, diff(snapshot!.state, first));
    await expect(repo.commit(eventId, snapshot!.stateVersion, diff(snapshot!.state, second))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    expect(Object.values((await repo.load(eventId))!.state.voting.votes)).toEqual([{ choice: 'BOY', castAt: 600 }]);
  });

  it('applies a multi-item change all or nothing', async () => {
    await repo.create(freshState(eventId));
    await step((s) => void registerGuest(s, { displayName: 'Mia' }, ids, 500));
    await command('START_VOTING');
    const stale = await repo.load(eventId);
    await command('CLOSE_VOTING');
    const draft = structuredClone(stale!.state);
    castVote(draft, draft.guests[0]!, { choice: 'BOY' }, 700);
    applyAdminCommand(draft, { type: 'START_QUIZ' }, 700);
    await expect(repo.commit(eventId, stale!.stateVersion, diff(stale!.state, draft))).rejects.toBeInstanceOf(ConcurrencyError);
    const loaded = await repo.load(eventId);
    expect(loaded?.state.phase).toBe('VOTING');
    expect(loaded?.state.voting.votes).toEqual({});
  });

  it('moderates and deletes messages', async () => {
    await repo.create(freshState(eventId));
    const state = await repo.load(eventId);
    const draft = structuredClone(state!.state);
    Object.assign(draft, { phase: 'MESSAGES' });
    draft.messages.open = true;
    const guest = registerGuest(draft, { displayName: 'Mia' }, ids, 1);
    submitMessage(draft, guest, { clientMessageId: 'draft-0001', text: 'Hello little one' }, ids, 2);
    submitMessage(draft, guest, { clientMessageId: 'draft-0002', text: 'See you soon' }, ids, 3);
    await repo.commit(eventId, state!.stateVersion, diff(state!.state, draft));

    const [first, second] = (await repo.load(eventId))!.state.messages.items;
    await step((s) => applyAdminCommand(s, { type: 'SET_MESSAGE_APPROVAL', messageId: first!.id, approved: true }, 5));
    await step((s) => applyAdminCommand(s, { type: 'SET_MESSAGE_REMOVED', messageId: second!.id, removed: true }, 6));
    let items = (await repo.load(eventId))!.state.messages.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ text: 'Hello little one', approved: true, hidden: false, removed: false, order: 0 });
    expect(items[1]).toMatchObject({ text: 'See you soon', removed: true });

    await step((s) => applyAdminCommand(s, { type: 'SET_MESSAGE_REMOVED', messageId: second!.id, removed: false }, 7));
    items = (await repo.load(eventId))!.state.messages.items;
    expect(items[1]).toMatchObject({ text: 'See you soon', removed: false });
  });

  it('loads large events completely', async () => {
    await repo.create(freshState(eventId));
    await step((s) => {
      for (let i = 0; i < 25; i += 1) registerGuest(s, { displayName: `Guest ${i}` }, ids, 100 + i);
    });
    await command('START_VOTING');
    await step((s) => s.guests.forEach((g, i) => castVote(s, g, { choice: i % 2 ? 'BOY' : 'GIRL' }, 200)));
    const loaded = await repo.load(eventId);
    expect(loaded?.state.guests).toHaveLength(25);
    expect(Object.keys(loaded!.state.voting.votes)).toHaveLength(25);
  });

  it('expires host sessions', async () => {
    await repo.putAdminSession('hash-a', 10_000);
    expect(await repo.hasAdminSession('hash-a', 9_999)).toBe(true);
    expect(await repo.hasAdminSession('hash-a', 10_000)).toBe(false);
    expect(await repo.hasAdminSession('hash-unknown', 0)).toBe(false);
  });

  it('counts rate-limited attempts per window', async () => {
    const key = `signin:${eventId}`;
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await repo.consumeRateLimit(key, 60_000, 3, 120_000));
    expect(results).toEqual([true, true, true, false]);
    expect(await repo.consumeRateLimit(key, 60_000, 3, 180_000)).toBe(true); // next window
  });
});
