import type { EventExport } from '@olu/shared';
import { OPTION_LETTERS } from '@/features/quiz/ordinal';
import { toCsv } from './exportMessages';

const CHOICE_LABEL = { BOY: 'Boy', GIRL: 'Girl' } as const;

export interface ExportFile {
  name: string;
  label: string;
  content: string;
  type: string;
}

/** Turns the server's export into the files the host can download. */
export function exportFiles(data: EventExport, stamp: string): ExportFile[] {
  const csv = 'text/csv;charset=utf-8';
  return [
    {
      name: `our-little-universe-${stamp}.json`,
      label: 'Complete archive (JSON)',
      content: JSON.stringify(data, null, 2),
      type: 'application/json',
    },
    {
      name: `votes-${stamp}.csv`,
      label: 'Votes',
      content: toCsv(
        ['guest', 'guess', 'votedAt'],
        data.voting.votes.map((v) => [v.displayName, CHOICE_LABEL[v.choice], v.castAt]),
      ),
      type: csv,
    },
    {
      name: `quiz-answers-${stamp}.csv`,
      label: 'Quiz answers',
      content: toCsv(
        ['question', 'questionText', 'guest', 'answer', 'answerText', 'correct', 'answeredAt'],
        data.quiz.questions.flatMap((q) =>
          q.answers.map((a) => [
            q.number,
            q.text,
            a.displayName,
            OPTION_LETTERS[a.optionIndex] ?? '',
            q.options[a.optionIndex] ?? '',
            a.correct ? 'yes' : 'no',
            a.answeredAt,
          ]),
        ),
      ),
      type: csv,
    },
    {
      name: `quiz-scores-${stamp}.csv`,
      label: 'Quiz scores',
      content: toCsv(
        ['rank', 'guest', 'score', 'correctAnswers'],
        data.quiz.leaderboard.map((e) => [e.rank, e.displayName, e.score, e.correctCount]),
      ),
      type: csv,
    },
  ];
}
