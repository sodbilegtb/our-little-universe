import {
  DomainError,
  applyAdminCommand,
  authenticateGuest,
  authorizeReveal,
  isCurrentDoctorLink,
  issueDoctorLink,
  recordDoctorSelection,
  resetSecret,
  upgradeState,
  castVote,
  createEventState,
  registerGuest,
  seedSimulatedGuests,
  settle,
  simulateActivity,
  submitMessage,
  submitQuizAnswer,
  toAdminView,
  toEventExport,
  toGuestView,
  toTvView,
  transact,
  type EventState,
  type Ids,
  type SimulationContext,
  EXAMPLE_QUESTIONS,
} from '@olu/event-core';
import {
  revealCodeSchema,
  type AdminView,
  type DoctorChoice,
  type DoctorLinkResult,
  type DoctorSessionResult,
  type RevealCodeResult,
  type RevealResult,
  type SimulatedDoctorResult,
} from '@olu/shared';
import { ApiError, type Audience, type EventApi } from '../EventApi';
import {
  clearSecret,
  loadSecret,
  randomChoice,
  randomCode,
  randomToken,
  saveSecret,
  selectionIdFor,
  testEmail,
} from './mockSecret';

/*
 * A browser-only stand-in for the future Lambda + DynamoDB backend.
 *
 * All rules come from @olu/event-core, exactly as the Lambda handlers will use
 * them. This file only adds what a server adds: storage (localStorage here),
 * identifiers, authentication, latency and change notifications. A
 * BroadcastChannel keeps /tv, /admin and /party in sync across tabs.
 *
 * The doctor's answer in the preview is a test answer that you choose
 * yourself. It's kept in its own storage key (mockSecret.ts), apart from the
 * event state, and views never read it; only getRevealResult does, from the
 * reveal moment on, like the server's separate reveal service.
 */

const STORAGE_KEY = 'olu.mock.state.v2';
const ADMIN_TOKENS_KEY = 'olu.mock.adminTokens';
const OUTAGE_KEY = 'olu.mock.outageUntil';
const CHANNEL_NAME = 'olu-mock-sync';
const SIMULATED_PREFIX = 'mock_';

/* ---------- identifiers ---------- */

function randomId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const ids: Ids = {
  guestId: () => randomId('gst'),
  sessionToken: () => randomId('tok'),
  messageId: () => randomId('msg'),
};

const simulation: SimulationContext = {
  ids,
  simulatedIds: { ...ids, guestId: () => randomId(`${SIMULATED_PREFIX}gst`) },
  isSimulated: (guestId) => guestId.startsWith(SIMULATED_PREFIX),
};

/* ---------- storage ---------- */

function createInitialState(): EventState {
  const state = createEventState({ eventId: 'evt_local_preview', eventName: 'Our Little Universe', questions: EXAMPLE_QUESTIONS });
  seedSimulatedGuests(state, 9, simulation, Date.now() - 60 * 60_000);
  return state;
}

function load(): EventState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EventState;
      if (parsed.schema === 2) return upgradeState(parsed);
    }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  const fresh = createInitialState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;

/** Created lazily, so importing this module has no side effects (production builds drop it). */
function syncChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener('message', () => listeners.forEach((listener) => listener()));
  }
  return channel;
}

function save(state: EventState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((listener) => listener());
  syncChannel()?.postMessage({ revision: state.revision });
}

/** Reads the state after applying any time-based transitions (like a timed-out question). */
function read(): EventState {
  const state = load();
  const now = Date.now();
  const probe = structuredClone(state);
  if (settle(probe, now)) {
    const { state: next } = transact(state, (draft) => settle(draft, now));
    save(next);
    return next;
  }
  return state;
}

/** Runs one change atomically, the way a conditional DynamoDB write will. */
function write<T>(change: (draft: EventState, now: number) => T): T {
  const now = Date.now();
  const { state, result } = transact(load(), (draft) => {
    settle(draft, now);
    return change(draft, now);
  });
  save(state);
  return result;
}

/* ---------- transport simulation ---------- */

const latency = (min = 120, max = 320) =>
  new Promise<void>((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));

function outageActive(): boolean {
  return Number(localStorage.getItem(OUTAGE_KEY) ?? 0) > Date.now();
}

/**
 * Wraps a server call: simulated latency, simulated outages for party devices,
 * and translation of rule violations into API errors.
 */
async function call<T>(audience: Audience, run: () => T, delay: [number, number] = [120, 320]): Promise<T> {
  await latency(...delay);
  if (audience !== 'admin' && outageActive()) {
    throw new ApiError({ code: 'NETWORK', message: 'We can’t reach the party right now. Trying again…' });
  }
  try {
    return run();
  } catch (error) {
    if (error instanceof DomainError) throw new ApiError({ code: error.code, message: error.message });
    throw error;
  }
}

function adminTokens(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_TOKENS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function requireAdmin(token: string): void {
  if (!adminTokens().includes(token)) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'Please sign in to the host desk again.' });
  }
}

export function joinUrl(): string {
  return `${window.location.origin}/party`;
}

/* ---------- the secret (preview stand-in for the secrets table, KMS and the mailer) ---------- */

const DOCTOR_LINK_MS = 48 * 60 * 60 * 1000;
const REVEAL_DELAY_MS = 26_000;
const CODE_REJECTED = 'That code doesn’t unlock the reveal. Check it and try again.';

const invalidLink = () =>
  new ApiError({ code: 'INVALID_LINK', message: 'This link isn’t valid or has expired. Please ask the parents for a new one.' });

function findLink(token: string) {
  const link = loadSecret().links[token];
  if (!link) throw invalidLink();
  return link;
}

function issueLink(): { token: string; expiresAt: number } {
  const token = randomToken();
  const linkId = `lnk_${randomToken().slice(0, 16)}`;
  const expiresAt = Date.now() + DOCTOR_LINK_MS;
  const secret = loadSecret();
  secret.links[token] = { linkId, expiresAt };
  saveSecret(secret);
  write((draft) => issueDoctorLink(draft, { linkId, expiresAt }));
  return { token, expiresAt };
}

function sendCode(selectionId: string): void {
  const secret = loadSecret();
  const sealed = secret.selections[selectionId];
  if (!sealed || sealed.status !== 'ACTIVE') return;
  secret.outbox.push(testEmail(selectionId, sealed.code));
  saveSecret(secret);
}

/** Seals a choice once per link; the same submission again is a no-op. Returns the code. */
function seal(token: string, choice: DoctorChoice, submissionId: string): string {
  const link = findLink(token);
  const state = read();
  const sealedHere = state.doctor.status === 'SUBMITTED' && state.doctor.linkId === link.linkId;
  if (!sealedHere && !isCurrentDoctorLink(state, link.linkId, Date.now())) throw invalidLink();
  const selectionId = selectionIdFor(link.linkId);
  const secret = loadSecret();
  const existing = secret.selections[selectionId];
  if (existing && existing.submissionId !== submissionId) {
    throw new ApiError({ code: 'ALREADY_SUBMITTED', message: 'An answer has already been sealed with this link.' });
  }
  if (!existing) {
    secret.selections[selectionId] = { linkId: link.linkId, submissionId, choice, code: randomCode(), status: 'ACTIVE' };
    saveSecret(secret);
  }
  const outcome = write((draft, now) => recordDoctorSelection(draft, { linkId: link.linkId, selectionId }, now));
  if (outcome === 'recorded') sendCode(selectionId);
  return loadSecret().selections[selectionId]!.code;
}

function retire(selectionId: string | null): void {
  if (!selectionId) return;
  const secret = loadSecret();
  const sealed = secret.selections[selectionId];
  if (sealed) sealed.status = 'RETIRED';
  saveSecret(secret);
}

/** The host desk sees the email delivery like on the server: sent, never what was sent. */
function adminView(state: EventState): AdminView {
  const view = toAdminView(state, Date.now(), joinUrl(), 'TEST');
  const { selectionId } = state.doctor;
  if (state.doctor.status === 'SUBMITTED' && selectionId && loadSecret().outbox.some((m) => m.selectionId === selectionId)) {
    view.doctor.status = 'CODE_SENT';
    view.doctor.email = { status: 'SENT', attempts: 1, sentAt: null };
  }
  return view;
}

/* ---------- the API ---------- */

export const mockEventApi: EventApi = {
  getRevision: (audience) => call(audience, () => read().revision, [20, 60]),

  getGuestView: (session) =>
    call('guest', () => {
      const state = read();
      const guest = session ? state.guests.find((g) => g.id === session.guestId && g.sessionToken === session.sessionToken) : null;
      return toGuestView(state, guest?.id ?? null, Date.now());
    }),

  getTvView: () => call('tv', () => toTvView(read(), Date.now(), joinUrl())),

  getAdminView: (admin) =>
    call('admin', () => {
      requireAdmin(admin.token);
      return adminView(read());
    }),
  exportEvent: (admin) =>
    call('admin', () => {
      requireAdmin(admin.token);
      return toEventExport(read(), Date.now());
    }),

  subscribe(onChange) {
    syncChannel();
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },

  registerGuest: (input) =>
    call('guest', () => {
      const guest = write((state, now) => registerGuest(state, input, ids, now));
      return { guestId: guest.id, displayName: guest.displayName, sessionToken: guest.sessionToken };
    }),

  castVote: (session, input) =>
    call('guest', () => {
      write((state, now) => castVote(state, authenticateGuest(state, session.guestId, session.sessionToken), input, now));
    }),

  submitQuizAnswer: (session, input) =>
    call(
      'guest',
      () => {
        write((state, now) =>
          submitQuizAnswer(state, authenticateGuest(state, session.guestId, session.sessionToken), input, now),
        );
      },
      [80, 180],
    ),

  submitMessage: (session, input) =>
    call(
      'guest',
      () => {
        write((state, now) =>
          submitMessage(state, authenticateGuest(state, session.guestId, session.sessionToken), input, ids, now),
        );
      },
      [400, 700],
    ),

  adminSignIn: (password) =>
    call(
      'admin',
      () => {
        const expected = import.meta.env.VITE_MOCK_ADMIN_PASSWORD as string | undefined;
        if (password.trim().length === 0) throw new ApiError({ code: 'UNAUTHORIZED', message: 'Enter the host password.' });
        if (expected && password !== expected) {
          throw new ApiError({ code: 'UNAUTHORIZED', message: 'That password isn’t right.' });
        }
        const token = randomId('adm');
        localStorage.setItem(ADMIN_TOKENS_KEY, JSON.stringify([...adminTokens(), token].slice(-10)));
        return { token };
      },
      [300, 500],
    ),

  sendAdminCommand: (admin, command) =>
    call(
      'admin',
      () => {
        requireAdmin(admin.token);
        write((state, now) => applyAdminCommand(state, command, now));
      },
      [100, 220],
    ),

  submitRevealCode: (admin, code) =>
    call(
      'admin',
      (): RevealCodeResult => {
        requireAdmin(admin.token);
        const state = read();
        if (state.phase !== 'REVEAL') return { accepted: false, message: 'Start the reveal first, then enter the code.' };
        const parsed = revealCodeSchema.safeParse(code);
        if (!parsed.success) return { accepted: false, message: 'Codes look like R7KM-92PX-L4QT: 12 letters and digits.' };
        const secret = loadSecret();
        const entry = Object.entries(secret.selections).find(([, s]) => s.code === parsed.data && s.status === 'ACTIVE');
        if (!entry) return { accepted: false, message: CODE_REJECTED };
        try {
          write((draft, now) => authorizeReveal(draft, { selectionId: entry[0], delayMs: REVEAL_DELAY_MS }, now));
        } catch (error) {
          if (error instanceof DomainError && error.code === 'NOT_FOUND') return { accepted: false, message: CODE_REJECTED };
          throw error;
        }
        const revealAt = read().reveal.revealAt;
        return {
          accepted: true,
          message: 'The code is right. The reveal has begun.',
          ...(revealAt === null ? {} : { revealAt: new Date(revealAt).toISOString() }),
        };
      },
      [500, 800],
    ),

  createDoctorLink: (admin) =>
    call('admin', (): DoctorLinkResult => {
      requireAdmin(admin.token);
      const { token, expiresAt } = issueLink();
      return { url: `${window.location.origin}/doctor#${token}`, expiresAt: new Date(expiresAt).toISOString() };
    }),

  resendRevealCode: (admin) =>
    call('admin', () => {
      requireAdmin(admin.token);
      const { doctor } = read();
      if (doctor.status !== 'SUBMITTED' || !doctor.selectionId) {
        throw new ApiError({ code: 'WRONG_PHASE', message: 'There is no sealed answer yet.' });
      }
      sendCode(doctor.selectionId);
    }),

  resetSecret: (admin) =>
    call('admin', () => {
      requireAdmin(admin.token);
      retire(write((draft) => resetSecret(draft)).retiredSelectionId);
    }),

  simulateDoctor: (admin) =>
    call(
      'admin',
      (): SimulatedDoctorResult => {
        requireAdmin(admin.token);
        if (read().doctor.status === 'SUBMITTED') retire(write((draft) => resetSecret(draft)).retiredSelectionId);
        const { token } = issueLink();
        return { code: seal(token, randomChoice(), randomToken()) };
      },
      [400, 700],
    ),

  verifyDoctorLink: (token) =>
    call(
      'guest',
      (): DoctorSessionResult => {
        const link = findLink(token);
        const state = read();
        if (state.doctor.status === 'SUBMITTED' && state.doctor.linkId === link.linkId) return { mode: 'TEST', status: 'SEALED' };
        if (state.doctor.status !== 'LINK_ISSUED' || !isCurrentDoctorLink(state, link.linkId, Date.now())) throw invalidLink();
        return { mode: 'TEST', status: 'READY' };
      },
      [300, 500],
    ),

  submitDoctorSelection: (token, choice: DoctorChoice, submissionId) =>
    call(
      'guest',
      () => {
        if (choice !== 'BOY' && choice !== 'GIRL') throw new ApiError({ code: 'INVALID_INPUT', message: 'Choose one option.' });
        seal(token, choice, submissionId);
      },
      [900, 1300],
    ),

  getRevealResult: () =>
    call(
      'tv',
      (): RevealResult | null => {
        const { phase, reveal, doctor } = read();
        if (phase !== 'REVEAL' || reveal.revealAt === null || Date.now() < reveal.revealAt) return null;
        if ((reveal.status !== 'REVEALING' && reveal.status !== 'REVEALED') || !doctor.selectionId) return null;
        const sealed = loadSecret().selections[doctor.selectionId];
        if (!sealed || sealed.status !== 'ACTIVE') return null;
        return { result: sealed.choice, revealAt: new Date(reveal.revealAt).toISOString() };
      },
      [40, 120],
    ),
};

/* ---------- local preview tools (never part of the real API) ---------- */

export const mockTools = {
  reset(): void {
    clearSecret();
    const fresh = createInitialState();
    fresh.revision = load().revision + 1;
    localStorage.removeItem(OUTAGE_KEY);
    save(fresh);
  },

  /** Cuts guest phones and the TV off from the "server" for a while. The host desk stays online. */
  simulateOutage(ms = 8000): void {
    localStorage.setItem(OUTAGE_KEY, String(Date.now() + ms));
  },

  outageEndsAt(): number | null {
    const until = Number(localStorage.getItem(OUTAGE_KEY) ?? 0);
    return until > Date.now() ? until : null;
  },

  /** Adds believable activity from placeholder guests, through the real rules. */
  simulateActivity(): void {
    write((state, now) => simulateActivity(state, now, simulation));
  },
};

mockEventApi.dev = {
  reset: async () => mockTools.reset(),
  simulateActivity: async () => mockTools.simulateActivity(),
  simulateOutage: (ms) => mockTools.simulateOutage(ms),
  outageEndsAt: () => mockTools.outageEndsAt(),
  outbox: async (admin) => {
    requireAdmin(admin.token);
    return loadSecret().outbox.map(({ subject, text }) => ({ subject, text }));
  },
};
