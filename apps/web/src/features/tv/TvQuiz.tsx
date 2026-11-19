import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import type { LeaderboardEntry, TvView } from '@olu/shared';
import { CountdownLine, useSecondsLeft } from '@/components/ui/Countdown';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Confetti } from '@/components/celebration/Confetti';
import { OPTION_LETTERS, ordinal } from '@/features/quiz/ordinal';
import { cn } from '@/lib/cn';
import { ease, riseIn } from '@/lib/motion';
import { TvScene, TvWordmark } from './TvChrome';

export function TvQuiz({ view }: { view: TvView }) {
  switch (view.quiz.stage) {
    case 'INTRO':
      return <QuizIntro total={view.quiz.totalQuestions} />;
    case 'QUESTION_OPEN':
    case 'QUESTION_CLOSED':
    case 'ANSWER_REVEALED':
      return <QuizQuestion view={view} />;
    case 'LEADERBOARD':
      return <QuizLeaderboard entries={view.leaderboard} after={view.quiz.questionNumber} />;
    case 'RESULTS':
      return <QuizPodium entries={view.leaderboard} />;
  }
}

function QuizIntro({ total }: { total: number }) {
  return (
    <TvScene className="flex flex-col items-center justify-center text-center">
      <motion.p variants={riseIn} className="type-display-italic text-[44px] text-champagne-soft">
        The quiz
      </motion.p>
      <motion.h1 variants={riseIn} className="type-display mt-6 text-[220px] text-glow">
        Mom vs. Dad
      </motion.h1>
      <motion.p variants={riseIn} className="mt-12 text-[36px] text-ivory-dim">
        {total} questions about the two of us. Answer on your phone.
      </motion.p>
    </TvScene>
  );
}

function QuizQuestion({ view }: { view: TvView }) {
  const { quiz } = view;
  const secondsLeft = useSecondsLeft(quiz.closesAt);
  const question = quiz.question;
  if (!question) return null;

  const revealed = quiz.stage === 'ANSWER_REVEALED' && quiz.correctOptionIndex !== null;
  const timeUp = quiz.stage !== 'QUESTION_OPEN' || secondsLeft === 0;

  return (
    <TvScene className="flex flex-col">
      <div className="flex items-center justify-between text-[30px] text-ivory-dim">
        <span>
          Question <span className="text-ivory">{quiz.questionNumber}</span> of {quiz.totalQuestions}
        </span>
        <span className="type-numeral text-[56px] text-ivory">
          {revealed ? '' : timeUp ? 'Time’s up' : secondsLeft}
        </span>
      </div>
      <CountdownLine className="mt-5 h-[4px]" opensAt={quiz.opensAt} closesAt={timeUp ? null : quiz.closesAt} />

      <motion.h1 variants={riseIn} className="type-display mt-20 max-w-[22ch] text-[104px] leading-[1.06]">
        {question.text}
      </motion.h1>

      <div className="mt-auto grid grid-cols-2 gap-8">
        {question.options.map((option, index) => {
          const isCorrect = revealed && index === quiz.correctOptionIndex;
          return (
            <motion.div
              key={option + index}
              variants={riseIn}
              animate={{
                opacity: revealed && !isCorrect ? 0.28 : timeUp && !revealed ? 0.75 : 1,
                scale: isCorrect ? 1.02 : 1,
              }}
              transition={{ duration: 0.8, ease: ease.drift }}
              className={cn(
                'flex h-[150px] items-center gap-8 rounded-[2rem] border px-10 text-[50px] transition-[border-color,background-color,box-shadow] duration-700',
                isCorrect
                  ? 'border-champagne bg-champagne/15 shadow-[0_0_100px_-20px_rgba(216,189,139,0.9)]'
                  : 'veil',
              )}
            >
              <span
                className={cn(
                  'grid h-16 w-16 shrink-0 place-items-center rounded-full border text-[28px] font-semibold',
                  isCorrect ? 'border-champagne bg-champagne text-night' : 'border-ivory/25 text-ivory-dim',
                )}
              >
                {OPTION_LETTERS[index]}
              </span>
              <span className="truncate">{option}</span>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-10 flex h-[44px] items-center justify-between text-[28px] text-ivory-dim">
        <span>
          <AnimatedNumber value={quiz.answeredCount} className="text-ivory" /> of {view.guestCount} answered
        </span>
        <AnimatePresence>
          {revealed && quiz.explanation && (
            <motion.span
              className="type-display-italic text-[32px] text-champagne-soft"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {quiz.explanation}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </TvScene>
  );
}

function QuizLeaderboard({ entries, after }: { entries: LeaderboardEntry[]; after: number }) {
  const top = entries.slice(0, 6);
  const best = Math.max(1, ...top.map((e) => e.score));
  return (
    <TvScene>
      <TvWordmark />
      <div className="mt-14 grid grid-cols-[560px_1fr] gap-[100px]">
        <div>
          <motion.h1 variants={riseIn} className="type-display text-[120px]">
            Standings
          </motion.h1>
          <motion.p variants={riseIn} className="mt-8 text-[34px] text-ivory-dim">
            After question {after}.
          </motion.p>
        </div>
        <LayoutGroup>
          <ol className="flex flex-col gap-5">
            {top.map((entry) => (
              <motion.li
                layout
                key={entry.guestId}
                variants={riseIn}
                transition={{ layout: { duration: 0.9, ease: ease.settle } }}
                className="relative flex h-[104px] items-center gap-8 overflow-hidden rounded-[1.6rem] px-9"
              >
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-[1.6rem] bg-ivory/[0.06]"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(14, (entry.score / best) * 100)}%` }}
                  transition={{ duration: 1.2, ease: ease.drift }}
                />
                <span
                  className={cn(
                    'type-numeral relative w-[64px] text-[52px]',
                    entry.rank === 1 ? 'text-champagne-soft' : 'text-ivory/60',
                  )}
                >
                  {entry.rank}
                </span>
                <span className="relative flex-1 truncate text-[44px]">{entry.displayName}</span>
                <span className="type-numeral relative text-[52px]">
                  <AnimatedNumber value={entry.score} />
                </span>
              </motion.li>
            ))}
          </ol>
        </LayoutGroup>
      </div>
    </TvScene>
  );
}

const PODIUM_ORDER = [1, 0, 2] as const; // second, first, third from left to right
const PODIUM_HEIGHT = [380, 260, 190];

function QuizPodium({ entries }: { entries: LeaderboardEntry[] }) {
  const winner = entries[0];
  return (
    <TvScene className="flex flex-col items-center pb-0">
      <Confetti count={90} fall={1150} />
      <motion.p variants={riseIn} className="type-display-italic text-[44px] text-champagne-soft">
        And the quiz goes to
      </motion.p>
      <motion.h1 variants={riseIn} className="type-display mt-4 text-[150px] text-glow">
        {winner && winner.score > 0 ? winner.displayName : 'Everyone'}
      </motion.h1>
      <div className="mt-auto flex items-end gap-10">
        {PODIUM_ORDER.map((index, column) => {
          const entry = entries[index];
          if (!entry) return <div key={column} className="w-[380px]" />;
          return (
            <motion.div
              key={entry.guestId}
              className="flex w-[380px] flex-col items-center"
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.6 + (2 - index) * 0.35, ease: ease.drift }}
            >
              <p className="truncate text-[44px]">{entry.displayName}</p>
              <p className="type-numeral mt-1 text-[36px] text-ivory/60">{entry.score} pts</p>
              <div
                className={cn(
                  'mt-6 flex w-full items-start justify-center rounded-t-[2rem] border-x border-t pt-8',
                  index === 0 ? 'border-champagne/50 bg-champagne/12' : 'border-ivory/12 bg-ivory/[0.04]',
                )}
                style={{ height: PODIUM_HEIGHT[index] }}
              >
                <span className={cn('type-display text-[72px]', index === 0 ? 'text-champagne-soft' : 'text-ivory/70')}>
                  {ordinal(index + 1)}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </TvScene>
  );
}
