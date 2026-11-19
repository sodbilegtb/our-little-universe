import { describe, expect, it } from 'vitest';
import type { AdminCommand } from '@olu/shared';
import { DomainError } from './errors';
import { castVote, submitMessage, submitQuizAnswer } from './guests';
import { settle } from './machine';
import { computeLeaderboard, toAdminView, toGuestView, toTvView } from './projections';
import { createHarness, sampleQuestions } from './testHarness';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

/** Drives the quiz to the start of question `n` (1-based) from the voting phase. */
function toQuestion(h: ReturnType<typeof createHarness>, n: number) {
  h.commands('START_QUIZ', 'OPEN_QUESTION');
  for (let i = 1; i < n; i += 1) h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'NEXT_QUESTION');
}

describe('phase transitions', () => {
  it('walks the whole evening in order', () => {
    const h = createHarness();
    h.commands('START_VOTING', 'CLOSE_VOTING', 'START_QUIZ', 'OPEN_QUESTION');
    for (let i = 0; i < 9; i += 1) h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'SHOW_LEADERBOARD', 'NEXT_QUESTION');
    h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'FINISH_QUIZ', 'START_MESSAGES', 'CLOSE_MESSAGES', 'START_REVEAL', 'FINISH_EVENT');
    expect(h.state.phase).toBe('FINISHED');
  });

  it.each<[string, AdminCommand['type'][], AdminCommand['type']]>([
    ['skip voting', [], 'START_QUIZ'],
    ['reveal from lobby', [], 'START_REVEAL'],
    ['finish from lobby', [], 'FINISH_EVENT'],
    ['open a question before the quiz', ['START_VOTING'], 'OPEN_QUESTION'],
    ['close voting twice', ['START_VOTING', 'CLOSE_VOTING'], 'CLOSE_VOTING'],
    ['reveal an answer while the question is open', ['START_VOTING', 'START_QUIZ', 'OPEN_QUESTION'], 'REVEAL_ANSWER'],
    ['finish the quiz early', ['START_VOTING', 'START_QUIZ', 'OPEN_QUESTION', 'CLOSE_QUESTION', 'REVEAL_ANSWER'], 'FINISH_QUIZ'],
    ['start messages mid-quiz', ['START_VOTING', 'START_QUIZ'], 'START_MESSAGES'],
    ['go back to voting', ['START_VOTING', 'START_QUIZ'], 'START_VOTING'],
  ])('rejects: %s', (_label, setup, invalid) => {
    const h = createHarness();
    h.commands(...setup);
    const before = h.state;
    expect(codeOf(() => h.command({ type: invalid } as AdminCommand))).toBe('WRONG_PHASE');
    expect(h.state).toBe(before); // a failed command changes nothing, not even the revision
  });

  it('bumps the revision on every successful change', () => {
    const h = createHarness();
    const start = h.state.revision;
    h.commands('START_VOTING', 'CLOSE_VOTING');
    expect(h.state.revision).toBe(start + 2);
  });

  it('cannot pass the last question', () => {
    const h = createHarness();
    h.commands('START_VOTING');
    toQuestion(h, 10);
    h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER');
    expect(codeOf(() => h.command({ type: 'NEXT_QUESTION' }))).toBe('WRONG_PHASE');
  });
});

describe('guest registration', () => {
  it('allows duplicate display names with distinct identities', () => {
    const h = createHarness();
    const a = h.join('Mia');
    const b = h.join('Mia');
    expect(a.id).not.toBe(b.id);
    expect(a.sessionToken).not.toBe(b.sessionToken);
  });

  it('lets late guests join mid-event and see the current phase', () => {
    const h = createHarness();
    h.commands('START_VOTING', 'START_QUIZ');
    const late = h.join('Late');
    expect(toGuestView(h.state, late.id, h.clock.now).phase).toBe('QUIZ');
  });

  it('closes registration once the event is finished', () => {
    const h = createHarness();
    h.commands('START_VOTING', 'START_QUIZ', 'OPEN_QUESTION');
    for (let i = 0; i < 9; i += 1) h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'NEXT_QUESTION');
    h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'FINISH_QUIZ', 'START_MESSAGES', 'START_REVEAL', 'FINISH_EVENT');
    expect(codeOf(() => h.join('Too late'))).toBe('CLOSED');
  });
});

describe('voting', () => {
  it('records one vote and treats an identical retry as success', () => {
    const h = createHarness();
    const guest = h.join();
    h.commands('START_VOTING');
    expect(h.run((s) => castVote(s, guest, { choice: 'GIRL' }, h.clock.now))).toBe('recorded');
    expect(h.run((s) => castVote(s, guest, { choice: 'GIRL' }, h.clock.now))).toBe('already-recorded');
    expect(codeOf(() => h.run((s) => castVote(s, guest, { choice: 'BOY' }, h.clock.now)))).toBe('ALREADY_SUBMITTED');
    expect(toTvView(h.state, h.clock.now, '').voting.tally).toEqual({ boy: 0, girl: 1, total: 1 });
  });

  it('rejects votes before voting and after it closes', () => {
    const h = createHarness();
    const guest = h.join();
    expect(codeOf(() => h.run((s) => castVote(s, guest, { choice: 'BOY' }, h.clock.now)))).toBe('WRONG_PHASE');
    h.commands('START_VOTING', 'CLOSE_VOTING');
    expect(codeOf(() => h.run((s) => castVote(s, guest, { choice: 'BOY' }, h.clock.now)))).toBe('CLOSED');
  });

  it('counts simultaneous votes from different guests', () => {
    const h = createHarness();
    const guests = Array.from({ length: 5 }, (_, i) => h.join(`G${i}`));
    h.commands('START_VOTING');
    guests.forEach((g, i) => h.run((s) => castVote(s, g, { choice: i % 2 ? 'BOY' : 'GIRL' }, h.clock.now)));
    expect(toAdminView(h.state, h.clock.now, '', 'TEST').voting.tally).toEqual({ boy: 2, girl: 3, total: 5 });
  });
});

describe('quiz answers', () => {
  it('validates the answer shape', () => {
    const h = createHarness();
    const guest = h.join();
    h.commands('START_VOTING');
    toQuestion(h, 1);
    expect(codeOf(() => h.run((s) => submitQuizAnswer(s, guest, { questionId: 'q1', optionIndex: 4 }, h.clock.now)))).toBe(
      'INVALID_INPUT',
    );
    expect(codeOf(() => h.run((s) => submitQuizAnswer(s, guest, { questionId: 'q2', optionIndex: 0 }, h.clock.now)))).toBe(
      'CLOSED',
    );
  });

  it('accepts one answer per question; identical retries are harmless', () => {
    const h = createHarness();
    const guest = h.join();
    h.commands('START_VOTING');
    toQuestion(h, 1);
    const answer = (optionIndex: number) =>
      h.run((s) => submitQuizAnswer(s, guest, { questionId: 'q1', optionIndex }, h.clock.now));
    expect(answer(2)).toBe('recorded');
    expect(answer(2)).toBe('already-recorded');
    expect(codeOf(() => answer(1))).toBe('ALREADY_SUBMITTED');
  });

  it('accepts answers within the grace period and rejects them after', () => {
    const h = createHarness();
    const early = h.join('Early');
    const late = h.join('Late');
    h.commands('START_VOTING');
    toQuestion(h, 1);
    h.advance(20_000 + 1_000); // deadline passed, still inside the 1.5s grace
    expect(h.run((s) => submitQuizAnswer(s, early, { questionId: 'q1', optionIndex: 0 }, h.clock.now))).toBe('recorded');
    h.advance(1_000);
    expect(codeOf(() => h.run((s) => submitQuizAnswer(s, late, { questionId: 'q1', optionIndex: 0 }, h.clock.now)))).toBe(
      'CLOSED',
    );
  });

  it('closes a question on its own once the time is up', () => {
    const h = createHarness();
    h.commands('START_VOTING');
    toQuestion(h, 1);
    h.advance(10_000);
    expect(h.run((s) => settle(s, h.clock.now))).toBe(false);
    h.advance(12_000);
    expect(h.run((s) => settle(s, h.clock.now))).toBe(true);
    expect(h.state.quiz.stage).toBe('QUESTION_CLOSED');
    h.command({ type: 'REVEAL_ANSWER' }); // the host can carry straight on
  });

  it('never exposes the correct answer to guests or the TV before the reveal', () => {
    const h = createHarness();
    const guest = h.join();
    h.commands('START_VOTING');
    toQuestion(h, 1);
    const check = (expectVisible: boolean) => {
      const guestView = toGuestView(h.state, guest.id, h.clock.now);
      const tv = toTvView(h.state, h.clock.now, '');
      for (const view of [guestView.quiz, tv.quiz]) {
        expect(view.correctOptionIndex === null).toBe(!expectVisible);
        expect(JSON.stringify(view.question ?? {})).not.toContain('correct');
      }
    };
    check(false);
    h.command({ type: 'CLOSE_QUESTION' });
    check(false);
    h.command({ type: 'REVEAL_ANSWER' });
    check(true);
    h.command({ type: 'NEXT_QUESTION' });
    check(false);
  });
});

describe('scoring', () => {
  it('awards 100 points per correct answer, counted only after the reveal', () => {
    const h = createHarness();
    const right = h.join('Right');
    const wrong = h.join('Wrong');
    h.commands('START_VOTING');
    toQuestion(h, 1);
    // q1's correct option is index 0 in the sample questions
    h.advance(3_000);
    h.run((s) => submitQuizAnswer(s, right, { questionId: 'q1', optionIndex: 0 }, h.clock.now));
    h.run((s) => submitQuizAnswer(s, wrong, { questionId: 'q1', optionIndex: 3 }, h.clock.now));
    h.command({ type: 'CLOSE_QUESTION' });
    expect(computeLeaderboard(h.state).every((e) => e.score === 0)).toBe(true);
    h.command({ type: 'REVEAL_ANSWER' });
    const board = computeLeaderboard(h.state);
    expect(board.find((e) => e.guestId === right.id)).toMatchObject({ rank: 1, score: 100, correctCount: 1 });
    expect(board.find((e) => e.guestId === wrong.id)).toMatchObject({ rank: 2, score: 0 });
  });

  it('breaks ties by speed', () => {
    const h = createHarness();
    const slow = h.join('Slow');
    const fast = h.join('Fast');
    h.commands('START_VOTING');
    toQuestion(h, 1);
    h.advance(2_000);
    h.run((s) => submitQuizAnswer(s, fast, { questionId: 'q1', optionIndex: 0 }, h.clock.now));
    h.advance(5_000);
    h.run((s) => submitQuizAnswer(s, slow, { questionId: 'q1', optionIndex: 0 }, h.clock.now));
    h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER');
    expect(computeLeaderboard(h.state).map((e) => e.displayName)).toEqual(['Fast', 'Slow']);
  });
});

describe('messages', () => {
  function inMessages() {
    const h = createHarness();
    const guest = h.join('Mia');
    h.commands('START_VOTING');
    toQuestion(h, 10);
    h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'FINISH_QUIZ', 'START_MESSAGES');
    return { h, guest };
  }

  it('persists every field the spec asks for', () => {
    const { h, guest } = inMessages();
    h.run((s) => submitMessage(s, guest, { clientMessageId: 'client-0001', text: '  Hello little one  ' }, h.ids, h.clock.now));
    const [stored] = toAdminView(h.state, h.clock.now, '', 'TEST').messages.items;
    expect(stored).toMatchObject({
      guestId: guest.id,
      displayName: 'Mia',
      text: 'Hello little one',
      approved: false,
      hidden: false,
    });
    expect(stored?.id).toBeTruthy();
    expect(stored?.submittedAt).toBe(new Date(h.clock.now).toISOString());
  });

  it('dedupes a resend with the same client id', () => {
    const { h, guest } = inMessages();
    const send = () =>
      h.run((s) => submitMessage(s, guest, { clientMessageId: 'client-0001', text: 'Hi' }, h.ids, h.clock.now));
    const first = send();
    const second = send();
    expect(second.outcome).toBe('already-recorded');
    expect(second.message.id).toBe(first.message.id);
    expect(h.state.messages.items).toHaveLength(1);
  });

  it('limits messages per guest', () => {
    const { h, guest } = inMessages();
    for (let i = 0; i < 3; i += 1) {
      h.run((s) => submitMessage(s, guest, { clientMessageId: `client-000${i}`, text: `Note ${i}` }, h.ids, h.clock.now));
    }
    expect(
      codeOf(() =>
        h.run((s) => submitMessage(s, guest, { clientMessageId: 'client-0009', text: 'One more' }, h.ids, h.clock.now)),
      ),
    ).toBe('LIMIT_REACHED');
    expect(toGuestView(h.state, guest.id, h.clock.now).messages).toMatchObject({ myCount: 3, limit: 3 });
  });

  it('shows message text on the TV only after approval, and never hidden ones', () => {
    const { h, guest } = inMessages();
    const { message } = h.run((s) =>
      submitMessage(s, guest, { clientMessageId: 'client-0001', text: 'Secret note' }, h.ids, h.clock.now),
    );
    expect(JSON.stringify(toTvView(h.state, h.clock.now, ''))).not.toContain('Secret note');
    h.command({ type: 'SET_MESSAGE_APPROVAL', messageId: message.id, approved: true });
    expect(toTvView(h.state, h.clock.now, '').messages.featured).toHaveLength(1);
    h.command({ type: 'SET_MESSAGE_HIDDEN', messageId: message.id, hidden: true });
    const tv = toTvView(h.state, h.clock.now, '');
    expect(tv.messages.featured).toHaveLength(0);
    expect(tv.messages.stars).toHaveLength(0);
  });

  it('removes a message reversibly, never erasing it', () => {
    const { h, guest } = inMessages();
    const { message } = h.run((s) =>
      submitMessage(s, guest, { clientMessageId: 'client-0001', text: 'Oops, wrong chat' }, h.ids, h.clock.now),
    );
    h.command({ type: 'SET_MESSAGE_APPROVAL', messageId: message.id, approved: true });
    h.command({ type: 'SET_MESSAGE_REMOVED', messageId: message.id, removed: true });

    const tv = toTvView(h.state, h.clock.now, '');
    expect(tv.messages.stars).toHaveLength(0);
    expect(JSON.stringify(tv)).not.toContain('Oops');
    expect(toAdminView(h.state, h.clock.now, '', 'TEST').messages.items[0]).toMatchObject({ removed: true, approved: true });
    expect(() => h.command({ type: 'SET_MESSAGE_APPROVAL', messageId: message.id, approved: true })).toThrow(/Restore/);
    // A removed message still counts toward the guest's limit.
    expect(toGuestView(h.state, guest.id, h.clock.now).messages.myCount).toBe(1);

    h.command({ type: 'SET_MESSAGE_REMOVED', messageId: message.id, removed: false });
    expect(toTvView(h.state, h.clock.now, '').messages.featured).toHaveLength(1);
  });

  it('rejects messages once closed', () => {
    const { h, guest } = inMessages();
    h.command({ type: 'CLOSE_MESSAGES' });
    expect(
      codeOf(() => h.run((s) => submitMessage(s, guest, { clientMessageId: 'client-0001', text: 'Hi' }, h.ids, h.clock.now))),
    ).toBe('CLOSED');
  });
});

describe('quiz editing', () => {
  it('replaces questions before the quiz and locks them after', () => {
    const h = createHarness();
    const questions = sampleQuestions().map((q) => ({ ...q, text: `Edited: ${q.text}` }));
    h.command({ type: 'UPDATE_QUIZ_QUESTIONS', questions });
    expect(h.state.quiz.questions[0]?.text).toBe('Edited: Question number 1?');
    h.commands('START_VOTING', 'START_QUIZ');
    expect(codeOf(() => h.command({ type: 'UPDATE_QUIZ_QUESTIONS', questions }))).toBe('LOCKED');
    expect(toAdminView(h.state, h.clock.now, '', 'TEST').quizEditable).toBe(false);
  });

  it('rejects an incomplete quiz', () => {
    const h = createHarness();
    expect(codeOf(() => h.command({ type: 'UPDATE_QUIZ_QUESTIONS', questions: sampleQuestions(9) }))).toBe('INVALID_INPUT');
    const duplicateOptions = sampleQuestions().map((q, i) =>
      i === 0 ? { ...q, options: ['Mom', 'mom', 'Dad', 'Both'] as const } : q,
    );
    expect(codeOf(() => h.command({ type: 'UPDATE_QUIZ_QUESTIONS', questions: duplicateOptions }))).toBe('INVALID_INPUT');
  });
});
