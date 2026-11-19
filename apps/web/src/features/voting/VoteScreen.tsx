import { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import type { GuestSession, GuestView, VoteChoice } from '@olu/shared';
import { GuestTitle, Rise, Scene } from '@/components/layout/Scene';
import { RisingParticles } from '@/components/celebration/RisingParticles';
import { WaitingScreen } from '@/features/registration/WaitingScreen';
import { api, ApiError } from '@/services/api';
import { withRetry } from '@/services/sync/retry';
import { actionErrorMessage } from '@/lib/actionError';
import { cn } from '@/lib/cn';
import { ease } from '@/lib/motion';

/** Display order and labels. Both options are styled identically. */
export const VOTE_OPTIONS: { choice: VoteChoice; label: string }[] = [
  { choice: 'BOY', label: 'Boy' },
  { choice: 'GIRL', label: 'Girl' },
];

const labelFor = (choice: VoteChoice) => VOTE_OPTIONS.find((o) => o.choice === choice)?.label ?? '';

interface VoteScreenProps {
  view: GuestView;
  session: GuestSession;
  onChanged: () => void;
}

export function VoteScreen({ view, session, onChanged }: VoteScreenProps) {
  const [pending, setPending] = useState<VoteChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = view.voting.myVote ?? pending;

  if (!view.voting.open && !view.voting.myVote) {
    return (
      <WaitingScreen title="Voting has closed" lead="The next part of the celebration is about to begin." />
    );
  }

  const vote = async (choice: VoteChoice) => {
    if (chosen) return;
    setPending(choice);
    setError(null);
    try {
      await withRetry(() => api.castVote(session, { choice }));
    } catch (reason) {
      if (!(reason instanceof ApiError && reason.code === 'ALREADY_SUBMITTED')) {
        setPending(null);
        setError(actionErrorMessage(reason));
      }
    } finally {
      onChanged();
    }
  };

  return (
    <Scene className="py-8">
      <LayoutGroup>
        <AnimatePresence mode="popLayout" initial={false}>
          {!chosen ? (
            <motion.div key="ask" exit={{ opacity: 0, transition: { duration: 0.25 } }}>
              <GuestTitle title="What's your guess?" lead="Tap the one you feel in your heart." />
            </motion.div>
          ) : (
            <motion.div
              key="thanks"
              className="text-center"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.55, duration: 0.8, ease: ease.drift } }}
            >
              <h1 className="type-display text-[2.6rem]">Your vote is in!</h1>
              <p className="mt-4 text-[1.08rem] text-ivory-dim">Watch the big screen for live results.</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={cn('mt-10 flex flex-1 items-center', chosen ? 'justify-center' : 'justify-between gap-4')}>
          {VOTE_OPTIONS.map(({ choice, label }) => {
            const isChosen = chosen === choice;
            if (chosen && !isChosen) return null;
            return (
              <motion.button
                key={choice}
                layoutId={`vote-${choice}`}
                type="button"
                disabled={Boolean(chosen)}
                onClick={() => vote(choice)}
                aria-label={`Vote ${label}`}
                transition={{ layout: { duration: 0.75, ease: ease.settle } }}
                whileTap={chosen ? undefined : { scale: 0.97 }}
                className={cn(
                  'veil relative flex flex-col items-center justify-center overflow-visible rounded-[2rem] text-ivory',
                  'transition-[border-color,box-shadow] duration-500 disabled:cursor-default',
                  isChosen
                    ? 'aspect-[3/4] w-[72%] border-champagne/60 shadow-[0_0_80px_-10px_rgba(216,189,139,0.55)]'
                    : 'aspect-[3/4.4] flex-1 hover:border-ivory/25',
                )}
              >
                <span className="pointer-events-none absolute inset-3 rounded-[1.5rem] border border-ivory/[0.06]" />
                <motion.span layout="position" className="mb-5 block h-2 w-2 rounded-full bg-champagne-soft shadow-[0_0_16px_5px_rgba(216,189,139,0.45)]" />
                <motion.span layout="position" className={cn('type-display', isChosen ? 'text-[3.6rem]' : 'text-[2.6rem]')}>
                  {label}
                </motion.span>
                {isChosen && <RisingParticles burstKey={choice} count={22} rise={260} />}
              </motion.button>
            );
          })}
        </div>

        {chosen && (
          <motion.p
            className="mt-6 text-center text-sm text-mist"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 1.1 } }}
          >
            You guessed {labelFor(chosen)}. One vote per guest.
          </motion.p>
        )}
        {error && (
          <Rise className="mt-6 text-center text-danger">
            <p role="alert">{error}</p>
          </Rise>
        )}
      </LayoutGroup>
    </Scene>
  );
}
