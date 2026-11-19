import {
  POINTS_PER_CORRECT_ANSWER,
  rankLeaderboard,
  type AdminMessage,
  type AdminView,
  type EventExport,
  type BaseEventView,
  type GuestView,
  type LeaderboardEntry,
  type QuizRoundView,
  type ScoreRecord,
  type TvView,
  type VoteTally,
} from '@olu/shared';
import { isQuizEditable } from './machine';
import { currentQuestion, type EventState, type MessageRecord } from './state';

/*
 * Role-specific read models. Each function decides exactly what one audience
 * may see. Guests and the TV never receive a correct answer before the host
 * reveals it, and no view can carry the baby's gender.
 */

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function voteTally(state: EventState): VoteTally {
  const votes = Object.values(state.voting.votes);
  const boy = votes.filter((v) => v.choice === 'BOY').length;
  return { boy, girl: votes.length - boy, total: votes.length };
}

function isScored(state: EventState, questionIndex: number): boolean {
  if (questionIndex < state.quiz.index) return true;
  if (questionIndex > state.quiz.index) return false;
  return state.quiz.stage === 'ANSWER_REVEALED' || state.quiz.stage === 'LEADERBOARD' || state.quiz.stage === 'RESULTS';
}

/** Scores count only for questions whose answer has been revealed. */
export function computeLeaderboard(state: EventState): LeaderboardEntry[] {
  const records = new Map<string, ScoreRecord>(
    state.guests.map((g) => [
      g.id,
      { guestId: g.id, displayName: g.displayName, joinedAt: g.joinedAt, score: 0, correctCount: 0, correctResponseMs: 0 },
    ]),
  );
  state.quiz.questions.forEach((question, index) => {
    if (!isScored(state, index)) return;
    const openedAt = state.quiz.openedAt[question.id] ?? 0;
    for (const [guestId, answer] of Object.entries(state.quiz.answers[question.id] ?? {})) {
      const record = records.get(guestId);
      if (!record || answer.optionIndex !== question.correctOptionIndex) continue;
      record.score += POINTS_PER_CORRECT_ANSWER;
      record.correctCount += 1;
      record.correctResponseMs += Math.max(0, answer.answeredAt - openedAt);
    }
  });
  return rankLeaderboard([...records.values()]);
}

function quizRound(state: EventState): QuizRoundView {
  const question = currentQuestion(state);
  const { stage } = state.quiz;
  const showsQuestion = state.phase === 'QUIZ' && stage !== 'INTRO' && stage !== 'RESULTS';
  const revealed = state.phase === 'QUIZ' && (stage === 'ANSWER_REVEALED' || stage === 'LEADERBOARD');
  return {
    stage,
    questionNumber: state.quiz.index + 1,
    totalQuestions: state.quiz.questions.length,
    question:
      showsQuestion && question
        ? { id: question.id, text: question.text, options: question.options, timeLimitSec: question.timeLimitSec }
        : null,
    opensAt: showsQuestion ? iso(state.quiz.opensAt) : null,
    closesAt: showsQuestion ? iso(state.quiz.closesAt) : null,
    answeredCount: showsQuestion && question ? Object.keys(state.quiz.answers[question.id] ?? {}).length : 0,
    correctOptionIndex: revealed && question ? question.correctOptionIndex : null,
    explanation: revealed && question ? (question.explanation ?? null) : null,
  };
}

function base(state: EventState, now: number): BaseEventView {
  return {
    eventId: state.eventId,
    eventName: state.eventName,
    revision: state.revision,
    phase: state.phase,
    serverTime: new Date(now).toISOString(),
    guestCount: state.guests.length,
  };
}

export function toTvView(state: EventState, now: number, joinUrl: string): TvView {
  const visible = state.messages.items.filter((m) => !m.hidden && !m.removed);
  return {
    ...base(state, now),
    joinUrl,
    voting: { open: state.voting.open, tally: voteTally(state) },
    quiz: quizRound(state),
    leaderboard: computeLeaderboard(state).slice(0, 8),
    messages: {
      open: state.messages.open,
      stars: visible.map((m) => ({ id: m.id, order: m.order, approved: m.approved })),
      featured: visible.filter((m) => m.approved).map((m) => ({ id: m.id, displayName: m.displayName, text: m.text })),
    },
    reveal: { status: state.reveal.status },
  };
}

export function toGuestView(state: EventState, guestId: string | null, now: number): GuestView {
  const me = guestId ? state.guests.find((g) => g.id === guestId) ?? null : null;
  const question = currentQuestion(state);
  const mine = me ? computeLeaderboard(state).find((e) => e.guestId === me.id) : undefined;
  const myAnswer =
    me && question && state.phase === 'QUIZ' ? state.quiz.answers[question.id]?.[me.id]?.optionIndex ?? null : null;
  return {
    ...base(state, now),
    me: me ? { guestId: me.id, displayName: me.displayName } : null,
    voting: { open: state.voting.open, myVote: me ? state.voting.votes[me.id]?.choice ?? null : null },
    quiz: {
      ...quizRound(state),
      myAnswer,
      myScore: mine?.score ?? 0,
      myRank: mine && mine.score > 0 ? mine.rank : null,
    },
    messages: {
      open: state.messages.open,
      myCount: me ? state.messages.items.filter((m) => m.guestId === me.id).length : 0,
      limit: state.settings.messagesPerGuest,
    },
  };
}

export function toAdminView(state: EventState, now: number, joinUrl: string): AdminView {
  return {
    ...base(state, now),
    joinUrl,
    guests: [...state.guests]
      .sort((a, b) => b.joinedAt - a.joinedAt)
      .map((g) => ({ guestId: g.id, displayName: g.displayName, joinedAt: new Date(g.joinedAt).toISOString() })),
    quizEditable: isQuizEditable(state),
    voting: { open: state.voting.open, tally: voteTally(state) },
    quiz: { ...quizRound(state), questions: state.quiz.questions },
    leaderboard: computeLeaderboard(state),
    messages: {
      open: state.messages.open,
      items: [...state.messages.items]
        .sort((a, b) => b.order - a.order)
        .map(toAdminMessage),
    },
    doctor: { status: state.doctor.status },
    reveal: { status: state.reveal.status },
  };
}

function toAdminMessage(m: MessageRecord): AdminMessage {
  return {
    id: m.id,
    guestId: m.guestId,
    displayName: m.displayName,
    text: m.text,
    submittedAt: new Date(m.submittedAt).toISOString(),
    approved: m.approved,
    hidden: m.hidden,
    removed: m.removed === true,
  };
}

const isoTime = (ms: number) => new Date(ms).toISOString();

/** The complete keepsake of an event: guests, votes, every quiz answer, scores and all messages. */
export function toEventExport(state: EventState, now: number): EventExport {
  const names = new Map(state.guests.map((g) => [g.id, g.displayName]));
  const nameOf = (guestId: string) => names.get(guestId) ?? '';
  return {
    format: 'our-little-universe/event-export',
    version: 1,
    eventId: state.eventId,
    eventName: state.eventName,
    exportedAt: isoTime(now),
    phase: state.phase,
    guests: [...state.guests]
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
      .map((g) => ({ guestId: g.id, displayName: g.displayName, joinedAt: isoTime(g.joinedAt) })),
    voting: {
      tally: voteTally(state),
      votes: Object.entries(state.voting.votes)
        .sort(([a, x], [b, y]) => x.castAt - y.castAt || a.localeCompare(b))
        .map(([guestId, vote]) => ({ guestId, displayName: nameOf(guestId), choice: vote.choice, castAt: isoTime(vote.castAt) })),
    },
    quiz: {
      questions: state.quiz.questions.map((question, index) => ({
        ...question,
        number: index + 1,
        scored: isScored(state, index),
        answers: Object.entries(state.quiz.answers[question.id] ?? {})
          .sort(([a, x], [b, y]) => x.answeredAt - y.answeredAt || a.localeCompare(b))
          .map(([guestId, answer]) => ({
            guestId,
            displayName: nameOf(guestId),
            optionIndex: answer.optionIndex,
            correct: answer.optionIndex === question.correctOptionIndex,
            answeredAt: isoTime(answer.answeredAt),
          })),
      })),
      leaderboard: computeLeaderboard(state),
    },
    messages: [...state.messages.items]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ ...toAdminMessage(m), order: m.order })),
  };
}
