import {
  MESSAGES_PER_GUEST,
  type DoctorStatus,
  type EventPhase,
  type QuizQuestionConfig,
  type QuizStage,
  type RevealStatus,
  type VoteChoice,
} from '@olu/shared';

/*
 * The complete event state as the server holds it. Times are epoch milliseconds.
 *
 * Nothing in here can hold the baby's gender: the doctor's selection lives in a
 * separate, encrypted store. This state only knows *that* an answer was sealed
 * (an opaque selection id), never what it is.
 */

export interface GuestRecord {
  id: string;
  displayName: string;
  /** Opaque bearer secret. The DynamoDB repository stores a hash instead (Milestone 3). */
  sessionToken: string;
  joinedAt: number;
}

export interface VoteRecord {
  choice: VoteChoice;
  castAt: number;
}

export interface AnswerRecord {
  optionIndex: number;
  answeredAt: number;
}

export interface MessageRecord {
  id: string;
  clientMessageId: string;
  guestId: string;
  displayName: string;
  text: string;
  submittedAt: number;
  approved: boolean;
  hidden: boolean;
  /**
   * Removed by the host. Kept (and restorable) so a slip on the host desk
   * never loses a family memory; left out of the TV and the message exports.
   */
  removed: boolean;
  order: number;
}

export interface EventSettings {
  messagesPerGuest: number;
  /** Answers arriving this long after the deadline still count (network latency). */
  answerGraceMs: number;
}

export interface EventState {
  schema: 2;
  eventId: string;
  eventName: string;
  /** Increments on every change. Clients compare it to know when to refetch. */
  revision: number;
  /**
   * Test mode only: which rehearsal run this is. Starting a new rehearsal
   * bumps it; what earlier runs stored is kept but no longer part of the event.
   */
  run: number;
  phase: EventPhase;
  guests: GuestRecord[];
  voting: {
    open: boolean;
    votes: Record<string, VoteRecord>;
  };
  quiz: {
    stage: QuizStage;
    index: number;
    opensAt: number | null;
    closesAt: number | null;
    questions: QuizQuestionConfig[];
    openedAt: Record<string, number>;
    answers: Record<string, Record<string, AnswerRecord>>;
  };
  messages: {
    open: boolean;
    items: MessageRecord[];
    nextOrder: number;
  };
  doctor: DoctorState;
  reveal: RevealState;
  settings: EventSettings;
}

export interface DoctorState {
  status: Exclude<DoctorStatus, 'CODE_SENT'>;
  /** Increments on every reset, so nothing from before a reset can be reused. */
  generation: number;
  /** The one doctor link currently accepted. Issuing a new link retires the old one. */
  linkId: string | null;
  linkExpiresAt: number | null;
  /** Opaque id of the sealed answer in the secret store. Never the answer itself. */
  selectionId: string | null;
  submittedAt: number | null;
}

export interface RevealState {
  status: RevealStatus;
  /** When the host's code was accepted. */
  startedAt: number | null;
  /** The server releases the result from this moment on, not before. */
  revealAt: number | null;
  /**
   * The host's code once it was accepted, for the TV to decode on screen. It is
   * spent at that point (one reveal per answer) and says nothing about the result.
   */
  code: string | null;
}

export const INITIAL_DOCTOR: DoctorState = {
  status: 'NOT_STARTED',
  generation: 0,
  linkId: null,
  linkExpiresAt: null,
  selectionId: null,
  submittedAt: null,
};

export const INITIAL_REVEAL: RevealState = { status: 'LOCKED', startedAt: null, revealAt: null, code: null };

/**
 * Fills in fields added after an event was first stored (events created before
 * Milestone 6 only had `doctor.status` and `reveal.status`, before Milestone 7
 * no `run`).
 */
export function upgradeState<T extends Pick<EventState, 'doctor' | 'reveal'> & { run?: number }>(
  state: T,
): T & { run: number } {
  return {
    ...state,
    run: state.run ?? 0,
    doctor: { ...INITIAL_DOCTOR, ...state.doctor },
    reveal: { ...INITIAL_REVEAL, ...state.reveal },
  };
}

export const DEFAULT_SETTINGS: EventSettings = {
  messagesPerGuest: MESSAGES_PER_GUEST,
  answerGraceMs: 1500,
};

export interface CreateEventInput {
  eventId: string;
  eventName: string;
  questions: QuizQuestionConfig[];
  settings?: Partial<EventSettings>;
}

export function createEventState(input: CreateEventInput): EventState {
  return {
    schema: 2,
    eventId: input.eventId,
    eventName: input.eventName,
    revision: 1,
    run: 0,
    phase: 'LOBBY',
    guests: [],
    voting: { open: false, votes: {} },
    quiz: {
      stage: 'INTRO',
      index: 0,
      opensAt: null,
      closesAt: null,
      questions: input.questions.map((q) => ({ ...q })),
      openedAt: {},
      answers: {},
    },
    messages: { open: false, items: [], nextOrder: 0 },
    doctor: { ...INITIAL_DOCTOR },
    reveal: { ...INITIAL_REVEAL },
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
  };
}

export function currentQuestion(state: EventState): QuizQuestionConfig | null {
  return state.quiz.questions[state.quiz.index] ?? null;
}

/**
 * Applies a change to a copy of the state and bumps the revision.
 * The input is never mutated, so a failed rule leaves the original untouched.
 */
export function transact<T>(state: EventState, change: (draft: EventState) => T): { state: EventState; result: T } {
  const draft = structuredClone(state);
  const result = change(draft);
  draft.revision = state.revision + 1;
  return { state: draft, result };
}
