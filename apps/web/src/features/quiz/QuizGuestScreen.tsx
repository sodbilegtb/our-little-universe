import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, X } from 'lucide-react';
import { POINTS_PER_CORRECT_ANSWER, type GuestSession, type GuestView } from '@olu/shared';
import { GuestTitle, Rise, Scene } from '@/components/layout/Scene';
import { CountdownLine, useSecondsLeft } from '@/components/ui/Countdown';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Confetti } from '@/components/celebration/Confetti';
import { WaitingScreen } from '@/features/registration/WaitingScreen';
import { api, ApiError } from '@/services/api';
import { withRetry } from '@/services/sync/retry';
import { actionErrorMessage } from '@/lib/actionError';
import { cn } from '@/lib/cn';
import { ease } from '@/lib/motion';
import { OPTION_LETTERS, ordinal } from './ordinal';

interface QuizGuestScreenProps {
  view: GuestView;
  session: GuestSession;
  onChanged: () => void;
}

export function QuizGuestScreen({ view, session, onChanged }: QuizGuestScreenProps) {
  const { quiz } = view;

  switch (quiz.stage) {
    case 'INTRO':
      return (
        <WaitingScreen
          title="Mom vs. Dad"
          lead={`${quiz.totalQuestions} questions about the two of us. Keep your phone close.`}
          footnote="The first question is coming up."
        />
      );
    case 'QUESTION_OPEN':
    case 'QUESTION_CLOSED':
      return <QuestionScene key={quiz.question?.id} view={view} session={session} onChanged={onChanged} />;
    case 'ANSWER_REVEALED':
      return <AnswerScene key={quiz.question?.id} view={view} />;
    case 'LEADERBOARD':
      return (
        <StandingScene
          title={quiz.myRank ? `You're in ${ordinal(quiz.myRank)} place` : 'Standings are on the big screen'}
          score={quiz.myScore}
          lead={`After ${quiz.questionNumber} of ${quiz.totalQuestions} questions.`}
        />
      );
    case 'RESULTS':
      return <ResultsScene view={view} />;
  }
}

function QuestionScene({ view, session, onChanged }: QuizGuestScreenProps) {
  const { quiz } = view;
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = useSecondsLeft(quiz.closesAt);
  const question = quiz.question;
  if (!question) return null;

  const selected = quiz.myAnswer ?? pending;
  const timeUp = quiz.stage === 'QUESTION_CLOSED' || secondsLeft === 0;
  const locked = selected !== null || timeUp;

  const answer = async (optionIndex: number) => {
    if (locked) return;
    setPending(optionIndex);
    setError(null);
    try {
      await withRetry(() => api.submitQuizAnswer(session, { questionId: question.id, optionIndex }), 3, 400);
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
    <Scene className="py-6">
      <Rise>
        <div className="flex items-baseline justify-between text-sm text-mist">
          <span>
            Question {quiz.questionNumber} of {quiz.totalQuestions}
          </span>
          <span className="tabular-nums text-ivory-dim" aria-live="polite">
            {timeUp ? 'Time’s up' : `${secondsLeft ?? question.timeLimitSec}s`}
          </span>
        </div>
        <CountdownLine className="mt-3" opensAt={quiz.opensAt} closesAt={timeUp ? null : quiz.closesAt} />
      </Rise>

      <Rise className="mt-8">
        <h1 className="type-display text-[2.15rem] leading-[1.12]">{question.text}</h1>
      </Rise>

      <div className="mt-8 flex flex-1 flex-col justify-end gap-3" role="group" aria-label="Answers">
        {question.options.map((option, index) => {
          const isSelected = selected === index;
          return (
            <motion.button
              key={option + index}
              type="button"
              variants={{
                initial: { opacity: 0, y: 14 },
                animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: ease.drift } },
              }}
              whileTap={locked ? undefined : { scale: 0.98 }}
              onClick={() => answer(index)}
              disabled={locked}
              aria-pressed={isSelected}
              className={cn(
                'flex min-h-16 items-center gap-4 rounded-[1.25rem] border px-5 py-3 text-left text-[1.1rem] transition-[border-color,background-color,opacity,box-shadow] duration-500',
                isSelected
                  ? 'border-champagne/70 bg-champagne/12 text-ivory shadow-[0_0_40px_-12px_rgba(216,189,139,0.7)]'
                  : 'border-ivory/12 bg-night-deep/35 text-ivory',
                locked && !isSelected && 'opacity-40',
                !locked && 'hover:border-ivory/30',
              )}
            >
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-semibold',
                  isSelected ? 'border-champagne bg-champagne text-night' : 'border-ivory/20 text-ivory-dim',
                )}
              >
                {OPTION_LETTERS[index]}
              </span>
              <span className="flex-1">{option}</span>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-6 min-h-12 text-center" aria-live="polite">
        <AnimatePresence mode="wait">
          {error ? (
            <motion.p key="error" className="text-danger" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {error}
            </motion.p>
          ) : selected !== null ? (
            <motion.p key="locked" className="text-ivory-dim" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              Answer locked in. Waiting for everyone else.
            </motion.p>
          ) : timeUp ? (
            <motion.p key="late" className="text-mist" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              No answer this round. You'll get the next one.
            </motion.p>
          ) : (
            <motion.p key="hint" className="text-mist" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              One tap locks in your answer.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </Scene>
  );
}

function AnswerScene({ view }: { view: GuestView }) {
  const { quiz } = view;
  const correctIndex = quiz.correctOptionIndex;
  const answered = quiz.myAnswer !== null;
  const correct = answered && quiz.myAnswer === correctIndex;
  const correctText = correctIndex !== null ? quiz.question?.options[correctIndex] : undefined;

  return (
    <Scene className="justify-center py-10 text-center">
      <Rise className="mx-auto mb-8">
        <motion.div
          className={cn(
            'grid h-24 w-24 place-items-center rounded-full border',
            correct ? 'border-champagne/60 bg-champagne/15 text-champagne-soft' : 'border-ivory/15 bg-ivory/[0.04] text-ivory-dim',
          )}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 16 }}
        >
          {correct ? <Check className="h-10 w-10" strokeWidth={1.5} /> : <X className="h-9 w-9" strokeWidth={1.5} />}
        </motion.div>
      </Rise>
      <GuestTitle
        title={correct ? 'Spot on!' : answered ? 'Not this time' : 'No answer this round'}
        lead={correctText ? `The answer was “${correctText}”.` : undefined}
      />
      <Rise className="mt-10">
        <p className="type-numeral text-[3.4rem] text-ivory">
          {correct ? '+' : ''}
          {correct ? POINTS_PER_CORRECT_ANSWER : 0}
        </p>
        <p className="mt-1 text-sm text-mist">
          <AnimatedNumber value={quiz.myScore} /> points in total
        </p>
      </Rise>
    </Scene>
  );
}

function StandingScene({ title, score, lead }: { title: string; score: number; lead: string }) {
  return (
    <Scene className="justify-center py-10 text-center">
      <GuestTitle title={title} lead={lead} />
      {score > 0 && (
        <Rise className="mt-10">
          <p className="type-numeral text-[4.2rem] text-champagne-soft text-glow">
            <AnimatedNumber value={score} />
          </p>
          <p className="text-sm text-mist">points</p>
        </Rise>
      )}
    </Scene>
  );
}

function ResultsScene({ view }: { view: GuestView }) {
  const { quiz } = view;
  const isWinner = quiz.myRank === 1;
  return (
    <>
      {isWinner && (
        <div className="pointer-events-none fixed inset-0 z-10">
          <Confetti count={50} fall={900} />
        </div>
      )}
      <StandingScene
        title={
          isWinner
            ? 'You won the quiz!'
            : quiz.myRank
              ? `You finished ${ordinal(quiz.myRank)}`
              : 'That’s the quiz!'
        }
        score={quiz.myScore}
        lead={isWinner ? 'You know these two better than anyone.' : 'Look up to see the winners.'}
      />
    </>
  );
}
