import type { AdminCommand, AdminView } from '@olu/shared';

export interface AdminAction {
  label: string;
  command: AdminCommand;
  /** Sensitive transitions ask before they happen. */
  confirm?: { title: string; body: string; confirmLabel: string };
}

export interface AdminActions {
  /** One sentence describing what guests see right now. */
  status: string;
  primary?: AdminAction;
  secondary: AdminAction[];
}

/**
 * The host's next steps for the current phase. The admin desk never offers an
 * action the server would reject, but the server still validates every command.
 */
export function actionsFor(view: AdminView): AdminActions {
  const { quiz } = view;
  const isLast = quiz.questionNumber >= quiz.totalQuestions;

  switch (view.phase) {
    case 'LOBBY':
      return {
        status: 'Guests are joining. The TV shows the welcome screen and QR code.',
        primary: {
          label: 'Start voting',
          command: { type: 'START_VOTING' },
          confirm: {
            title: 'Start gender voting?',
            body: 'Every phone switches to the voting screen. Guests who join later go straight to voting.',
            confirmLabel: 'Start voting',
          },
        },
        secondary: [],
      };
    case 'VOTING':
      return view.voting.open
        ? {
            status: 'Guests are voting. The TV shows live results.',
            primary: {
              label: 'Close voting',
              command: { type: 'CLOSE_VOTING' },
              confirm: {
                title: 'Close voting?',
                body: 'No more votes are accepted after this. The results stay on the TV.',
                confirmLabel: 'Close voting',
              },
            },
            secondary: [],
          }
        : view.quizEnabled
          ? {
            status: 'Voting is closed. The final guesses are on the TV.',
            primary: {
              label: 'Start the quiz',
              command: { type: 'START_QUIZ' },
              confirm: {
                title: 'Start Mom vs. Dad?',
                body: 'The TV and every phone move to the quiz intro. You open each question yourself.',
                confirmLabel: 'Start the quiz',
              },
            },
            secondary: [],
          }
          : {
            status: 'Voting is closed. The final guesses are on the TV. The quiz is off tonight.',
            primary: {
              label: 'Start messages for baby',
              command: { type: 'START_MESSAGES' },
              confirm: {
                title: 'Start messages for baby?',
                body: 'The quiz is off tonight, so every phone goes straight to the message form, and the TV starts the constellation.',
                confirmLabel: 'Start messages',
              },
            },
            secondary: [],
          };
    case 'QUIZ':
      switch (quiz.stage) {
        case 'INTRO':
          return {
            status: 'Everyone sees the quiz intro.',
            primary: { label: 'Open question 1', command: { type: 'OPEN_QUESTION' } },
            secondary: [],
          };
        case 'QUESTION_OPEN':
          return {
            status: `Question ${quiz.questionNumber} is open for answers.`,
            primary: { label: 'Close question', command: { type: 'CLOSE_QUESTION' } },
            secondary: [],
          };
        case 'QUESTION_CLOSED':
          return {
            status: `Question ${quiz.questionNumber} is closed. The answer is still hidden.`,
            primary: { label: 'Reveal the answer', command: { type: 'REVEAL_ANSWER' } },
            secondary: [],
          };
        case 'ANSWER_REVEALED':
          return {
            status: `The answer to question ${quiz.questionNumber} is on the TV.`,
            primary: isLast
              ? { label: 'Finish the quiz', command: { type: 'FINISH_QUIZ' } }
              : { label: `Open question ${quiz.questionNumber + 1}`, command: { type: 'NEXT_QUESTION' } },
            secondary: [{ label: 'Show standings', command: { type: 'SHOW_LEADERBOARD' } }],
          };
        case 'LEADERBOARD':
          return {
            status: 'The standings are on the TV.',
            primary: isLast
              ? { label: 'Finish the quiz', command: { type: 'FINISH_QUIZ' } }
              : { label: `Open question ${quiz.questionNumber + 1}`, command: { type: 'NEXT_QUESTION' } },
            secondary: [],
          };
        case 'RESULTS':
          return {
            status: 'The TV is celebrating the quiz winner.',
            primary: {
              label: 'Start messages for baby',
              command: { type: 'START_MESSAGES' },
              confirm: {
                title: 'Start messages for baby?',
                body: 'Every phone opens the message form, and the TV starts the constellation.',
                confirmLabel: 'Start messages',
              },
            },
            secondary: [],
          };
      }
      break;
    case 'MESSAGES': {
      const startReveal: AdminAction = {
        label: 'Start the reveal',
        command: { type: 'START_REVEAL' },
        confirm: {
          title: 'Move to the reveal?',
          body: 'Messages close, phones say “Look at the big screen!”, and the TV shows the final secret screen. Nothing is revealed until you enter the official code.',
          confirmLabel: 'Start the reveal',
        },
      };
      return view.messages.open
        ? {
            status: 'Guests are writing messages. Approved ones appear on the TV.',
            primary: {
              label: 'Close messages',
              command: { type: 'CLOSE_MESSAGES' },
              confirm: {
                title: 'Close messages?',
                body: 'Guests can no longer send new messages. Everything already sent is kept.',
                confirmLabel: 'Close messages',
              },
            },
            secondary: [startReveal],
          }
        : { status: 'Messages are closed. The constellation stays on the TV.', primary: startReveal, secondary: [] };
    }
    case 'REVEAL':
      return {
        status: 'Phones say “Look at the big screen!”. The TV is waiting for the official code.',
        secondary: [
          {
            label: 'Finish the event',
            command: { type: 'FINISH_EVENT' },
            confirm: {
              title: 'Finish the event?',
              body: 'The TV and phones show the thank-you screen. In this preview the reveal itself is not connected yet.',
              confirmLabel: 'Finish',
            },
          },
        ],
      };
    case 'FINISHED':
      return { status: 'The celebration is over. Export your memories below.', secondary: [] };
  }
  return { status: '', secondary: [] };
}
