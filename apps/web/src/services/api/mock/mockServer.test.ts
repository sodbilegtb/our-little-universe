import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCommand, GuestSession } from '@olu/shared';
import { ApiError, type AdminSession } from '../EventApi';
import { mockEventApi as api, mockTools } from './mockServer';

/*
 * The event rules themselves are tested in @olu/event-core. These tests cover
 * what the adapter adds: authentication, transport errors, idempotent resends,
 * time-based settling on read, and secrecy of the doctor's selection.
 */

async function expectCode(promise: Promise<unknown>, code: ApiError['code']) {
  await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof ApiError && error.code === code);
}

let admin: AdminSession;
const command = (type: AdminCommand['type']) => api.sendAdminCommand(admin, { type } as AdminCommand);
const join = (name = 'Test guest'): Promise<GuestSession> => api.registerGuest({ displayName: name });

describe('mock event API', () => {
  beforeEach(async () => {
    localStorage.clear();
    mockTools.reset();
    admin = await api.adminSignIn('any password');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores a registered guest from their session and rejects forged tokens', async () => {
    const session = await join('  Aunt   Mia ');
    expect((await api.getGuestView(session)).me?.displayName).toBe('Aunt Mia');
    expect((await api.getGuestView({ ...session, sessionToken: 'forged' })).me).toBeNull();
    await expectCode(api.castVote({ ...session, sessionToken: 'forged' }, { choice: 'BOY' }), 'UNAUTHORIZED');
  });

  it('rejects host actions without a valid admin session', async () => {
    const intruder: AdminSession = { token: 'adm_forged' };
    await expectCode(api.sendAdminCommand(intruder, { type: 'START_VOTING' }), 'UNAUTHORIZED');
    await expectCode(api.getAdminView(intruder), 'UNAUTHORIZED');
    await expectCode(api.submitRevealCode(intruder, 'R7KM-92PX-L4QT'), 'UNAUTHORIZED');
    expect((await api.getTvView()).phase).toBe('LOBBY');
  });

  it('bumps the revision that clients poll', async () => {
    const before = await api.getRevision('tv');
    await command('START_VOTING');
    expect(await api.getRevision('tv')).toBeGreaterThan(before);
  });

  it('cuts party devices off during a simulated outage, but not the host desk', async () => {
    const session = await join();
    mockTools.simulateOutage(60_000);
    await expectCode(api.getRevision('guest'), 'NETWORK');
    await expectCode(api.getTvView(), 'NETWORK');
    await expectCode(api.castVote(session, { choice: 'BOY' }), 'NETWORK');
    await expect(api.getAdminView(admin)).resolves.toBeTruthy();
    mockTools.reset();
    await expect(api.getRevision('guest')).resolves.toBeTypeOf('number');
  });

  it('keeps one message when the same draft is resent', async () => {
    const session = await join();
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
    const draft = { clientMessageId: 'draft-0000001', text: 'Hello little one' };
    await api.submitMessage(session, draft);
    await api.submitMessage(session, draft);
    expect((await api.getAdminView(admin)).messages.items).toHaveLength(1);
    expect((await api.getGuestView(session)).messages.myCount).toBe(1);
  }, 20_000);

  it('closes a timed-out question when anyone reads the event', async () => {
    await command('START_VOTING');
    await command('START_QUIZ');
    await command('OPEN_QUESTION');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    expect((await api.getTvView()).quiz.stage).toBe('QUESTION_CLOSED');
  });

  it('keeps the doctor\'s answer out of every view, and seals it once', async () => {
    const { url } = await api.createDoctorLink(admin);
    const token = url.split('#')[1]!;
    expect(await api.verifyDoctorLink(token)).toEqual({ mode: 'TEST', status: 'READY' });
    await api.submitDoctorSelection(token, 'GIRL', 'submission-0000001');
    await api.submitDoctorSelection(token, 'GIRL', 'submission-0000001'); // double tap is harmless
    await expectCode(api.submitDoctorSelection(token, 'BOY', 'submission-0000002'), 'ALREADY_SUBMITTED');
    const everything = JSON.stringify([
      await api.getAdminView(admin),
      await api.getTvView(),
      await api.getGuestView(null),
      localStorage.getItem('olu.mock.state.v2'),
    ]);
    expect(everything).not.toMatch(/GIRL|BOY/);
    expect((await api.getAdminView(admin)).doctor.status).toBe('CODE_SENT');
    expect(await api.verifyDoctorLink(token)).toEqual({ mode: 'TEST', status: 'SEALED' });
    expect(await api.dev!.outbox!(admin)).toHaveLength(1);
  }, 30_000);

  it('unlocks the reveal with the emailed code, and releases the result only at the reveal moment', async () => {
    const { code } = await api.simulateDoctor(admin);
    for (const type of ['START_VOTING', 'CLOSE_VOTING', 'START_QUIZ', 'OPEN_QUESTION'] as const) await command(type);
    for (let i = 0; i < 10; i += 1) {
      await command('CLOSE_QUESTION');
      await command('REVEAL_ANSWER');
      await command(i < 9 ? 'NEXT_QUESTION' : 'FINISH_QUIZ');
    }
    await command('START_MESSAGES');
    await command('START_REVEAL');
    expect((await api.submitRevealCode(admin, '2222-2222-2222')).accepted).toBe(false);
    const accepted = await api.submitRevealCode(admin, code);
    expect(accepted.accepted).toBe(true);
    expect(await api.getRevealResult()).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(accepted.revealAt!));
    expect((await api.getRevealResult())?.result).toMatch(/^(BOY|GIRL)$/);
  }, 60_000);
});
