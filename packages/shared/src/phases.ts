/**
 * Event phases and the allowed host-driven transitions.
 *
 * The backend (Milestone 3) is the authority on the current phase. Clients
 * only render whatever phase the server reports; they never pick one.
 */
export const EVENT_PHASES = [
  'LOBBY',
  'VOTING',
  'QUIZ',
  'MESSAGES',
  'REVEAL',
  'FINISHED',
] as const;

export type EventPhase = (typeof EVENT_PHASES)[number];

const NEXT_PHASE: Readonly<Record<EventPhase, EventPhase | null>> = {
  LOBBY: 'VOTING',
  VOTING: 'QUIZ',
  QUIZ: 'MESSAGES',
  MESSAGES: 'REVEAL',
  REVEAL: 'FINISHED',
  FINISHED: null,
};

export function nextPhase(phase: EventPhase): EventPhase | null {
  return NEXT_PHASE[phase];
}

/** Phases only ever move forward, one step at a time. */
export function canTransition(from: EventPhase, to: EventPhase): boolean {
  return NEXT_PHASE[from] === to;
}

export function phaseIndex(phase: EventPhase): number {
  return EVENT_PHASES.indexOf(phase);
}

/** Human-facing names, used by the admin desk. */
export const PHASE_LABELS: Readonly<Record<EventPhase, string>> = {
  LOBBY: 'Welcome',
  VOTING: 'Gender voting',
  QUIZ: 'Mom vs. Dad quiz',
  MESSAGES: 'Messages for baby',
  REVEAL: 'The reveal',
  FINISHED: 'Finished',
};
