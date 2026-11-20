/**
 * The reveal sequence, laid out around the server's `revealAt` (R). Every
 * stage is defined by its distance to R, so any TV, including one refreshed
 * mid-sequence, shows the same moment as long as its clock is synced.
 *
 *   hush       from the host's code until R-21s   the code decodes on screen, then dissolves into stars
 *   gather     R-21s .. R-11s                     stars converge, a heart of light forms
 *   tension    R-11s .. R-5s                      the heart beats faster, then folds into one point
 *   countdown  R-5s  .. R                         5, 4, 3, 2, 1
 *   pause      R     .. R+1.2s (or until the result has arrived)   a breath of darkness
 *   burst      R+1.2s .. R+9s                     light, colour, confetti, the words
 *   celebrate  from R+9s                          the celebration settles
 *
 * The result is requested from R on, never before. Without it the sequence
 * waits in `pause`, however long that takes.
 */

export type RevealStage = 'hush' | 'gather' | 'tension' | 'countdown' | 'pause' | 'burst' | 'celebrate';

export const STAGE_STARTS: Record<Exclude<RevealStage, 'hush'>, number> = {
  gather: -21_000,
  tension: -11_000,
  countdown: -5_000,
  pause: 0,
  burst: 1_200,
  celebrate: 9_000,
};

/** A TV that comes back this long after the burst skips straight to the celebration. */
export const LATE_JOIN_MS = 15_000;

export interface StageInfo {
  stage: RevealStage;
  /** 5..1 during the countdown, otherwise null. */
  digit: number | null;
  /** When (server ms) this answer next changes, or null if only the result can move it on. */
  nextChangeAt: number | null;
}

export function revealStage(now: number, revealAt: number, hasResult: boolean): StageInfo {
  const t = now - revealAt;
  if (t < STAGE_STARTS.gather) return { stage: 'hush', digit: null, nextChangeAt: revealAt + STAGE_STARTS.gather };
  if (t < STAGE_STARTS.tension) return { stage: 'gather', digit: null, nextChangeAt: revealAt + STAGE_STARTS.tension };
  if (t < STAGE_STARTS.countdown) return { stage: 'tension', digit: null, nextChangeAt: revealAt + STAGE_STARTS.countdown };
  if (t < 0) {
    const digit = Math.ceil(-t / 1000);
    return { stage: 'countdown', digit, nextChangeAt: revealAt - (digit - 1) * 1000 };
  }
  if (!hasResult) return { stage: 'pause', digit: null, nextChangeAt: null };
  if (t < STAGE_STARTS.burst) return { stage: 'pause', digit: null, nextChangeAt: revealAt + STAGE_STARTS.burst };
  if (t < STAGE_STARTS.celebrate) return { stage: 'burst', digit: null, nextChangeAt: revealAt + STAGE_STARTS.celebrate };
  return { stage: 'celebrate', digit: null, nextChangeAt: null };
}

/** Milliseconds left in a stage that runs from `start` to `end` (relative to R), clamped to at least `min`. */
export function remainingMs(now: number, revealAt: number, endOffset: number, min = 300): number {
  return Math.max(min, revealAt + endOffset - now);
}
