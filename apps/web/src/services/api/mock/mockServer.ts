import {
  DomainError,
  applyAdminCommand,
  authenticateGuest,
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
import { revealCodeSchema, type DoctorChoice } from '@olu/shared';
import { ApiError, type Audience, type EventApi } from '../EventApi';
import { MOCK_DOCTOR_TOKEN } from './constants';

/*
 * A browser-only stand-in for the future Lambda + DynamoDB backend.
 *
 * All rules come from @olu/event-core, exactly as the Lambda handlers will use
 * them. This file only adds what a server adds: storage (localStorage here),
 * identifiers, authentication, latency and change notifications. A
 * BroadcastChannel keeps /tv, /admin and /party in sync across tabs.
 *
 * Deliberately absent: any notion of the baby's actual gender. The doctor
 * endpoint accepts a choice and discards it.
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
  state.doctor.status = 'LINK_ISSUED';
  return state;
}

function load(): EventState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EventState;
      if (parsed.schema === 2) return parsed;
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
      return toAdminView(read(), Date.now(), joinUrl());
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
      () => {
        requireAdmin(admin.token);
        if (!revealCodeSchema.safeParse(code).success) {
          return { accepted: false, message: 'Codes have 12 characters, like R7KM-92PX-L4QT.' };
        }
        return {
          accepted: false,
          message: 'Reveal codes are verified by the server, which arrives in a later milestone. Nothing was unlocked.',
        };
      },
      [500, 800],
    ),

  verifyDoctorLink: (token) =>
    call(
      'guest',
      () => {
        const state = read();
        if (token !== MOCK_DOCTOR_TOKEN) {
          throw new ApiError({ code: 'INVALID_LINK', message: 'This link isn’t valid. Please ask the hosts for a new one.' });
        }
        if (state.doctor.status === 'SUBMITTED' || state.doctor.status === 'CODE_SENT') {
          throw new ApiError({ code: 'INVALID_LINK', message: 'This link has already been used. The answer is sealed.' });
        }
        return { mode: 'TEST' as const };
      },
      [300, 500],
    ),

  submitDoctorSelection: (token, choice: DoctorChoice) =>
    call(
      'guest',
      () => {
        if (choice !== 'BOY' && choice !== 'GIRL') throw new ApiError({ code: 'INVALID_INPUT', message: 'Choose one option.' });
        if (token !== MOCK_DOCTOR_TOKEN) throw new ApiError({ code: 'INVALID_LINK', message: 'This link isn’t valid.' });
        // The mock never stores the selection. It only records that a submission happened.
        if (read().doctor.status === 'CODE_SENT') return; // idempotent
        write((state) => {
          state.doctor.status = 'CODE_SENT';
        });
      },
      [900, 1300],
    ),
};

/* ---------- local preview tools (never part of the real API) ---------- */

export const mockTools = {
  reset(): void {
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
};
