import type {
  AnswerRecord,
  EventState,
  GuestRecord,
  MessageRecord,
  VoteRecord,
} from '@olu/event-core';

/*
 * The event state is stored as one small "control" item plus one item per
 * guest, vote, answer and message. Rules run on the whole state; this module
 * works out which items a rule changed, so only those are written.
 */

/** Everything except the per-guest collections. Stored in the STATE item. */
export type ControlState = Omit<EventState, 'revision' | 'guests' | 'voting' | 'quiz' | 'messages'> & {
  voting: { open: boolean };
  quiz: Omit<EventState['quiz'], 'answers'>;
  messages: { open: boolean };
};

export function controlOf(state: EventState): ControlState {
  const { revision: _revision, guests: _guests, voting, quiz, messages, ...rest } = state;
  const { answers: _answers, ...quizControl } = quiz;
  return structuredClone({ ...rest, voting: { open: voting.open }, quiz: quizControl, messages: { open: messages.open } });
}

/** When the open question times out (deadline plus grace), or null. Lets the cheap revision check trigger settling. */
export function settleAt(control: ControlState): number | null {
  if (control.phase !== 'QUIZ' || control.quiz.stage !== 'QUESTION_OPEN' || control.quiz.closesAt === null) return null;
  return control.quiz.closesAt + control.settings.answerGraceMs;
}

export interface Collections {
  guests: GuestRecord[];
  votes: Record<string, VoteRecord>;
  answers: Record<string, Record<string, AnswerRecord>>;
  messages: MessageRecord[];
}

/** Rebuilds the full state from stored items. Message order ties are broken deterministically. */
export function assembleState(control: ControlState, collections: Collections, revision: number): EventState {
  const messages = [...collections.messages].sort(
    (a, b) => a.order - b.order || a.submittedAt - b.submittedAt || a.id.localeCompare(b.id),
  );
  return {
    ...structuredClone(control),
    revision,
    guests: [...collections.guests].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id)),
    voting: { open: control.voting.open, votes: { ...collections.votes } },
    quiz: { ...structuredClone(control.quiz), answers: structuredClone(collections.answers) },
    messages: {
      open: control.messages.open,
      items: messages,
      nextOrder: messages.reduce((max, m) => Math.max(max, m.order + 1), 0),
    },
  };
}

export interface AnswerKey {
  questionId: string;
  guestId: string;
}

export interface ChangeSet {
  /** The new control state, or null if unchanged. */
  control: ControlState | null;
  guestsAdded: GuestRecord[];
  votesAdded: { guestId: string; vote: VoteRecord }[];
  answersAdded: (AnswerKey & { answer: AnswerRecord })[];
  answersDeleted: AnswerKey[];
  messagesAdded: MessageRecord[];
  messagesUpdated: Pick<MessageRecord, 'id' | 'approved' | 'hidden' | 'removed'>[];
}

export class UnsupportedChangeError extends Error {
  constructor(what: string) {
    super(`A rule made a change the storage layer does not support: ${what}`);
    this.name = 'UnsupportedChangeError';
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compares the state before and after a rule ran. Existing guests, votes and
 * answers are immutable by design; a rule that edits them is a bug, and this
 * function refuses to persist it.
 */
export function diff(before: EventState, after: EventState): ChangeSet {
  const control = controlOf(after);
  const changes: ChangeSet = {
    control: same(controlOf(before), control) ? null : control,
    guestsAdded: [],
    votesAdded: [],
    answersAdded: [],
    answersDeleted: [],
    messagesAdded: [],
    messagesUpdated: [],
  };

  const guestsBefore = new Map(before.guests.map((g) => [g.id, g]));
  for (const guest of after.guests) {
    const previous = guestsBefore.get(guest.id);
    if (!previous) changes.guestsAdded.push(guest);
    else if (!same(previous, guest)) throw new UnsupportedChangeError(`guest ${guest.id} edited`);
  }
  if (after.guests.length < before.guests.length) throw new UnsupportedChangeError('guest removed');

  for (const [guestId, vote] of Object.entries(after.voting.votes)) {
    const previous = before.voting.votes[guestId];
    if (!previous) changes.votesAdded.push({ guestId, vote });
    else if (!same(previous, vote)) throw new UnsupportedChangeError(`vote of ${guestId} changed`);
  }
  for (const guestId of Object.keys(before.voting.votes)) {
    if (!after.voting.votes[guestId]) throw new UnsupportedChangeError(`vote of ${guestId} removed`);
  }

  for (const [questionId, answers] of Object.entries(after.quiz.answers)) {
    for (const [guestId, answer] of Object.entries(answers)) {
      const previous = before.quiz.answers[questionId]?.[guestId];
      if (!previous) changes.answersAdded.push({ questionId, guestId, answer });
      else if (!same(previous, answer)) throw new UnsupportedChangeError(`answer of ${guestId} changed`);
    }
  }
  for (const [questionId, answers] of Object.entries(before.quiz.answers)) {
    for (const guestId of Object.keys(answers)) {
      if (!after.quiz.answers[questionId]?.[guestId]) changes.answersDeleted.push({ questionId, guestId });
    }
  }

  const messagesBefore = new Map(before.messages.items.map((m) => [m.id, m]));
  const messagesAfter = new Map(after.messages.items.map((m) => [m.id, m]));
  for (const message of after.messages.items) {
    const previous = messagesBefore.get(message.id);
    if (!previous) {
      changes.messagesAdded.push(message);
      continue;
    }
    const { approved, hidden, removed = false, ...content } = message;
    const { approved: wasApproved, hidden: wasHidden, removed: wasRemoved = false, ...previousContent } = previous;
    if (!same(content, previousContent)) throw new UnsupportedChangeError(`message ${message.id} content changed`);
    if (approved !== wasApproved || hidden !== wasHidden || removed !== wasRemoved) {
      changes.messagesUpdated.push({ id: message.id, approved, hidden, removed });
    }
  }
  for (const id of messagesBefore.keys()) {
    // Messages are family memories: no rule erases one (removing is a flag),
    // so a missing message is a bug and must never become a DeleteItem.
    if (!messagesAfter.has(id)) throw new UnsupportedChangeError(`message ${id} disappeared`);
  }

  return changes;
}

export function isEmpty(changes: ChangeSet): boolean {
  return changes.control === null && writeCount(changes) === 0;
}

/** Changes guests can see that don't touch the control item (votes, answers, messages, guests). */
export function hasActivity(changes: ChangeSet): boolean {
  return writeCount(changes) > 0;
}

function writeCount(changes: ChangeSet): number {
  return (
    changes.guestsAdded.length +
    changes.votesAdded.length +
    changes.answersAdded.length +
    changes.answersDeleted.length +
    changes.messagesAdded.length +
    changes.messagesUpdated.length
  );
}
