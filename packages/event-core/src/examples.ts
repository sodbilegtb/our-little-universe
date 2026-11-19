import type { QuizQuestionConfig } from '@olu/shared';

const MOM_DAD = ['Mom', 'Dad', 'Both, equally', 'Neither of them'] as const;

/**
 * Editable example questions, used when a new event is created. The correct answers below are placeholders only:
 * the parents set their real answers in the admin desk before the party.
 */
export const EXAMPLE_QUESTIONS: QuizQuestionConfig[] = [
  { id: 'q01', text: 'Who is better at cooking?', options: MOM_DAD, correctOptionIndex: 0, timeLimitSec: 20 },
  { id: 'q02', text: 'Who takes longer to get ready?', options: MOM_DAD, correctOptionIndex: 1, timeLimitSec: 20 },
  {
    id: 'q03',
    text: 'Who is more likely to wake up first for the baby?',
    options: MOM_DAD,
    correctOptionIndex: 2,
    timeLimitSec: 20,
  },
  {
    id: 'q04',
    text: 'Who is more likely to buy too many baby clothes?',
    options: MOM_DAD,
    correctOptionIndex: 0,
    timeLimitSec: 20,
  },
  { id: 'q05', text: 'Who was more mischievous as a child?', options: MOM_DAD, correctOptionIndex: 1, timeLimitSec: 20 },
  { id: 'q06', text: 'Who is more likely to cry first at the birth?', options: MOM_DAD, correctOptionIndex: 1, timeLimitSec: 20 },
  { id: 'q07', text: 'Who will change more diapers in the first week?', options: MOM_DAD, correctOptionIndex: 2, timeLimitSec: 20 },
  { id: 'q08', text: 'Who is the bigger night owl?', options: MOM_DAD, correctOptionIndex: 0, timeLimitSec: 20 },
  {
    id: 'q09',
    text: 'Who will be the stricter parent?',
    options: MOM_DAD,
    correctOptionIndex: 3,
    explanation: 'Example answer. Replace it with your own before the party.',
    timeLimitSec: 20,
  },
  { id: 'q10', text: 'Who will pick the baby’s first outfit?', options: MOM_DAD, correctOptionIndex: 0, timeLimitSec: 20 },
];
