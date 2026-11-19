import { DomainError } from './errors';
import { castVote, registerGuest, submitMessage, submitQuizAnswer, type Ids } from './guests';
import { currentQuestion, type EventState } from './state';

/*
 * Development aid: believable activity from placeholder guests, applied through
 * the real rules. Used by the local preview and the local API server only.
 * Never wired into a deployed environment.
 */

export const SIMULATED_GUEST_NAMES = ['Anna', 'Jonas', 'Mira', 'Felix', 'Lea', 'Paul', 'Sofia', 'Ben', 'Clara', 'Noah', 'Ida', 'Theo'];

export const SIMULATED_MESSAGES = [
  'We cannot wait to meet you, little one. The whole family is already counting the days.',
  'May you always find wonder in small things, the way your parents do.',
  'Welcome to the world! I promise to be the fun one who lets you stay up late.',
  'You are already so loved. Grow slowly, laugh often.',
  'Dream big, sleep well, and please let your parents sleep too.',
];

export interface SimulationContext {
  ids: Ids;
  /** Ids for new placeholder guests. Must be recognisable by `isSimulated`. */
  simulatedIds: Ids;
  isSimulated: (guestId: string) => boolean;
  random?: () => number;
}

function attempt(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
}

export function seedSimulatedGuests(state: EventState, count: number, context: SimulationContext, startAt: number): void {
  SIMULATED_GUEST_NAMES.slice(0, count).forEach((name, i) =>
    registerGuest(state, { displayName: name }, context.simulatedIds, startAt + i * 60_000),
  );
}

export function simulateActivity(state: EventState, now: number, context: SimulationContext): void {
  const random = context.random ?? Math.random;
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const simulated = state.guests.filter((g) => context.isSimulated(g.id));

  if (state.phase === 'LOBBY') {
    const name = SIMULATED_GUEST_NAMES[state.guests.length % SIMULATED_GUEST_NAMES.length] ?? 'Guest';
    registerGuest(state, { displayName: name }, context.simulatedIds, now);
  }

  if (state.phase === 'VOTING') {
    for (const guest of simulated) {
      if (random() < 0.6) attempt(() => castVote(state, guest, { choice: random() < 0.5 ? 'BOY' : 'GIRL' }, now));
    }
  }

  const question = currentQuestion(state);
  if (state.phase === 'QUIZ' && state.quiz.stage === 'QUESTION_OPEN' && question) {
    const openedAt = state.quiz.opensAt ?? now;
    for (const guest of simulated) {
      if (random() < 0.25) continue;
      const optionIndex = random() < 0.55 ? question.correctOptionIndex : Math.floor(random() * 4);
      const answeredAt = Math.min(now, openedAt + 1500 + random() * 10_000);
      attempt(() => submitQuizAnswer(state, guest, { questionId: question.id, optionIndex }, answeredAt));
    }
  }

  if (state.phase === 'MESSAGES') {
    const guest = pick(simulated);
    if (guest) {
      attempt(() => {
        const clientMessageId = `sim-${Math.floor(random() * 1e12).toString(36)}-${state.messages.items.length}`;
        const { message } = submitMessage(
          state,
          guest,
          { clientMessageId, text: pick(SIMULATED_MESSAGES) ?? 'Welcome, little one.' },
          context.ids,
          now,
        );
        message.approved = random() < 0.5;
      });
    }
  }
}
