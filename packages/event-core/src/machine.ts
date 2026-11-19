import { quizConfigSchema, type AdminCommand, type EventPhase, type QuizStage } from '@olu/shared';
import { fail } from './errors';
import { currentQuestion, type EventState } from './state';

function requirePhase(state: EventState, ...phases: EventPhase[]): void {
  if (!phases.includes(state.phase)) fail('WRONG_PHASE', 'That isn’t available right now.');
}

function requireStage(state: EventState, ...stages: QuizStage[]): void {
  requirePhase(state, 'QUIZ');
  if (!stages.includes(state.quiz.stage)) fail('WRONG_PHASE', 'That quiz step isn’t available right now.');
}

function openQuestion(state: EventState, now: number): void {
  const question = currentQuestion(state);
  if (!question) fail('NOT_FOUND', 'There is no question to open.');
  state.quiz.stage = 'QUESTION_OPEN';
  state.quiz.opensAt = now;
  state.quiz.closesAt = now + question.timeLimitSec * 1000;
  state.quiz.openedAt[question.id] = now;
}

/** Questions may only change before anyone has seen them. */
export function isQuizEditable(state: EventState): boolean {
  return state.phase === 'LOBBY' || state.phase === 'VOTING';
}

/**
 * Time-based transitions, applied lazily whenever the state is read or written.
 * A question whose deadline (plus grace) has passed closes on its own, so every
 * device agrees even if the host is busy. No background timer is needed, which
 * suits Lambda. Returns true when something changed.
 */
export function settle(state: EventState, now: number): boolean {
  const { quiz, reveal } = state;
  if (state.phase === 'QUIZ' && quiz.stage === 'QUESTION_OPEN' && quiz.closesAt !== null) {
    if (now > quiz.closesAt + state.settings.answerGraceMs) {
      quiz.stage = 'QUESTION_CLOSED';
      return true;
    }
  }
  if (reveal.status === 'REVEALING' && reveal.revealAt !== null && now >= reveal.revealAt) {
    reveal.status = 'REVEALED';
    return true;
  }
  return false;
}

/** Applies one host command to a draft state, or throws a DomainError. */
export function applyAdminCommand(state: EventState, command: AdminCommand, now: number): void {
  settle(state, now);
  const lastIndex = state.quiz.questions.length - 1;

  switch (command.type) {
    case 'START_VOTING':
      requirePhase(state, 'LOBBY');
      state.phase = 'VOTING';
      state.voting.open = true;
      return;

    case 'CLOSE_VOTING':
      requirePhase(state, 'VOTING');
      if (!state.voting.open) fail('WRONG_PHASE', 'Voting is already closed.');
      state.voting.open = false;
      return;

    case 'START_QUIZ':
      requirePhase(state, 'VOTING');
      state.voting.open = false;
      state.phase = 'QUIZ';
      state.quiz.stage = 'INTRO';
      state.quiz.index = 0;
      return;

    case 'OPEN_QUESTION':
      requireStage(state, 'INTRO');
      openQuestion(state, now);
      return;

    case 'CLOSE_QUESTION':
      requireStage(state, 'QUESTION_OPEN');
      state.quiz.stage = 'QUESTION_CLOSED';
      state.quiz.closesAt = Math.min(now, state.quiz.closesAt ?? now);
      return;

    case 'REVEAL_ANSWER':
      requireStage(state, 'QUESTION_CLOSED');
      state.quiz.stage = 'ANSWER_REVEALED';
      return;

    case 'SHOW_LEADERBOARD':
      requireStage(state, 'ANSWER_REVEALED');
      state.quiz.stage = 'LEADERBOARD';
      return;

    case 'NEXT_QUESTION':
      requireStage(state, 'ANSWER_REVEALED', 'LEADERBOARD');
      if (state.quiz.index >= lastIndex) fail('WRONG_PHASE', 'That was the last question.');
      state.quiz.index += 1;
      openQuestion(state, now);
      return;

    case 'FINISH_QUIZ':
      requireStage(state, 'ANSWER_REVEALED', 'LEADERBOARD');
      if (state.quiz.index < lastIndex) fail('WRONG_PHASE', 'There are still questions left.');
      state.quiz.stage = 'RESULTS';
      return;

    case 'START_MESSAGES':
      requireStage(state, 'RESULTS');
      state.phase = 'MESSAGES';
      state.messages.open = true;
      return;

    case 'CLOSE_MESSAGES':
      requirePhase(state, 'MESSAGES');
      if (!state.messages.open) fail('WRONG_PHASE', 'Messages are already closed.');
      state.messages.open = false;
      return;

    case 'START_REVEAL':
      requirePhase(state, 'MESSAGES');
      state.messages.open = false;
      state.phase = 'REVEAL';
      state.reveal.status = 'AWAITING_CODE';
      return;

    case 'FINISH_EVENT':
      requirePhase(state, 'REVEAL');
      state.phase = 'FINISHED';
      return;

    case 'SET_MESSAGE_APPROVAL':
    case 'SET_MESSAGE_HIDDEN':
    case 'SET_MESSAGE_REMOVED': {
      const message = state.messages.items.find((m) => m.id === command.messageId);
      if (!message) fail('NOT_FOUND', 'That message no longer exists.');
      if (command.type === 'SET_MESSAGE_REMOVED') {
        // Messages are never erased from the event; removing is reversible.
        message.removed = command.removed;
        return;
      }
      if (message.removed) fail('LOCKED', 'Restore the message first.');
      if (command.type === 'SET_MESSAGE_APPROVAL') message.approved = command.approved;
      if (command.type === 'SET_MESSAGE_HIDDEN') message.hidden = command.hidden;
      return;
    }

    case 'UPDATE_QUIZ_QUESTIONS': {
      if (!isQuizEditable(state)) fail('LOCKED', 'Questions are locked once the quiz has started.');
      const parsed = quizConfigSchema.safeParse(command.questions);
      if (!parsed.success) fail('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Check the quiz questions.');
      state.quiz.questions = parsed.data.map((q) => ({
        ...q,
        explanation: q.explanation ? q.explanation : undefined,
      }));
      state.quiz.answers = {};
      state.quiz.openedAt = {};
      return;
    }
  }
}
