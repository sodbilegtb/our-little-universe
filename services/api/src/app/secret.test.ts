import { beforeAll, describe, expect, it } from 'vitest';
import type { Ids } from '@olu/event-core';
import type { AdminCommand, DoctorChoice, GuestSession } from '@olu/shared';
import type { AppConfig } from '../config/config';
import { buildCodeEmail, LIVE_SUBJECT } from '../mail/codeEmail';
import { OutboxTransport } from '../mail/transport';
import { InlineMailerTrigger } from '../mail/trigger';
import type { EventRepository } from '../repositories/EventRepository';
import { DynamoEventRepository } from '../repositories/dynamo/DynamoEventRepository';
import { FakeDynamoDb } from '../repositories/dynamo/testing/FakeDynamoDb';
import { MemoryEventRepository } from '../repositories/memory/MemoryEventRepository';
import { readRevealResult } from '../reveal/revealResult';
import { generateRevealCode, normalizeRevealCode, revealCodeHash } from '../secret/codes';
import { DynamoSecretStore } from '../secret/DynamoSecretStore';
import { MemorySecretStore, type ApiSecretStore, type MailerSecretStore, type RevealSecretStore } from '../secret/SecretStore';
import { LocalVault } from '../secret/vault';
import { hashPassword } from '../security/password';
import { testClock, testConfig } from '../testing/support';
import { AppError } from './errors';
import type { Logger } from './logger';
import { EventService } from './EventService';

/*
 * The secret's guarantees (spec, testing items 11 to 17), on both storage
 * backends: in-memory, and DynamoDB through the strict fake.
 */

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('host password 123');
});

type SecretStore = ApiSecretStore & MailerSecretStore & RevealSecretStore;

const backends: { name: string; create: () => { repository: EventRepository; store: SecretStore } }[] = [
  { name: 'memory', create: () => ({ repository: new MemoryEventRepository(), store: new MemorySecretStore() }) },
  {
    name: 'DynamoDB (strict fake)',
    create: () => {
      const db = new FakeDynamoDb();
      return { repository: new DynamoEventRepository(db, 'olu-events'), store: new DynamoSecretStore(db, 'olu-secrets') };
    },
  },
];

/** A seeded generator, so two runs draw the same codes. */
function seeded(seed: number) {
  let a = seed;
  return (max: number) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

function world(
  backend: { repository: EventRepository; store: SecretStore },
  options: { patch?: Partial<AppConfig>; eventId?: string; seed?: number; vault?: LocalVault } = {},
) {
  const clock = testClock();
  const logs: unknown[] = [];
  const logger: Logger = {
    debug: () => {},
    info: (message, fields) => logs.push({ message, fields }),
    warn: (message, fields) => logs.push({ message, fields }),
    error: (message, fields) => logs.push({ message, fields }),
  };
  const config: AppConfig = {
    ...testConfig({ PUBLIC_APP_URL: 'https://app.example', EVENT_ID: options.eventId ?? 'test-event' }),
    ...options.patch,
  };
  const vault = options.vault ?? new LocalVault(Buffer.alloc(32, 7));
  const outbox = new OutboxTransport();
  const mailerConfig = {
    environment: config.environment,
    eventId: config.eventId,
    eventName: config.eventName,
    appUrl: config.appUrl,
    mode: config.revealMode,
    sender: 'reveal@example.com',
    recipients: ['parent@example.com'],
  };
  const mailer = new InlineMailerTrigger(
    { store: backend.store, opener: vault, transport: outbox, logger, now: () => clock.now, config: mailerConfig },
    logger,
  );
  let counter = 0;
  const ids: Ids = {
    guestId: () => `gst_${String(++counter).padStart(24, '0')}`,
    sessionToken: () => `tok_${String(++counter).padStart(24, '0')}`,
    messageId: (guestId, clientMessageId) => `msg_${guestId}_${clientMessageId}`,
  };
  const service = new EventService({
    config,
    repository: backend.repository,
    ids,
    clock: () => clock.now,
    logger,
    passwordHash: async () => passwordHash,
    secrets: { store: backend.store, sealer: vault, mailer },
    randomPick: seeded(options.seed ?? 42),
  });
  const reveal = () =>
    readRevealResult({
      loadControl: async () => (await backend.repository.load(config.eventId))?.state ?? null,
      store: backend.store,
      opener: vault,
      environment: config.environment,
      eventId: config.eventId,
      now: () => clock.now,
    });
  const command = (type: AdminCommand['type']) => service.adminCommand({ type } as AdminCommand);
  const tokenOf = (url: string) => url.split('#')[1] as string;
  return { service, clock, logs, outbox, config, vault, reveal, command, tokenOf, store: backend.store, repository: backend.repository };
}

type World = ReturnType<typeof world>;

const SUBMISSION = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

async function seal(w: World, choice: DoctorChoice, submissionId = SUBMISSION) {
  const { url } = await w.service.createDoctorLink();
  const token = w.tokenOf(url);
  await w.service.submitDoctorSelection({ token, choice, submissionId }, '10.0.0.9');
  return token;
}

/** Plays a small evening (2 guests) up to the reveal phase. */
async function toRevealPhase(w: World): Promise<GuestSession[]> {
  const guests = [await w.service.registerGuest({ displayName: 'Mia' }), await w.service.registerGuest({ displayName: 'Ben' })];
  const cred = (s: GuestSession) => ({ guestId: s.guestId, sessionToken: s.sessionToken });
  await w.command('START_VOTING');
  await w.service.castVote(cred(guests[0]!), { choice: 'GIRL' });
  await w.service.castVote(cred(guests[1]!), { choice: 'BOY' });
  await w.command('CLOSE_VOTING');
  await w.command('START_QUIZ');
  await w.command('OPEN_QUESTION');
  for (let i = 0; i < 10; i += 1) {
    const question = (await w.service.guestView(cred(guests[0]!))).quiz.question!;
    await w.service.submitQuizAnswer(cred(guests[0]!), { questionId: question.id, optionIndex: i % 4 });
    await w.command('CLOSE_QUESTION');
    await w.command('REVEAL_ANSWER');
    await w.command(i < 9 ? 'NEXT_QUESTION' : 'FINISH_QUIZ');
  }
  await w.command('START_MESSAGES');
  await w.service.submitMessage(cred(guests[1]!), { clientMessageId: 'client-0001', text: 'Hello little star' });
  await w.command('START_REVEAL');
  return guests;
}

function codeFromMail(w: World): string {
  const match = /[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}/.exec(w.outbox.sent.at(-1)?.text ?? '');
  if (!match) throw new Error('no code in the outbox');
  return match[0];
}

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof AppError || (error as { code?: string }).code) return (error as { code: string }).code;
    throw error;
  }
};

describe.each(backends)('the secret on $name', ({ create }) => {
  it('11. seals one answer per link: double clicks and retries never create a second code', async () => {
    const w = world(create());
    const { url } = await w.service.createDoctorLink();
    const token = w.tokenOf(url);
    // opening and refreshing the page creates nothing
    for (let i = 0; i < 3; i += 1) expect(await w.service.doctorSession(token, 'ip')).toEqual({ mode: 'TEST', status: 'READY' });
    expect(w.outbox.sent).toHaveLength(0);

    // a double click: the same submission twice, at the same time
    const input = { token, choice: 'GIRL' as const, submissionId: SUBMISSION };
    await Promise.all([w.service.submitDoctorSelection(input, 'ip'), w.service.submitDoctorSelection(input, 'ip')]);
    await w.service.submitDoctorSelection(input, 'ip'); // a retry after a timeout
    expect(w.outbox.sent).toHaveLength(1);
    expect(await w.service.doctorSession(token, 'ip')).toEqual({ mode: 'TEST', status: 'SEALED' });

    // another submission with the same link (a second device, a changed mind) is refused
    expect(await errorCode(w.service.submitDoctorSelection({ ...input, choice: 'BOY', submissionId: 'ffffffff-0000-4000-8000-000000000000' }, 'ip'))).toBe(
      'ALREADY_SUBMITTED',
    );
    // and a new link can't be issued over a sealed answer
    expect(await errorCode(w.service.createDoctorLink())).toBe('LOCKED');
    expect(w.outbox.sent).toHaveLength(1);
  });

  it('12. draws random, well-formed codes and re-draws on the rare collision', async () => {
    const codes = new Set(Array.from({ length: 5000 }, () => generateRevealCode()));
    expect(codes.size).toBe(5000);
    for (const code of [...codes].slice(0, 50)) expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(normalizeRevealCode(' r7km 92px-l4qt ')).toBeNull(); // L is not in the alphabet
    expect(normalizeRevealCode('r7km 92px-x4qt')).toBe('R7KM-92PX-X4QT');

    // Two sealed answers drawing the same first code: the second draws again.
    const backend = create();
    const first = world(backend, { seed: 7 });
    await seal(first, 'BOY');
    const firstCode = codeFromMail(first);
    await first.service.resetSecret();
    const second = world(backend, { seed: 7 }); // same seed: same first draw
    await seal(second, 'GIRL');
    const secondCode = codeFromMail(second);
    expect(secondCode).not.toBe(firstCode);
  });

  it('13. keeps test and live, and events, apart: a code only works where it was made', async () => {
    const backend = create();
    const test = world(backend, { eventId: 'rehearsal-1' });
    await seal(test, 'GIRL');
    const testCode = codeFromMail(test);
    expect(test.outbox.sent[0]!.subject).toBe(`[TEST] ${LIVE_SUBJECT}`);

    // Another event in the same environment and store: the code isn't even found.
    const other = world(backend, { eventId: 'rehearsal-2', seed: 1234 }); // another seed: its own, different code
    await seal(other, 'BOY');
    await toRevealPhase(other);
    expect((await other.service.submitRevealCode(testCode)).accepted).toBe(false);

    // A live environment sharing the store (never the case in AWS): still not found,
    // because codes are hashed with their environment and event.
    const live = world(backend, { eventId: 'rehearsal-1', patch: { environment: 'prod', revealMode: 'LIVE' } });
    await toRevealPhase(live).catch(() => undefined);
    expect(revealCodeHash({ environment: 'prod', eventId: 'rehearsal-1' }, testCode)).not.toBe(
      revealCodeHash({ environment: 'local', eventId: 'rehearsal-1' }, testCode),
    );
    expect(await backend.store.findCode(revealCodeHash({ environment: 'prod', eventId: 'rehearsal-1' }, testCode))).toBeNull();

    // A code from before a reset no longer works either.
    const resetWorld = world(create());
    await seal(resetWorld, 'BOY');
    const oldCode = codeFromMail(resetWorld);
    await resetWorld.service.resetSecret();
    await seal(resetWorld, 'BOY', 'b1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d');
    const newCode = codeFromMail(resetWorld);
    await toRevealPhase(resetWorld);
    expect((await resetWorld.service.submitRevealCode(oldCode)).accepted).toBe(false);
    expect((await resetWorld.service.submitRevealCode(newCode)).accepted).toBe(true);
  });

  it('14. retries a failed email with the same code, and "send again" repeats it too', async () => {
    const w = world(create());
    w.outbox.failNext = 2; // SES rejects twice, then delivers
    await seal(w, 'GIRL');
    expect(w.outbox.sent).toHaveLength(1);
    const code = codeFromMail(w);
    let view = await w.service.adminView();
    expect(view.doctor).toMatchObject({ status: 'CODE_SENT', email: { status: 'SENT', attempts: 3 } });

    await w.service.resendRevealCode();
    expect(w.outbox.sent).toHaveLength(2);
    expect(codeFromMail(w)).toBe(code);

    // If every attempt fails, the host sees it and nothing new is generated.
    const failing = world(create());
    failing.outbox.failNext = 3;
    await seal(failing, 'BOY');
    view = await failing.service.adminView();
    expect(view.doctor).toMatchObject({ status: 'SUBMITTED', email: { status: 'FAILED', attempts: 3 } });
    await failing.service.resendRevealCode();
    expect(failing.outbox.sent).toHaveLength(1);
    expect((await failing.service.adminView()).doctor.status).toBe('CODE_SENT');
  });

  it('15. rejects wrong, malformed, early and repeated-guess codes without saying why', async () => {
    const w = world(create());
    await seal(w, 'BOY');
    const code = codeFromMail(w);
    expect(await w.service.submitRevealCode(code)).toMatchObject({ accepted: false, message: 'Start the reveal first, then enter the code.' });
    await toRevealPhase(w);
    expect((await w.service.submitRevealCode('nonsense')).accepted).toBe(false);
    const wrong = await w.service.submitRevealCode('2222-2222-2222');
    expect(wrong).toEqual({ accepted: false, message: 'That code doesn’t unlock the reveal. Check it and try again.' });
    expect((await w.service.adminView()).reveal.status).toBe('AWAITING_CODE');

    // Guessing is limited per event: 10 attempts per 15 minutes, then even the right code waits.
    for (let i = 0; i < 8; i += 1) await w.service.submitRevealCode(`2222-2222-${String(2222 + i)}`.slice(0, 14));
    expect(await errorCode(w.service.submitRevealCode(code))).toBe('RATE_LIMITED');
    w.clock.tick(15 * 60 * 1000 + 1);
    expect((await w.service.submitRevealCode(code.toLowerCase().replace(/-/g, ' '))).accepted).toBe(true);
  });

  it('16. releases the result only from the reveal moment on, judged by the server clock', async () => {
    const w = world(create());
    await seal(w, 'GIRL');
    const code = codeFromMail(w);
    expect(await w.reveal()).toBeNull(); // sealed, not in the reveal phase
    await toRevealPhase(w);
    expect(await w.reveal()).toBeNull(); // reveal phase, no code yet

    const accepted = await w.service.submitRevealCode(code);
    expect(accepted.accepted).toBe(true);
    const revealAt = Date.parse(accepted.revealAt!);
    expect(revealAt - w.clock.now).toBe(26_000);
    expect((await w.service.tvView()).reveal).toEqual({
      status: 'REVEALING',
      startedAt: new Date(revealAt - 26_000).toISOString(),
      revealAt: accepted.revealAt,
    });
    expect(await w.reveal()).toBeNull(); // countdown running
    w.clock.tick(25_999);
    expect(await w.reveal()).toBeNull();
    w.clock.tick(1);
    expect(await w.reveal()).toEqual({ result: 'GIRL', revealAt: accepted.revealAt });
    expect((await w.service.tvView()).reveal.status).toBe('REVEALED');
    // entering the code again doesn't restart anything
    expect((await w.service.submitRevealCode(code)).accepted).toBe(true);
    expect((await w.service.tvView()).reveal.revealAt).toBe(accepted.revealAt);
    // still there after the evening is finished, for the thank-you screen
    await w.command('FINISH_EVENT');
    expect(await w.reveal()).toEqual({ result: 'GIRL', revealAt: accepted.revealAt });
  });

  it('17. every response is identical whether the answer is BOY or GIRL', async () => {
    async function transcript(choice: DoctorChoice) {
      const w = world(create(), { seed: 99 });
      const seen: unknown[] = [];
      const guests = await toRevealPhase(w);
      const cred = (s: GuestSession) => ({ guestId: s.guestId, sessionToken: s.sessionToken });
      const look = async (label: string) => {
        seen.push(label, await w.service.revision(), await w.service.tvView(), await w.service.adminView(), await w.service.exportEvent());
        for (const guest of guests) seen.push(await w.service.guestView(cred(guest)));
      };

      await look('before');
      const { url } = await w.service.createDoctorLink();
      const token = w.tokenOf(url);
      seen.push(await w.service.doctorSession(token, 'ip'));
      seen.push(await w.service.submitDoctorSelection({ token, choice, submissionId: SUBMISSION }, 'ip'));
      seen.push(await w.service.doctorSession(token, 'ip'));
      await look('sealed');
      await w.service.resendRevealCode();
      seen.push(w.outbox.sent.map(({ subject, text, html, to, from }) => ({ subject, text, html, to, from })));
      seen.push(await w.service.submitRevealCode('2222-2222-2222'));
      seen.push(await w.service.submitRevealCode(codeFromMail(w)));
      await look('revealing');
      w.clock.tick(26_000);
      await look('revealed'); // the views themselves still carry no result
      seen.push(w.logs);
      const result = await w.reveal();
      // Random link ids differ between runs whatever the answer; mask them.
      const text = JSON.stringify(seen).replace(/sel_[a-f0-9]{32}/g, 'sel_*').replace(/lnk_[A-Za-z0-9_-]+/g, 'lnk_*');
      return { text, result };
    }

    const boy = await transcript('BOY');
    const girl = await transcript('GIRL');
    expect(boy.text.length).toBeGreaterThan(10_000);
    expect(boy.text).toBe(girl.text);
    // ...while the reveal service, at the reveal moment, does tell them apart.
    expect(boy.result?.result).toBe('BOY');
    expect(girl.result?.result).toBe('GIRL');
  });

  it('stores the answer and the code only sealed, bound to their purpose', async () => {
    const backend = create();
    const w = world(backend);
    await seal(w, 'GIRL');
    const code = codeFromMail(w);
    if (backend.store instanceof MemorySecretStore) {
      const dump = JSON.stringify(backend.store.dump());
      expect(dump).not.toContain(code);
      expect(dump).not.toMatch(/"GIRL"|"BOY"/);
    }
    const { doctor } = (await w.repository.load('test-event'))!.state;
    const sealed = await backend.store.getSealedChoice('test-event', doctor.selectionId!);
    const context = { environment: 'local', eventId: 'test-event', selectionId: doctor.selectionId! };
    expect(await w.vault.open('doctor-selection', sealed!.choiceCiphertext, context)).toBe('GIRL');
    // the same ciphertext can't be opened as a code, or for another event
    await expect(w.vault.open('reveal-code', sealed!.choiceCiphertext, context)).rejects.toThrow();
    await expect(w.vault.open('doctor-selection', sealed!.choiceCiphertext, { ...context, eventId: 'other' })).rejects.toThrow();
  });
});

describe('doctor link', () => {
  it('expires, and a new link retires the old one', async () => {
    const w = world(backends[0]!.create());
    const old = w.tokenOf((await w.service.createDoctorLink()).url);
    const current = w.tokenOf((await w.service.createDoctorLink()).url);
    expect(await errorCode(w.service.doctorSession(old, 'ip'))).toBe('INVALID_LINK');
    expect((await w.service.doctorSession(current, 'ip')).status).toBe('READY');
    w.clock.tick(48 * 60 * 60 * 1000 + 1);
    expect(await errorCode(w.service.doctorSession(current, 'ip'))).toBe('INVALID_LINK');
    expect(await errorCode(w.service.submitDoctorSelection({ token: current, choice: 'BOY', submissionId: SUBMISSION }, 'ip'))).toBe(
      'INVALID_LINK',
    );
  });

  it('limits attempts from one device', async () => {
    const w = world(backends[0]!.create());
    for (let i = 0; i < 30; i += 1) await errorCode(w.service.doctorSession('x'.repeat(43), '10.1.1.1'));
    expect(await errorCode(w.service.doctorSession('x'.repeat(43), '10.1.1.1'))).toBe('RATE_LIMITED');
  });
});

describe('reveal code email', () => {
  it('never hints at the answer, and marks test emails', () => {
    const live = buildCodeEmail({ code: 'R7KM-92PX-X4QT', mode: 'LIVE', eventName: 'Our Little Universe', appUrl: 'https://app.example' });
    expect(live.subject).toBe('OFFICIAL BABY REVEAL CODE');
    expect(live.text).toContain('Your official Baby Reveal secret code is ready.');
    expect(live.text).toContain('R7KM-92PX-X4QT');
    const test = buildCodeEmail({ code: 'R7KM-92PX-X4QT', mode: 'TEST', eventName: 'Our Little Universe', appUrl: '' });
    expect(test.subject).toBe('[TEST] OFFICIAL BABY REVEAL CODE');
    expect(test.text.startsWith('TEST:')).toBe(true);
    for (const email of [live, test]) {
      expect(`${email.subject} ${email.text} ${email.html}`).not.toMatch(/\b(boy|girl|son|daughter|he|she|his|her|junge|mädchen|pink|blue)\b/i);
    }
  });
});
