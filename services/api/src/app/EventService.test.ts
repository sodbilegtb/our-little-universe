import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '@olu/event-core';
import type { AdminCommand, GuestSession } from '@olu/shared';
import type { EventRepository } from '../repositories/EventRepository';
import { DynamoEventRepository } from '../repositories/dynamo/DynamoEventRepository';
import { FakeDynamoDb } from '../repositories/dynamo/testing/FakeDynamoDb';
import { MemoryEventRepository } from '../repositories/memory/MemoryEventRepository';
import { hashPassword } from '../security/password';
import { serverIds, sha256 } from '../security/tokens';
import { testClock, testConfig } from '../testing/support';
import { AppError } from './errors';
import { EventService } from './EventService';

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('host password 123');
});

const backends: { name: string; create: () => EventRepository }[] = [
  { name: 'memory', create: () => new MemoryEventRepository() },
  { name: 'DynamoDB (strict fake)', create: () => new DynamoEventRepository(new FakeDynamoDb(), 'olu-test') },
];

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof DomainError || error instanceof AppError) return error.code;
    throw error;
  }
};

describe.each(backends)('event service on $name', ({ create }) => {
  let repository: EventRepository;
  let service: EventService;
  let clock: ReturnType<typeof testClock>;
  const command = (type: AdminCommand['type']) => service.adminCommand({ type } as AdminCommand);
  const cred = (s: GuestSession) => ({ guestId: s.guestId, sessionToken: s.sessionToken });

  beforeEach(() => {
    repository = create();
    clock = testClock();
    service = new EventService({
      config: testConfig({ ADMIN_PASSWORD_HASH: passwordHash, PUBLIC_APP_URL: 'https://party.example.com' }),
      repository,
      ids: serverIds,
      clock: () => clock.now,
    });
  });

  it('creates the event on first use with the example quiz', async () => {
    const tv = await service.tvView();
    expect(tv).toMatchObject({ phase: 'LOBBY', guestCount: 0, joinUrl: 'https://party.example.com/party' });
    expect((await service.adminView()).quiz.questions).toHaveLength(10);
  });

  it('registers guests, stores only a hash of their token, and restores them', async () => {
    const session = await service.registerGuest({ displayName: '  Aunt   Mia ' });
    expect(session.displayName).toBe('Aunt Mia');
    const stored = (await repository.load('test-event'))!.state.guests[0]!;
    expect(stored.sessionToken).toBe(sha256(session.sessionToken));
    expect(stored.sessionToken).not.toBe(session.sessionToken);
    expect((await service.guestView(cred(session))).me?.displayName).toBe('Aunt Mia');
    expect((await service.guestView({ guestId: session.guestId, sessionToken: 'x'.repeat(43) })).me).toBeNull();
    expect(await codeOf(service.castVote({ guestId: session.guestId, sessionToken: 'x'.repeat(43) }, { choice: 'BOY' }))).toBe(
      'UNAUTHORIZED',
    );
  });

  it('runs voting and a quiz round end to end', async () => {
    const mia = await service.registerGuest({ displayName: 'Mia' });
    const ben = await service.registerGuest({ displayName: 'Ben' });
    await command('START_VOTING');
    await service.castVote(cred(mia), { choice: 'GIRL' });
    await service.castVote(cred(mia), { choice: 'GIRL' }); // retry: harmless
    expect(await codeOf(service.castVote(cred(mia), { choice: 'BOY' }))).toBe('ALREADY_SUBMITTED');
    await command('CLOSE_VOTING');
    expect(await codeOf(service.castVote(cred(ben), { choice: 'BOY' }))).toBe('CLOSED');
    expect((await service.tvView()).voting.tally).toEqual({ boy: 0, girl: 1, total: 1 });

    await command('START_QUIZ');
    await command('OPEN_QUESTION');
    clock.tick(4000);
    await service.submitQuizAnswer(cred(mia), { questionId: 'q01', optionIndex: 0 });
    await service.submitQuizAnswer(cred(ben), { questionId: 'q01', optionIndex: 1 });
    expect((await service.guestView(cred(mia))).quiz.correctOptionIndex).toBeNull();
    await command('CLOSE_QUESTION');
    await command('REVEAL_ANSWER');
    const board = (await service.tvView()).leaderboard;
    expect(board.map((e) => [e.displayName, e.score])).toEqual([
      ['Mia', 100],
      ['Ben', 0],
    ]);
  });

  it('records every vote when many guests vote at the same moment', async () => {
    const guests = await Promise.all(Array.from({ length: 15 }, (_, i) => service.registerGuest({ displayName: `G${i}` })));
    await command('START_VOTING');
    await Promise.all(guests.map((g, i) => service.castVote(cred(g), { choice: i % 3 ? 'BOY' : 'GIRL' })));
    expect((await service.adminView()).voting.tally).toEqual({ boy: 10, girl: 5, total: 15 });
    expect((await service.adminView()).guestCount).toBe(15);
  });

  it('counts a double-tapped vote once', async () => {
    const mia = await service.registerGuest({ displayName: 'Mia' });
    await command('START_VOTING');
    const results = await Promise.all([codeOf(service.castVote(cred(mia), { choice: 'BOY' })), codeOf(service.castVote(cred(mia), { choice: 'BOY' }))]);
    expect(results).toEqual(['ok', 'ok']);
    expect((await service.tvView()).voting.tally.total).toBe(1);
  });

  it('lets only one of two simultaneous "next question" clicks through', async () => {
    await command('START_VOTING');
    await command('START_QUIZ');
    await command('OPEN_QUESTION');
    await command('CLOSE_QUESTION');
    await command('REVEAL_ANSWER');
    const results = await Promise.all([codeOf(command('NEXT_QUESTION')), codeOf(command('NEXT_QUESTION'))]);
    expect(results.sort()).toEqual(['WRONG_PHASE', 'ok']);
    expect((await service.adminView()).quiz.questionNumber).toBe(2);
  });

  it('keeps one message when a draft is sent twice at once', async () => {
    const mia = await service.registerGuest({ displayName: 'Mia' });
    await command('START_VOTING');
    await command('START_QUIZ');
    await command('OPEN_QUESTION');
    for (let i = 0; i < 9; i += 1) {
      await command('CLOSE_QUESTION');
      await command('REVEAL_ANSWER');
      await command('NEXT_QUESTION');
    }
    await command('CLOSE_QUESTION');
    await command('REVEAL_ANSWER');
    await command('FINISH_QUIZ');
    await command('START_MESSAGES');
    const draft = { clientMessageId: 'draft-000001', text: 'Hello little one' };
    await Promise.all([service.submitMessage(cred(mia), draft), service.submitMessage(cred(mia), draft)]);
    expect((await service.adminView()).messages.items).toHaveLength(1);
  });

  it('closes a timed-out question through the revision check alone', async () => {
    await command('START_VOTING');
    await command('START_QUIZ');
    await command('OPEN_QUESTION');
    const before = await service.revision();
    clock.tick(20_000 + 1_000);
    expect(await service.revision()).toBe(before); // inside the grace period
    clock.tick(1_000);
    expect(await service.revision()).toBeGreaterThan(before);
    expect((await service.tvView()).quiz.stage).toBe('QUESTION_CLOSED');
  });

  it('reuses the loaded event while nothing changes', async () => {
    await service.tvView();
    const load = vi.spyOn(repository, 'load');
    await service.tvView();
    await service.guestView(null);
    expect(load).not.toHaveBeenCalled();
    await command('START_VOTING');
    load.mockClear();
    await service.tvView();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never lets a half-visible write pass as the current view', async () => {
    // A DynamoDB query can see a guest's new activity counter before the vote
    // behind it. Here Ben votes while Mia's view is being loaded.
    const mia = await service.registerGuest({ displayName: 'Mia' });
    const ben = await service.registerGuest({ displayName: 'Ben' });
    await command('START_VOTING');
    const load = repository.load.bind(repository);
    vi.spyOn(repository, 'load').mockImplementationOnce(async (eventId) => {
      const read = (await load(eventId))!;
      await service.castVote(cred(ben), { choice: 'BOY' });
      return { ...read, activityVersion: read.activityVersion + 1 }; // the counter, but not the vote
    });
    const torn = await service.guestView(cred(mia));
    expect(torn.voting.myVote).toBeNull();
    const revision = await service.revision();
    expect(torn.revision).toBeLessThan(revision); // so every client fetches again
    expect((await service.guestView(cred(ben))).voting.myVote).toBe('BOY');
  });

  it('signs the host in, expires the session, and rate-limits guessing', async () => {
    expect(await codeOf(service.adminSignIn('wrong password', '10.0.0.1'))).toBe('UNAUTHORIZED');
    const { token } = await service.adminSignIn('host password 123', '10.0.0.1');
    await service.requireAdmin(token);
    expect(await codeOf(service.requireAdmin('x'.repeat(43)))).toBe('UNAUTHORIZED');
    expect(await codeOf(service.requireAdmin(null))).toBe('UNAUTHORIZED');
    clock.tick(12 * 60 * 60 * 1000 + 1);
    expect(await codeOf(service.requireAdmin(token))).toBe('UNAUTHORIZED');

    for (let i = 0; i < 10; i += 1) await codeOf(service.adminSignIn('wrong password', '10.0.0.2')); // 10 allowed per 15 min
    expect(await codeOf(service.adminSignIn('host password 123', '10.0.0.2'))).toBe('RATE_LIMITED');
    expect(await codeOf(service.adminSignIn('host password 123', '10.0.0.3'))).toBe('ok');
  });
});

describe('event service configuration', () => {
  it('refuses host sign-in when no password hash is configured', async () => {
    const service = new EventService({ config: testConfig(), repository: new MemoryEventRepository(), ids: serverIds });
    await expect(service.adminSignIn('anything at all', 'ip')).rejects.toMatchObject({ code: 'NOT_AVAILABLE' });
  });

  it('hides development routes unless enabled', async () => {
    const service = new EventService({
      config: testConfig({ DEV_ROUTES: 'false' }),
      repository: new MemoryEventRepository(),
      ids: serverIds,
    });
    await expect(service.devReset()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.devSimulate()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
