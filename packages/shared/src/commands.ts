import type { QuizQuestionConfig } from './types';

/**
 * Host commands. Each maps to one authorized admin endpoint in Milestone 3.
 * The server validates every command against the current phase.
 */
export type AdminCommand =
  | { type: 'START_VOTING' }
  | { type: 'CLOSE_VOTING' }
  | { type: 'START_QUIZ' }
  | { type: 'OPEN_QUESTION' }
  | { type: 'CLOSE_QUESTION' }
  | { type: 'REVEAL_ANSWER' }
  | { type: 'SHOW_LEADERBOARD' }
  | { type: 'NEXT_QUESTION' }
  | { type: 'FINISH_QUIZ' }
  | { type: 'START_MESSAGES' }
  | { type: 'CLOSE_MESSAGES' }
  | { type: 'START_REVEAL' }
  | { type: 'FINISH_EVENT' }
  | { type: 'SET_MESSAGE_APPROVAL'; messageId: string; approved: boolean }
  | { type: 'SET_MESSAGE_HIDDEN'; messageId: string; hidden: boolean }
  | { type: 'SET_MESSAGE_REMOVED'; messageId: string; removed: boolean }
  | { type: 'UPDATE_QUIZ_QUESTIONS'; questions: QuizQuestionConfig[] }
  | { type: 'SET_QUIZ_ENABLED'; enabled: boolean };

export type AdminCommandType = AdminCommand['type'];

export type DoctorChoice = 'BOY' | 'GIRL';

export interface ApiErrorBody {
  code:
    | 'INVALID_INPUT'
    | 'UNAUTHORIZED'
    | 'WRONG_PHASE'
    | 'ALREADY_SUBMITTED'
    | 'CLOSED'
    | 'NOT_FOUND'
    | 'INVALID_LINK'
    | 'LIMIT_REACHED'
    | 'LOCKED'
    | 'NOT_AVAILABLE'
    | 'RATE_LIMITED'
    | 'NETWORK';
  message: string;
}
