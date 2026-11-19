/**
 * Extension point for future TV-only audio. Nothing listens yet.
 *
 * The TV page announces each scene change here. A later milestone can attach
 * a music controller to these cues on the TV device only. Guest phones never
 * emit or receive cues.
 */
export type TvCue =
  | 'lobby'
  | 'voting'
  | 'quiz-intro'
  | 'quiz-question'
  | 'quiz-answer'
  | 'quiz-leaderboard'
  | 'quiz-results'
  | 'messages'
  | 'reveal-waiting'
  | 'finished';

export const TV_CUE_EVENT = 'olu:tv-cue';

export function emitTvCue(cue: TvCue): void {
  window.dispatchEvent(new CustomEvent<TvCue>(TV_CUE_EVENT, { detail: cue }));
}
