import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PHASE_LABELS, type AdminCommand, type AdminView } from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useSecondsLeft } from '@/components/ui/Countdown';
import { api, errorMessage } from '@/services/api';
import { ease } from '@/lib/motion';
import { actionsFor, type AdminAction } from './adminFlow';
import { useAdminSession } from './adminSession';

export function useAdminCommand(onDone: () => void) {
  const admin = useAdminSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Resolves true when the server accepted the command. */
  const run = async (command: AdminCommand): Promise<boolean> => {
    setBusy(command.type);
    setError(null);
    try {
      await api.sendAdminCommand(admin, command);
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(null);
      onDone();
    }
  };

  return { run, busy, error };
}

/** The one place the host looks: what is live now, and the next step. */
export function NowPanel({ view, onChanged }: { view: AdminView; onChanged: () => void }) {
  const { run, busy, error } = useAdminCommand(onChanged);
  const [pendingConfirm, setPendingConfirm] = useState<AdminAction | null>(null);
  const actions = actionsFor(view);
  const secondsLeft = useSecondsLeft(view.phase === 'QUIZ' && view.quiz.stage === 'QUESTION_OPEN' ? view.quiz.closesAt : null);

  const trigger = (action: AdminAction) => {
    if (action.confirm) setPendingConfirm(action);
    else void run(action.command);
  };

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-champagne/25 bg-plum/50 p-8 backdrop-blur-xl">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(216,189,139,0.22), transparent)' }}
      />
      <p className="relative text-sm text-champagne-soft">Live now</p>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${view.phase}-${view.quiz.stage}-${view.quiz.questionNumber}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.4, ease: ease.drift }}
          className="relative"
        >
          <h1 className="type-display mt-2 text-[3rem]">
            {PHASE_LABELS[view.phase]}
            {view.phase === 'QUIZ' && view.quiz.stage !== 'INTRO' && view.quiz.stage !== 'RESULTS' && (
              <span className="ml-4 text-[1.6rem] text-ivory/50">
                Question {view.quiz.questionNumber} of {view.quiz.totalQuestions}
              </span>
            )}
          </h1>
          <p className="mt-3 max-w-[60ch] text-ivory-dim">
            {actions.status}
            {secondsLeft !== null && (
              <span className="ml-2 tabular-nums text-ivory">
                {secondsLeft > 0 ? `${secondsLeft}s left.` : 'Time’s up. It closes on its own in a moment.'}
              </span>
            )}
          </p>
        </motion.div>
      </AnimatePresence>

      <div className="relative mt-8 flex flex-wrap items-center gap-3">
        {actions.primary && (
          <Button size="lg" loading={busy === actions.primary.command.type} onClick={() => trigger(actions.primary!)}>
            {actions.primary.label}
          </Button>
        )}
        {actions.secondary.map((action) => (
          <Button
            key={action.command.type}
            size="lg"
            variant="quiet"
            loading={busy === action.command.type}
            onClick={() => trigger(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="relative mt-4 text-danger">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.confirm?.title ?? ''}
        confirmLabel={pendingConfirm?.confirm?.confirmLabel ?? 'Confirm'}
        busy={busy !== null}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={async () => {
          if (!pendingConfirm) return;
          await run(pendingConfirm.command);
          setPendingConfirm(null);
        }}
      >
        {pendingConfirm?.confirm?.body}
      </ConfirmDialog>
    </section>
  );
}
