import { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import type { TvView } from '@olu/shared';
import { SkyBackdrop } from '@/components/sky/SkyBackdrop';
import { TvStage } from '@/components/layout/TvStage';
import { TvLobby } from '@/features/tv/TvLobby';
import { TvVoting } from '@/features/tv/TvVoting';
import { TvQuiz } from '@/features/tv/TvQuiz';
import { TvMessages } from '@/features/tv/TvMessages';
import { TvRevealWaiting } from '@/features/tv/TvReveal';
import { TvFinished } from '@/features/tv/TvFinished';
import { useLiveView } from '@/hooks/useLiveView';
import { ConnectionNotice } from '@/components/ui/ConnectionNotice';
import { api } from '@/services/api';
import { emitTvCue, type TvCue } from '@/lib/tvCues';

function sceneFor(view: TvView): { key: string; cue: TvCue } {
  switch (view.phase) {
    case 'LOBBY':
      return { key: 'lobby', cue: 'lobby' };
    case 'VOTING':
      return { key: 'voting', cue: 'voting' };
    case 'QUIZ': {
      const { stage, questionNumber } = view.quiz;
      if (stage === 'INTRO') return { key: 'quiz-intro', cue: 'quiz-intro' };
      if (stage === 'LEADERBOARD') return { key: `quiz-board-${questionNumber}`, cue: 'quiz-leaderboard' };
      if (stage === 'RESULTS') return { key: 'quiz-results', cue: 'quiz-results' };
      // Open, closed and revealed share one scene so the answer lights up in place.
      return { key: `quiz-q-${questionNumber}`, cue: stage === 'ANSWER_REVEALED' ? 'quiz-answer' : 'quiz-question' };
    }
    case 'MESSAGES':
      return { key: 'messages', cue: 'messages' };
    case 'REVEAL':
      return { key: 'reveal', cue: 'reveal-waiting' };
    case 'FINISHED':
      return { key: 'finished', cue: 'finished' };
  }
}

/** Fullscreen presentation client. No controls, no debug output. */
export function TvPage() {
  const { data: view, status } = useLiveView('tv', () => api.getTvView());
  const scene = view ? sceneFor(view) : null;

  useEffect(() => {
    if (scene) emitTvCue(scene.cue);
  }, [scene?.cue]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cursor-none select-none">
      <SkyBackdrop variant="tv" dim={view?.phase === 'REVEAL' ? 0.45 : 0} />
      <TvStage>
        <AnimatePresence mode="wait">
          {view && scene && <TvSceneSwitch key={scene.key} view={view} />}
        </AnimatePresence>
        <ConnectionNotice status={status} variant="tv" />
      </TvStage>
    </div>
  );
}

function TvSceneSwitch({ view }: { view: TvView }) {
  switch (view.phase) {
    case 'LOBBY':
      return <TvLobby view={view} />;
    case 'VOTING':
      return <TvVoting view={view} />;
    case 'QUIZ':
      return <TvQuiz view={view} />;
    case 'MESSAGES':
      return <TvMessages view={view} />;
    case 'REVEAL':
      return <TvRevealWaiting />;
    case 'FINISHED':
      return <TvFinished view={view} />;
  }
}
