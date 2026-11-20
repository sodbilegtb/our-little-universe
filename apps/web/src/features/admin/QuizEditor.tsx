import { useEffect, useId, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Lock, Save, SkipForward, Undo2 } from 'lucide-react';
import {
  QUIZ_TIME_LIMITS,
  quizConfigSchema,
  quizQuestionConfigSchema,
  type AdminView,
  type AnswerOptions,
  type QuizQuestionConfig,
} from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Pill } from '@/components/ui/Pill';
import { OPTION_LETTERS } from '@/features/quiz/ordinal';
import { cn } from '@/lib/cn';
import { ease } from '@/lib/motion';
import { Panel } from './Panel';
import { useAdminCommand } from './NowPanel';

type FieldErrors = Record<string, string>;

/** Turns Zod issues for one question into messages keyed by field ("text", "options.2", ...). */
function questionErrors(question: QuizQuestionConfig): FieldErrors {
  const result = quizQuestionConfigSchema.safeParse(question);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    errors[key] ??= issue.message;
  }
  return errors;
}

const fieldClass =
  'w-full rounded-xl border bg-night-deep/60 px-3.5 py-2.5 text-ivory outline-none transition-colors ' +
  'placeholder:text-mist/50 focus:border-champagne/60 disabled:opacity-60';

/**
 * Edit all ten Mom vs. Dad questions. Changes are validated locally, saved in
 * one command and validated again on the server. Locked once the quiz starts.
 */
export function QuizEditor({ view, onChanged }: { view: AdminView; onChanged: () => void }) {
  const { run, busy, error } = useAdminCommand(onChanged);
  const saved = view.quiz.questions;
  const [draft, setDraft] = useState<QuizQuestionConfig[]>(saved);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const locked = !view.quizEditable;

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  // Follow the server while there are no local edits (e.g. another host tab saved).
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(saved)]);

  const errorsById = useMemo(() => Object.fromEntries(draft.map((q) => [q.id, questionErrors(q)])), [draft]);
  const invalidCount = Object.values(errorsById).filter((e) => Object.keys(e).length > 0).length;
  const quizLevel = quizConfigSchema.safeParse(draft);
  const quizLevelError = invalidCount === 0 && !quizLevel.success ? quizLevel.error.issues[0]?.message : undefined;

  const update = (id: string, patch: Partial<QuizQuestionConfig>) => {
    setJustSaved(false);
    setDraft((questions) => questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const save = async () => {
    setShowErrors(true);
    if (!quizLevel.success) {
      const firstInvalid = draft.find((q) => Object.keys(errorsById[q.id] ?? {}).length > 0);
      if (firstInvalid) setOpenId(firstInvalid.id);
      return;
    }
    const ok = await run({ type: 'UPDATE_QUIZ_QUESTIONS', questions: quizLevel.data });
    if (ok) {
      setShowErrors(false);
      setJustSaved(true);
    }
  };

  if (!view.quizEnabled) {
    return (
      <Panel title="Mom vs. Dad quiz" aside={<Pill tone="lavender">Skipped tonight</Pill>}>
        <p className="max-w-[70ch] text-sm leading-relaxed text-mist">
          After voting, the evening goes straight to messages for baby. Your questions are kept.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        {!locked && (
          <Button
            className="mt-4"
            variant="quiet"
            size="sm"
            align="start"
            loading={busy === 'SET_QUIZ_ENABLED'}
            onClick={() => void run({ type: 'SET_QUIZ_ENABLED', enabled: true })}
          >
            Bring the quiz back
          </Button>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      title="Mom vs. Dad questions"
      aside={
        locked ? (
          <Pill tone="lavender">
            <Lock className="h-3 w-3" aria-hidden /> Locked during the quiz
          </Pill>
        ) : (
          <div className="flex items-center gap-2">
            {dirty && <Pill tone="champagne">Unsaved changes</Pill>}
            {!dirty && justSaved && <Pill tone="sage">Saved</Pill>}
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || busy !== null}
              icon={<Undo2 className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setDraft(saved);
                setShowErrors(false);
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              disabled={!dirty}
              loading={busy === 'UPDATE_QUIZ_QUESTIONS'}
              icon={<Save className="h-4 w-4" aria-hidden />}
              onClick={save}
            >
              Save quiz
            </Button>
          </div>
        )
      }
    >
      <p className="mb-5 max-w-[70ch] text-sm leading-relaxed text-mist">
        {locked
          ? 'The quiz has started, so the questions can no longer change.'
          : 'These start as examples. Replace them with your own questions and set the answers you two agree on. Guests never see the correct answer until you reveal it. Questions lock when the quiz starts.'}
      </p>

      {(error || (showErrors && (invalidCount > 0 || quizLevelError))) && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error ??
            quizLevelError ??
            `${invalidCount} ${invalidCount === 1 ? 'question needs' : 'questions need'} attention before saving.`}
        </p>
      )}

      <ol className="grid gap-2">
        {draft.map((question, index) => (
          <QuestionRow
            key={question.id}
            number={index + 1}
            question={question}
            open={openId === question.id}
            locked={locked}
            errors={showErrors ? (errorsById[question.id] ?? {}) : {}}
            onToggle={() => setOpenId((current) => (current === question.id ? null : question.id))}
            onChange={(patch) => update(question.id, patch)}
          />
        ))}
      </ol>

      {!locked && (
        <div className="mt-5 flex justify-end">
          <Button variant="quiet" size="sm" icon={<SkipForward className="h-4 w-4" aria-hidden />} onClick={() => setConfirmSkip(true)}>
            Skip the quiz tonight
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmSkip}
        title="Skip the quiz tonight?"
        confirmLabel="Skip the quiz"
        busy={busy === 'SET_QUIZ_ENABLED'}
        onCancel={() => setConfirmSkip(false)}
        onConfirm={async () => {
          await run({ type: 'SET_QUIZ_ENABLED', enabled: false });
          setConfirmSkip(false);
        }}
      >
        <p>
          After voting, the evening goes straight to messages for baby. Your questions are kept, and you can bring the
          quiz back until the messages start.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}

interface QuestionRowProps {
  number: number;
  question: QuizQuestionConfig;
  open: boolean;
  locked: boolean;
  errors: FieldErrors;
  onToggle: () => void;
  onChange: (patch: Partial<QuizQuestionConfig>) => void;
}

function QuestionRow({ number, question, open, locked, errors, onToggle, onChange }: QuestionRowProps) {
  const id = useId();
  const hasErrors = Object.keys(errors).length > 0;

  const setOption = (index: number, value: string) => {
    const options = [...question.options] as [string, string, string, string];
    options[index] = value;
    onChange({ options: options as AnswerOptions });
  };

  return (
    <li
      className={cn(
        'rounded-2xl border transition-colors',
        open ? 'bg-night/50' : 'hover:bg-ivory/[0.03]',
        hasErrors ? 'border-danger/40' : open ? 'border-ivory/15' : 'border-transparent',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="flex w-full items-center gap-4 px-4 py-3 text-left"
      >
        <span className={cn('w-6 tabular-nums', hasErrors ? 'text-danger' : 'text-mist')}>{number}</span>
        <span className={cn('flex-1 truncate', question.text.trim() ? 'text-ivory' : 'text-mist italic')}>
          {question.text.trim() || 'Untitled question'}
        </span>
        <span className="hidden text-sm text-mist sm:inline">{question.options[question.correctOptionIndex]}</span>
        <span className="w-10 text-right text-sm tabular-nums text-mist">{question.timeLimitSec}s</span>
        <ChevronDown className={cn('h-4 w-4 text-mist transition-transform duration-300', open && 'rotate-180')} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-body`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: ease.drift }}
            className="overflow-hidden"
          >
            <fieldset disabled={locked} className="grid gap-5 px-4 pb-5 pt-1 lg:grid-cols-[1.2fr_1fr]">
              <div className="grid content-start gap-4">
                <label className="grid gap-1.5">
                  <span className="text-sm text-ivory-dim">Question</span>
                  <input
                    className={cn(fieldClass, errors.text ? 'border-danger/60' : 'border-ivory/12')}
                    value={question.text}
                    maxLength={170}
                    onChange={(event) => onChange({ text: event.target.value })}
                  />
                  {errors.text && <span className="text-sm text-danger">{errors.text}</span>}
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm text-ivory-dim">
                    Note for the TV after the reveal <span className="text-mist">(optional)</span>
                  </span>
                  <textarea
                    className={cn(fieldClass, 'min-h-20 resize-y', errors.explanation ? 'border-danger/60' : 'border-ivory/12')}
                    value={question.explanation ?? ''}
                    maxLength={250}
                    placeholder="A little story behind the answer"
                    onChange={(event) => onChange({ explanation: event.target.value || undefined })}
                  />
                  {errors.explanation && <span className="text-sm text-danger">{errors.explanation}</span>}
                </label>

                <div className="grid gap-1.5">
                  <span className="text-sm text-ivory-dim" id={`${id}-time`}>
                    Time to answer
                  </span>
                  <div role="radiogroup" aria-labelledby={`${id}-time`} className="flex flex-wrap gap-1.5">
                    {QUIZ_TIME_LIMITS.map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        role="radio"
                        aria-checked={question.timeLimitSec === seconds}
                        onClick={() => onChange({ timeLimitSec: seconds })}
                        className={cn(
                          'h-9 min-w-12 rounded-full border px-3 text-sm tabular-nums transition-colors',
                          question.timeLimitSec === seconds
                            ? 'border-champagne bg-champagne text-night'
                            : 'border-ivory/12 text-ivory-dim hover:border-ivory/30',
                        )}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid content-start gap-2" role="radiogroup" aria-label={`Answers for question ${number}`}>
                <span className="text-sm text-ivory-dim">Answers, with the correct one selected</span>
                {question.options.map((option, index) => {
                  const correct = question.correctOptionIndex === index;
                  const optionError = errors[`options.${index}`];
                  return (
                    <div key={index}>
                      <div
                        className={cn(
                          'flex items-center gap-2 rounded-xl border pl-1.5 transition-colors',
                          correct && 'bg-champagne/[0.07]',
                          optionError ? 'border-danger/60' : correct ? 'border-champagne/50' : 'border-ivory/10',
                        )}
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={correct}
                          aria-label={`Mark answer ${OPTION_LETTERS[index]} as correct`}
                          onClick={() => onChange({ correctOptionIndex: index })}
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors',
                            correct ? 'border-champagne bg-champagne text-night' : 'border-ivory/20 text-ivory-dim hover:border-ivory/40',
                          )}
                        >
                          {OPTION_LETTERS[index]}
                        </button>
                        <input
                          className="h-11 w-full bg-transparent pr-3 text-ivory outline-none placeholder:text-mist/50"
                          value={option}
                          maxLength={60}
                          aria-label={`Answer ${OPTION_LETTERS[index]}`}
                          placeholder={`Answer ${OPTION_LETTERS[index]}`}
                          onChange={(event) => setOption(index, event.target.value)}
                        />
                      </div>
                      {optionError && <p className="mt-1 text-sm text-danger">{optionError}</p>}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
