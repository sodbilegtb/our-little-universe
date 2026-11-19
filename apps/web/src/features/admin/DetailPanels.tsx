import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Eye, EyeOff, Trash2, Check, KeyRound, RotateCcw } from 'lucide-react';
import { revealCodeSchema, type AdminMessage, type AdminView } from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Pill } from '@/components/ui/Pill';
import { api, errorMessage } from '@/services/api';
import { cn } from '@/lib/cn';
import { OPTION_LETTERS } from '@/features/quiz/ordinal';
import { VOTE_OPTIONS } from '@/features/voting/VoteScreen';
import { Panel } from './Panel';
import { useAdminCommand } from './NowPanel';
import { useAdminSession } from './adminSession';
import { downloadFile, messagesToCsv, messagesToJson } from './exportMessages';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function GuestsPanel({ view }: { view: AdminView }) {
  return (
    <Panel title="Guests" aside={<span className="text-sm text-mist">{view.guests.length} joined</span>}>
      <ul className="flex flex-wrap gap-2">
        {view.guests.map((guest) => (
          <li key={guest.guestId} className="rounded-full border border-ivory/10 px-3 py-1.5 text-sm text-ivory-dim">
            {guest.displayName}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function VotingPanel({ view }: { view: AdminView }) {
  const { tally } = view.voting;
  const values = { BOY: tally.boy, GIRL: tally.girl };
  return (
    <Panel
      title="Guest predictions"
      aside={<span className="text-sm text-mist">{tally.total} of {view.guestCount} voted</span>}
    >
      <div className="grid gap-4">
        {VOTE_OPTIONS.map(({ choice, label }) => {
          const share = tally.total ? values[choice] / tally.total : 0;
          return (
            <div key={choice} className="grid grid-cols-[4rem_1fr_3.5rem] items-center gap-4">
              <span className="text-ivory-dim">{label}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-ivory/[0.06]">
                <motion.div
                  className="h-full rounded-full bg-champagne/80"
                  animate={{ width: `${share * 100}%` }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <span className="text-right tabular-nums">{values[choice]}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-sm text-mist">These are guesses from guests. They never depend on the doctor's answer.</p>
    </Panel>
  );
}

export function QuizPanel({ view }: { view: AdminView }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const question = view.quiz.questions[view.quiz.questionNumber - 1];

  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
      <Panel
        title={`Question ${view.quiz.questionNumber}`}
        aside={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAnswer((v) => !v)}
            icon={showAnswer ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          >
            {showAnswer ? 'Hide answer' : 'Show answer'}
          </Button>
        }
      >
        {question && (
          <>
            <p className="type-display text-[1.7rem] leading-tight">{question.text}</p>
            <ol className="mt-5 grid gap-2">
              {question.options.map((option, index) => {
                const correct = showAnswer && index === question.correctOptionIndex;
                return (
                  <li
                    key={option + index}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
                      correct ? 'border-champagne/50 bg-champagne/10' : 'border-ivory/[0.08]',
                    )}
                  >
                    <span className="w-5 text-sm text-mist">{OPTION_LETTERS[index]}</span>
                    <span className="flex-1">{option}</span>
                    {correct && <Check className="h-4 w-4 text-champagne" aria-label="Correct answer" />}
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 text-sm text-mist">
              {view.quiz.answeredCount} of {view.guestCount} answered. {question.timeLimitSec}s per question.
            </p>
          </>
        )}
      </Panel>
      <Panel title="Standings">
        <ol className="grid gap-1.5">
          {view.leaderboard.slice(0, 8).map((entry) => (
            <li key={entry.guestId} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span className={cn('w-6 tabular-nums', entry.rank === 1 ? 'text-champagne' : 'text-mist')}>{entry.rank}</span>
              <span className="flex-1 truncate">{entry.displayName}</span>
              <span className="tabular-nums text-ivory-dim">{entry.score}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

export function MessagesPanel({ view, onChanged }: { view: AdminView; onChanged: () => void }) {
  const { run, busy } = useAdminCommand(onChanged);
  const [toRemove, setToRemove] = useState<AdminMessage | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const items = view.messages.items.filter((m) => !m.removed);
  const removed = view.messages.items.filter((m) => m.removed);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Panel
      title="Messages for baby"
      aside={
        <div className="flex gap-2">
          <Button
            variant="quiet"
            size="sm"
            disabled={items.length === 0}
            icon={<Download className="h-4 w-4" aria-hidden />}
            onClick={() => downloadFile(`baby-messages-${stamp}.json`, messagesToJson(items, view.eventId), 'application/json')}
          >
            JSON
          </Button>
          <Button
            variant="quiet"
            size="sm"
            disabled={items.length === 0}
            icon={<Download className="h-4 w-4" aria-hidden />}
            onClick={() => downloadFile(`baby-messages-${stamp}.csv`, messagesToCsv(items), 'text/csv;charset=utf-8')}
          >
            CSV
          </Button>
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-mist">
          {view.phase === 'MESSAGES' ? 'No messages yet. They appear here as guests send them.' : 'Messages open after the quiz.'}
        </p>
      ) : (
        <ul className="grid gap-3">
          <AnimatePresence initial={false}>
            {items.map((message) => (
              <motion.li
                key={message.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: message.hidden ? 0.45 : 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-2xl border border-ivory/[0.08] bg-night/40 p-4"
              >
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-medium text-ivory">{message.displayName}</span>
                  <span className="text-mist">{timeFormat.format(new Date(message.submittedAt))}</span>
                  {message.approved && !message.hidden && <Pill tone="sage">On TV</Pill>}
                  {message.hidden && <Pill>Hidden</Pill>}
                </div>
                <p className="mt-2 whitespace-pre-line break-words text-ivory-dim">{message.text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant={message.approved ? 'ghost' : 'quiet'}
                    size="sm"
                    disabled={busy !== null || message.hidden}
                    onClick={() => run({ type: 'SET_MESSAGE_APPROVAL', messageId: message.id, approved: !message.approved })}
                  >
                    {message.approved ? 'Remove from TV' : 'Show on TV'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => run({ type: 'SET_MESSAGE_HIDDEN', messageId: message.id, hidden: !message.hidden })}
                  >
                    {message.hidden ? 'Unhide' : 'Hide'}
                  </Button>
                  <Button
                    variant="ghostDanger"
                    size="sm"
                    disabled={busy !== null}
                    icon={<Trash2 className="h-4 w-4" aria-hidden />}
                    onClick={() => setToRemove(message)}
                  >
                    Remove
                  </Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {removed.length > 0 && (
        <div className="mt-5 border-t border-ivory/[0.08] pt-4">
          <button
            type="button"
            aria-expanded={showRemoved}
            onClick={() => setShowRemoved((open) => !open)}
            className="rounded-lg text-sm text-mist underline-offset-4 hover:text-ivory-dim hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-champagne"
          >
            {showRemoved ? 'Hide removed messages' : `Removed messages (${removed.length})`}
          </button>
          {showRemoved && (
            <ul className="mt-3 grid gap-2">
              {removed.map((message) => (
                <li key={message.id} className="flex items-start gap-3 rounded-2xl border border-dashed border-ivory/10 p-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-medium text-ivory-dim">{message.displayName}</span>
                    <p className="mt-1 whitespace-pre-line break-words text-mist">{message.text}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    icon={<RotateCcw className="h-4 w-4" aria-hidden />}
                    onClick={() => run({ type: 'SET_MESSAGE_REMOVED', messageId: message.id, removed: false })}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmDialog
        open={toRemove !== null}
        tone="danger"
        title="Remove this message?"
        confirmLabel="Remove message"
        busy={busy !== null}
        onCancel={() => setToRemove(null)}
        onConfirm={async () => {
          if (!toRemove) return;
          await run({ type: 'SET_MESSAGE_REMOVED', messageId: toRemove.id, removed: true });
          setToRemove(null);
        }}
      >
        It leaves the TV and the message exports. You can bring it back from “Removed messages” below the list.
      </ConfirmDialog>
    </Panel>
  );
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function RevealPanel({ view, onChanged }: { view: AdminView; onChanged: () => void }) {
  const admin = useAdminSession();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ accepted: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const formatted = revealCodeSchema.safeParse(code);

  const submit = async () => {
    setBusy(true);
    try {
      const outcome = await api.submitRevealCode(admin, code);
      setResult(outcome);
      if (outcome.accepted) onChanged();
    } catch (error) {
      setResult({ accepted: false, message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  if (view.reveal.status === 'REVEALING' || view.reveal.status === 'REVEALED') {
    return (
      <Panel title="Official reveal code">
        <p role="status" className="flex items-center gap-2.5 text-sage">
          <Check className="h-5 w-5" aria-hidden />
          The code was accepted. The reveal is on the TV now.
        </p>
        {view.reveal.revealAt && (
          <p className="mt-3 text-ivory-dim">
            {view.reveal.status === 'REVEALED'
              ? 'The secret is out.'
              : `The TV shows the answer at ${clockFormat.format(new Date(view.reveal.revealAt))}.`}
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Official reveal code">
      <p className="text-ivory-dim">
        Enter the code from the email titled “OFFICIAL BABY REVEAL CODE”. The TV starts the reveal once the server
        accepts it.
      </p>
      <form
        className="mt-6 flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="reveal-code">
          Reveal code
        </label>
        <input
          id="reveal-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setResult(null);
          }}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          maxLength={16}
          className="h-14 w-[19rem] rounded-2xl border border-ivory/15 bg-night-deep/60 px-5 text-center font-mono text-[1.35rem] tracking-[0.22em] text-ivory outline-none placeholder:text-mist/50 focus:border-champagne/70"
        />
        <Button size="lg" type="submit" loading={busy} disabled={!formatted.success} icon={<KeyRound className="h-4 w-4" aria-hidden />}>
          Unlock the reveal
        </Button>
      </form>
      {result && (
        <p role="status" className={cn('mt-4', result.accepted ? 'text-sage' : 'text-ivory-dim')}>
          {result.message}
        </p>
      )}
    </Panel>
  );
}
