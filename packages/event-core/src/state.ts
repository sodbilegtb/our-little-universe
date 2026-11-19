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
 * separate, encrypted store owned by a narrowly privileged component (Milestone 6).
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
  doctor: { status: DoctorStatus };
  reveal: { status: RevealStatus };
  settings: EventSettings;
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
    doctor: { status: 'NOT_STARTED' },
    reveal: { status: 'LOCKED' },
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
