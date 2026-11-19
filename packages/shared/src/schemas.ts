import { z } from 'zod';
import { EVENT_PHASES } from './phases';

export const DISPLAY_NAME_MAX = 32;
export const MESSAGE_MAX = 600;
export const QUIZ_QUESTION_COUNT = 10;

/** Collapses runs of whitespace so "  Aunt   Mia " becomes "Aunt Mia". */
const normalizeSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

export const eventPhaseSchema = z.enum(EVENT_PHASES);

export const displayNameSchema = z
  .string()
  .transform(normalizeSpaces)
  .pipe(
    z
      .string()
      .min(1, 'Please enter your name.')
      .max(DISPLAY_NAME_MAX, `Names can be up to ${DISPLAY_NAME_MAX} characters.`),
  );

export const registerGuestSchema = z.object({
  displayName: displayNameSchema,
});

export const voteChoiceSchema = z.enum(['BOY', 'GIRL']);

export const castVoteSchema = z.object({
  choice: voteChoiceSchema,
});

export const quizAnswerSchema = z.object({
  questionId: z.string().min(1),
  optionIndex: z.number().int().min(0).max(3),
});

export const MESSAGES_PER_GUEST = 3;

export const babyMessageSchema = z.object({
  /** Generated on the device. A resend with the same id never creates a second message. */
  clientMessageId: z.string().min(8).max(64),
  text: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, 'Write a few words for the little one first.')
        .max(MESSAGE_MAX, `Messages can be up to ${MESSAGE_MAX} characters.`),
    ),
});

export const quizQuestionConfigSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(3, 'Write the question.').max(160, 'Keep the question under 160 characters.'),
  options: z.tuple([
    z.string().trim().min(1, 'Fill in answer A.').max(60),
    z.string().trim().min(1, 'Fill in answer B.').max(60),
    z.string().trim().min(1, 'Fill in answer C.').max(60),
    z.string().trim().min(1, 'Fill in answer D.').max(60),
  ]),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().max(240, 'Keep the note under 240 characters.').optional(),
  timeLimitSec: z.number().int().min(10).max(120),
});

export const quizConfigSchema = z
  .array(quizQuestionConfigSchema)
  .length(QUIZ_QUESTION_COUNT, `The quiz has exactly ${QUIZ_QUESTION_COUNT} questions.`)
  .refine((questions) => new Set(questions.map((q) => q.id)).size === questions.length, 'Question ids must be unique.')
  .refine(
    (questions) => questions.every((q) => new Set(q.options.map((o) => o.toLowerCase())).size === 4),
    'Each question needs four different answers.',
  );

export const QUIZ_TIME_LIMITS = [10, 15, 20, 30, 45, 60] as const;

/** Reveal codes look like R7KM-92PX-L4QT. Ambiguous characters (0/O, 1/I/L) are excluded. */
export const REVEAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const revealCodeSchema = z
  .string()
  .transform((value) => value.toUpperCase().replace(/[^0-9A-Z]/g, ''))
  .pipe(z.string().length(12, 'Codes have 12 characters.'))
  .transform((value) => `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`);

export type RegisterGuestInput = z.infer<typeof registerGuestSchema>;
export type CastVoteInput = z.infer<typeof castVoteSchema>;
export type QuizAnswerInput = z.infer<typeof quizAnswerSchema>;
export type BabyMessageInput = z.infer<typeof babyMessageSchema>;

/** Strict validation of host commands at the API boundary. */
export const adminCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('START_VOTING') }).strict(),
  z.object({ type: z.literal('CLOSE_VOTING') }).strict(),
  z.object({ type: z.literal('START_QUIZ') }).strict(),
  z.object({ type: z.literal('OPEN_QUESTION') }).strict(),
  z.object({ type: z.literal('CLOSE_QUESTION') }).strict(),
  z.object({ type: z.literal('REVEAL_ANSWER') }).strict(),
  z.object({ type: z.literal('SHOW_LEADERBOARD') }).strict(),
  z.object({ type: z.literal('NEXT_QUESTION') }).strict(),
  z.object({ type: z.literal('FINISH_QUIZ') }).strict(),
  z.object({ type: z.literal('START_MESSAGES') }).strict(),
  z.object({ type: z.literal('CLOSE_MESSAGES') }).strict(),
  z.object({ type: z.literal('START_REVEAL') }).strict(),
  z.object({ type: z.literal('FINISH_EVENT') }).strict(),
  z.object({ type: z.literal('SET_MESSAGE_APPROVAL'), messageId: z.string().min(1).max(80), approved: z.boolean() }).strict(),
  z.object({ type: z.literal('SET_MESSAGE_HIDDEN'), messageId: z.string().min(1).max(80), hidden: z.boolean() }).strict(),
  z.object({ type: z.literal('SET_MESSAGE_REMOVED'), messageId: z.string().min(1).max(80), removed: z.boolean() }).strict(),
  z.object({ type: z.literal('UPDATE_QUIZ_QUESTIONS'), questions: quizConfigSchema }).strict(),
]);

export const adminSignInSchema = z.object({ password: z.string().min(1, 'Enter the host password.').max(200) });
export const revealCodeRequestSchema = z.object({ code: z.string().max(40) });

/** Doctor link tokens: 256-bit, base64url. They travel in request bodies, never in URLs the server logs. */
export const doctorTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/, 'This link isn’t complete.');
export const doctorSessionSchema = z.object({ token: doctorTokenSchema }).strict();
export const doctorSelectionSchema = z
  .object({
    token: doctorTokenSchema,
    choice: z.enum(['BOY', 'GIRL']),
    /** Generated once on the device when the doctor confirms; repeats of it are the same submission. */
    submissionId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
    confirmed: z.literal(true),
  })
  .strict();
export const secretResetSchema = z.object({ confirm: z.literal('RESET') }).strict();

/** Test mode only: start the evening over as a new rehearsal run. */
export const newRehearsalSchema = z.object({ confirm: z.literal('NEW') }).strict();
