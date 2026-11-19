import type { LeaderboardEntry } from './types';

export interface ScoreRecord {
  guestId: string;
  displayName: string;
  joinedAt: number;
  score: number;
  correctCount: number;
  /** Sum of response times (ms) for correct answers. Lower is faster. */
  correctResponseMs: number;
}

/**
 * Deterministic ranking. Order of precedence:
 * 1. Higher score
 * 2. Faster total response time on correct answers
 * 3. Earlier registration
 * 4. Guest id (a final, stable tiebreak)
 *
 * Every entry gets a unique rank, so there is always exactly one winner.
 */
export function rankLeaderboard(records: readonly ScoreRecord[]): LeaderboardEntry[] {
  return [...records]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.correctResponseMs - b.correctResponseMs ||
        a.joinedAt - b.joinedAt ||
        a.guestId.localeCompare(b.guestId),
    )
    .map((record, position) => ({
      rank: position + 1,
      guestId: record.guestId,
      displayName: record.displayName,
      score: record.score,
      correctCount: record.correctCount,
    }));
}

export const POINTS_PER_CORRECT_ANSWER = 100;
