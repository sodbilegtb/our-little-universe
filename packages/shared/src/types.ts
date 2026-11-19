import type { EventPhase } from './phases';

/**
 * API contract types. Each client role gets its own read model:
 * the guest view, the TV view and the admin view. None of them ever
 * contains the doctor's selection.
 */

/** A guest's prediction. This is never the actual result. */
export type VoteChoice = 'BOY' | 'GIRL';

export type QuizStage =
  | 'INTRO'
  | 'QUESTION_OPEN'
  | 'QUESTION_CLOSED'
  | 'ANSWER_REVEALED'
  | 'LEADERBOARD'
  | 'RESULTS';

export type DoctorStatus = 'NOT_STARTED' | 'LINK_ISSUED' | 'SUBMITTED' | 'CODE_SENT';

/** No status here can carry a result. REVEALED is set only after authorization (Milestone 7). */
export type RevealStatus = 'LOCKED' | 'AWAITING_CODE' | 'REVEALING' | 'REVEALED';

export type AnswerOptions = readonly [string, string, string, string];

/** Full question as the host configures it. Admin view only. */
export interface QuizQuestionConfig {
  id: string;
  text: string;
  options: AnswerOptions;
  correctOptionIndex: number;
  explanation?: string;
  timeLimitSec: number;
}

/** What guests and the TV may see of a question. No correct answer. */
export interface PublicQuizQuestion {
  id: string;
  text: string;
  options: AnswerOptions;
  timeLimitSec: number;
}

export interface QuizRoundView {
  stage: QuizStage;
  /** 1-based for display. */
  questionNumber: number;
  totalQuestions: number;
  question: PublicQuizQuestion | null;
  /** ISO timestamps from the server clock. */
  opensAt: string | null;
  closesAt: string | null;
  answeredCount: number;
  /** Only present once the host reveals the answer for this round. */
  correctOptionIndex: number | null;
  explanation: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  guestId: string;
  displayName: string;
  score: number;
  correctCount: number;
}

export interface VoteTally {
  boy: number;
  girl: number;
  total: number;
}

export interface MessageStar {
  id: string;
  /** Submission order, used to grow the constellation in sequence. */
  order: number;
  approved: boolean;
}

export interface PublicMessage {
  id: string;
  displayName: string;
  text: string;
}

export interface AdminMessage extends PublicMessage {
  guestId: string;
  submittedAt: string;
  approved: boolean;
  hidden: boolean;
  /** Removed by the host: off the TV and out of message exports, restorable. */
  removed: boolean;
}

export interface BaseEventView {
  eventId: string;
  eventName: string;
  revision: number;
  phase: EventPhase;
  serverTime: string;
  guestCount: number;
}

export interface TvView extends BaseEventView {
  joinUrl: string;
  voting: { open: boolean; tally: VoteTally };
  quiz: QuizRoundView;
  leaderboard: LeaderboardEntry[];
  messages: { open: boolean; stars: MessageStar[]; featured: PublicMessage[] };
  reveal: { status: RevealStatus };
}

export interface GuestSession {
  guestId: string;
  displayName: string;
  /** Opaque. In production this is an HttpOnly cookie or signed token. */
  sessionToken: string;
}

export interface GuestView extends BaseEventView {
  me: { guestId: string; displayName: string } | null;
  voting: { open: boolean; myVote: VoteChoice | null };
  quiz: QuizRoundView & { myAnswer: number | null; myScore: number; myRank: number | null };
  messages: { open: boolean; myCount: number; limit: number };
}

export interface AdminGuest {
  guestId: string;
  displayName: string;
  joinedAt: string;
}

export interface AdminView extends BaseEventView {
  joinUrl: string;
  guests: AdminGuest[];
  /** Questions can be edited until the quiz starts. */
  quizEditable: boolean;
  voting: { open: boolean; tally: VoteTally };
  quiz: QuizRoundView & { questions: QuizQuestionConfig[] };
  leaderboard: LeaderboardEntry[];
  messages: { open: boolean; items: AdminMessage[] };
  doctor: { status: DoctorStatus };
  reveal: { status: RevealStatus };
}

/**
 * Everything worth keeping from the evening, for the host to download and
 * archive before the cloud resources are removed. It holds no session tokens
 * and, like every other view, has no field that could carry the baby's gender.
 */
export interface EventExport {
  format: 'our-little-universe/event-export';
  version: 1;
  eventId: string;
  eventName: string;
  exportedAt: string;
  phase: EventPhase;
  guests: { guestId: string; displayName: string; joinedAt: string }[];
  voting: {
    tally: VoteTally;
    votes: { guestId: string; displayName: string; choice: VoteChoice; castAt: string }[];
  };
  quiz: {
    questions: (QuizQuestionConfig & {
      number: number;
      /** False for questions that were never opened or never closed. */
      scored: boolean;
      answers: { guestId: string; displayName: string; optionIndex: number; correct: boolean; answeredAt: string }[];
    })[];
    leaderboard: LeaderboardEntry[];
  };
  /** All messages in the order they were sent, including hidden and removed ones (flagged). */
  messages: (AdminMessage & { order: number })[];
}
