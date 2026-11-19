import type { AdminCommand, QuizQuestionConfig } from '@olu/shared';
import { applyAdminCommand } from './machine';
import { registerGuest, type Ids } from './guests';
import { createEventState, transact, type EventState, type GuestRecord } from './state';

const OPTIONS = ['Mom', 'Dad', 'Both', 'Neither'] as const;

export function sampleQuestions(count = 10): QuizQuestionConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q${i + 1}`,
    text: `Question number ${i + 1}?`,
    options: OPTIONS,
    correctOptionIndex: i % 4,
    timeLimitSec: 20,
  }));
}

/** A tiny in-memory "server" with a controllable clock for rule tests. */
export function createHarness() {
  let counter = 0;
  const ids: Ids = {
    guestId: () => `gst_${++counter}`,
    sessionToken: () => `tok_${++counter}`,
    messageId: (guestId, clientMessageId) => `msg_${guestId}_${clientMessageId}`,
  };
  const clock = { now: 1_000_000 };
  let state: EventState = createEventState({ eventId: 'evt_test', eventName: 'Test', questions: sampleQuestions() });

  const run = <T>(change: (draft: EventState) => T): T => {
    const next = transact(state, change);
    state = next.state;
    return next.result;
  };

  return {
    ids,
    clock,
    get state() {
      return state;
    },
    run,
    command: (command: AdminCommand) => run((draft) => applyAdminCommand(draft, command, clock.now)),
    commands: (...types: AdminCommand['type'][]) => {
      for (const type of types) run((draft) => applyAdminCommand(draft, { type } as AdminCommand, clock.now));
    },
    join: (name = 'Guest'): GuestRecord => run((draft) => registerGuest(draft, { displayName: name }, ids, clock.now)),
    advance: (ms: number) => {
      clock.now += ms;
    },
  };
}
