import { beforeEach, describe, expect, it } from 'vitest';
import { applyAdminCommand, castVote, registerGuest, type Ids } from '@olu/event-core';
import { diff } from '../../domain/changeset';
import { freshState } from '../../testing/support';
import { DynamoEventRepository } from './DynamoEventRepository';
import { FakeDynamoDb } from './testing/FakeDynamoDb';

/* Request-shape tests: what the repository actually sends to DynamoDB. */

const ids: Ids = { guestId: () => 'gst_000000000000000000000001', sessionToken: () => 'hashed', messageId: () => 'msg_1' };

describe('DynamoDB request shapes', () => {
  let fake: FakeDynamoDb;
  let repo: DynamoEventRepository;

  beforeEach(async () => {
    fake = new FakeDynamoDb();
    repo = new DynamoEventRepository(fake, 'olu-dev-events');
    await repo.create(freshState('party'));
  });

  async function commitStep(rule: Parameters<typeof applyAdminCommand>[0] extends infer S ? (s: S & object) => void : never) {
    const snapshot = await repo.load('party');
    const draft = structuredClone(snapshot!.state);
    rule(draft);
    fake.calls.length = 0;
    await repo.commit('party', snapshot!.stateVersion, diff(snapshot!.state, draft));
    return fake.calls.map((c) => c.operation);
  }

  it('records a vote with one conditional put, then bumps the counter (no transaction)', async () => {
    await commitStep((s) => void registerGuest(s, { displayName: 'Mia' }, ids, 1));
    await commitStep((s) => applyAdminCommand(s, { type: 'START_VOTING' }, 2));
    const ops = await commitStep((s) => void castVote(s, s.guests[0]!, { choice: 'BOY' }, 3));
    expect(ops).toEqual(['PutCommand', 'UpdateCommand']);
    const put = fake.calls[0]!.input as { Item: Record<string, unknown>; ConditionExpression: string };
    expect(put.Item).toMatchObject({ pk: 'EVENT#party', sk: 'VOTE#gst_000000000000000000000001', choice: 'BOY' });
    expect(put.ConditionExpression).toBe('attribute_not_exists(#pk)');
  });

  it('runs a host command as one versioned update', async () => {
    const ops = await commitStep((s) => applyAdminCommand(s, { type: 'START_VOTING' }, 2));
    expect(ops).toEqual(['UpdateCommand']);
    const update = fake.calls[0]!.input as { ConditionExpression: string; ExpressionAttributeValues: Record<string, unknown> };
    expect(update.ConditionExpression).toBe('#ver = :expected');
    expect(update.ExpressionAttributeValues[':expected']).toBe(1);
  });

  it('stores only the token hash it is given, under tokenHash', async () => {
    await commitStep((s) => void registerGuest(s, { displayName: 'Mia' }, ids, 1));
    const put = fake.calls[0]!.input as { Item: Record<string, unknown> };
    expect(put.Item).toMatchObject({ sk: 'GUEST#gst_000000000000000000000001', tokenHash: 'hashed' });
    expect(put.Item).not.toHaveProperty('sessionToken');
  });

  it('pages through large partitions', async () => {
    await commitStep((s) => {
      let n = 0;
      for (let i = 0; i < 20; i += 1) registerGuest(s, { displayName: `G${i}` }, { ...ids, guestId: () => `gst_${String(++n).padStart(24, '0')}` }, i);
    });
    fake.calls.length = 0;
    const loaded = await repo.load('party');
    expect(loaded?.state.guests).toHaveLength(20);
    expect(fake.calls.filter((c) => c.operation === 'QueryCommand').length).toBeGreaterThan(2);
  });

  it('reads the revision with two small, strongly consistent gets', async () => {
    fake.calls.length = 0;
    await repo.readRevision('party');
    expect(fake.calls.map((c) => c.operation)).toEqual(['GetCommand', 'GetCommand']);
    expect(fake.calls.every((c) => (c.input as { ConsistentRead: boolean }).ConsistentRead)).toBe(true);
  });
});
