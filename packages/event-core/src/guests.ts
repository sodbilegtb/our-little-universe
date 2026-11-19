import {
  babyMessageSchema,
  castVoteSchema,
  quizAnswerSchema,
  registerGuestSchema,
  type BabyMessageInput,
  type CastVoteInput,
  type QuizAnswerInput,
  type RegisterGuestInput,
} from '@olu/shared';
import { fail } from './errors';
import { settle } from './machine';
import { currentQuestion, type EventState, type GuestRecord, type MessageRecord } from './state';

/** Server-generated identifiers, injected so the rules stay deterministic in tests. */
export interface Ids {
  guestId: () => string;
  sessionToken: () => string;
  /**
   * The backend derives this from (guestId, clientMessageId), so a resend maps to
   * the same storage key and a conditional write makes it idempotent.
   */
  messageId: (guestId: string, clientMessageId: string) => string;
}

function parse<T>(result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): T {
  if (!result.success) fail('INVALID_INPUT', result.error.issues[0]?.message ?? 'Please check your input.');
  return result.data;
}

export function registerGuest(state: EventState, input: RegisterGuestInput, ids: Ids, now: number): GuestRecord {
  const { displayName } = parse(registerGuestSchema.safeParse(input));
  if (state.phase === 'FINISHED') fail('CLOSED', 'The celebration has ended.');
  const guest: GuestRecord = { id: ids.guestId(), displayName, sessionToken: ids.sessionToken(), joinedAt: now };
  state.guests.push(guest);
  return guest;
}

/** Guest identity comes from the session token, never from a client-supplied id alone. */
export function authenticateGuest(state: EventState, guestId: string, sessionToken: string): GuestRecord {
  const guest = state.guests.find((g) => g.id === guestId);
  if (!guest || !constantTimeEqual(guest.sessionToken, sessionToken)) {
    fail('UNAUTHORIZED', 'Your session has expired. Please join again.');
  }
  return guest;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Outcome = 'recorded' | 'already-recorded';

/**
 * One vote per guest. Repeating the same vote (a retry after a dropped
 * connection) succeeds without counting twice; a different vote is rejected.
 */
export function castVote(state: EventState, guest: GuestRecord, input: CastVoteInput, now: number): Outcome {
  const { choice } = parse(castVoteSchema.safeParse(input));
  if (state.phase !== 'VOTING') fail('WRONG_PHASE', 'Voting isn’t open right now.');
  const existing = state.voting.votes[guest.id];
  if (existing) {
    if (existing.choice === choice) return 'already-recorded';
    fail('ALREADY_SUBMITTED', 'Your vote is already in.');
  }
  if (!state.voting.open) fail('CLOSED', 'Voting has closed.');
  state.voting.votes[guest.id] = { choice, castAt: now };
  return 'recorded';
}

/** One answer per guest per question, accepted only while the question is open. */
export function submitQuizAnswer(state: EventState, guest: GuestRecord, input: QuizAnswerInput, now: number): Outcome {
  const { questionId, optionIndex } = parse(quizAnswerSchema.safeParse(input));
  settle(state, now);
  const question = currentQuestion(state);
  const existing = question ? state.quiz.answers[question.id]?.[guest.id] : undefined;

  if (existing && question?.id === questionId) {
    if (existing.optionIndex === optionIndex) return 'already-recorded';
    fail('ALREADY_SUBMITTED', 'Your answer is already locked in.');
  }
  if (state.phase !== 'QUIZ' || state.quiz.stage !== 'QUESTION_OPEN' || !question || question.id !== questionId) {
    fail('CLOSED', 'That question has already closed.');
  }
  const deadline = (state.quiz.closesAt ?? 0) + state.settings.answerGraceMs;
  if (now > deadline) fail('CLOSED', 'Time’s up for this question.');

  const answers = (state.quiz.answers[question.id] ??= {});
  answers[guest.id] = { optionIndex, answeredAt: now };
  return 'recorded';
}

/**
 * Saves a message for the baby. Idempotent per clientMessageId, so a resend
 * after a dropped connection returns the original instead of a duplicate.
 */
export function submitMessage(
  state: EventState,
  guest: GuestRecord,
  input: BabyMessageInput,
  ids: Ids,
  now: number,
): { message: MessageRecord; outcome: Outcome } {
  const { text, clientMessageId } = parse(babyMessageSchema.safeParse(input));
  const mine = state.messages.items.filter((m) => m.guestId === guest.id);
  const duplicate = mine.find((m) => m.clientMessageId === clientMessageId);
  if (duplicate) return { message: duplicate, outcome: 'already-recorded' };

  if (state.phase !== 'MESSAGES') fail('WRONG_PHASE', 'Messages aren’t open right now.');
  if (!state.messages.open) fail('CLOSED', 'Messages have closed.');
  if (mine.length >= state.settings.messagesPerGuest) {
    fail('LIMIT_REACHED', `Each guest can send up to ${state.settings.messagesPerGuest} messages.`);
  }

  const message: MessageRecord = {
    id: ids.messageId(guest.id, clientMessageId),
    clientMessageId,
    guestId: guest.id,
    displayName: guest.displayName,
    text,
    submittedAt: now,
    approved: false,
    hidden: false,
    removed: false,
    order: state.messages.nextOrder++,
  };
  state.messages.items.push(message);
  return { message, outcome: 'recorded' };
}
