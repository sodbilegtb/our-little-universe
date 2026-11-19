import { useCallback, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import type { GuestSession, GuestView } from '@olu/shared';
import { GuestShell } from '@/components/layout/GuestShell';
import { Scene } from '@/components/layout/Scene';
import { RegistrationScreen } from '@/features/registration/RegistrationScreen';
import { WaitingScreen } from '@/features/registration/WaitingScreen';
import { VoteScreen } from '@/features/voting/VoteScreen';
import { QuizGuestScreen } from '@/features/quiz/QuizGuestScreen';
import { MessageGuestScreen } from '@/features/messages/MessageGuestScreen';
import { RevealGuestScreen } from '@/features/reveal/RevealGuestScreen';
import { FinishedGuestScreen } from '@/features/finished/FinishedGuestScreen';
import { useGuestSession } from '@/hooks/useGuestSession';
import { useLiveView } from '@/hooks/useLiveView';
import { api } from '@/services/api';

/**
 * The guest phone. There is no navigation: the server's current phase decides
 * the one scene a guest sees, and every change crossfades into the next.
 */
export function PartyPage() {
  const { session, save, clear } = useGuestSession();
  const token = session?.sessionToken ?? null;
  const { data, refresh, status } = useLiveView(
    'guest',
    async () => ({ ...(await api.getGuestView(session)), requestedFor: token }),
    [token],
  );
  // Ignore a view fetched for a different session (e.g. the one from just before joining).
  const view = data && data.requestedFor === token ? data : null;

  // The server no longer recognises this session (e.g. the mock was reset): start over.
  useEffect(() => {
    if (session && view && view.me === null) clear();
  }, [session, view, clear]);

  const onJoined = useCallback((next: GuestSession) => save(next), [save]);
  const dim = view?.phase === 'REVEAL' ? 0.5 : 0;

  return (
    <GuestShell guestName={view?.me?.displayName ?? null} dim={dim} status={status}>
      <AnimatePresence mode="wait">
        {!view && (status === 'reconnecting' || status === 'offline') ? (
          <WaitingScreen
            key="connecting"
            title="Finding the party…"
            lead="We’ll connect as soon as your phone is back online."
          />
        ) : !view ? (
          <Scene key="loading" className="items-center justify-center">
            <span className="h-2 w-2 animate-twinkle rounded-full bg-champagne" aria-label="Loading" />
          </Scene>
        ) : (
          <GuestScene key={sceneKey(view, session)} view={view} session={session} onJoined={onJoined} onChanged={refresh} />
        )}
      </AnimatePresence>
    </GuestShell>
  );
}

function sceneKey(view: GuestView, session: GuestSession | null): string {
  if (view.phase === 'FINISHED') return 'finished';
  if (!session || !view.me) return 'register';
  if (view.phase === 'QUIZ') {
    const stage = view.quiz.stage === 'QUESTION_CLOSED' ? 'QUESTION_OPEN' : view.quiz.stage;
    return `quiz-${stage}-${view.quiz.questionNumber}`;
  }
  return view.phase;
}

interface GuestSceneProps {
  view: GuestView;
  session: GuestSession | null;
  onJoined: (session: GuestSession) => void;
  onChanged: () => void;
}

function GuestScene({ view, session, onJoined, onChanged }: GuestSceneProps) {
  if (view.phase === 'FINISHED') return <FinishedGuestScreen />;
  if (!session || !view.me) return <RegistrationScreen onJoined={onJoined} />;

  switch (view.phase) {
    case 'LOBBY':
      return <WaitingScreen title="You're in!" lead="The celebration will begin soon." footnote="Keep this page open. It changes on its own." />;
    case 'VOTING':
      return <VoteScreen view={view} session={session} onChanged={onChanged} />;
    case 'QUIZ':
      return <QuizGuestScreen view={view} session={session} onChanged={onChanged} />;
    case 'MESSAGES':
      return <MessageGuestScreen view={view} session={session} onChanged={onChanged} />;
    case 'REVEAL':
      return <RevealGuestScreen />;
  }
}
