import { fail } from './errors';
import type { EventState } from './state';
import type { Outcome } from './guests';

/*
 * The doctor and reveal workflow as state transitions. These rules never see
 * the doctor's choice, the reveal code or any key: the server seals those in a
 * separate store and only passes opaque ids in here. That's why every view
 * built from this state is the same whatever the baby's gender is.
 */

/** Before the host's code is accepted, the secret can still be re-issued or reset. */
function revealNotStarted(state: EventState): boolean {
  return state.reveal.status === 'LOCKED' || state.reveal.status === 'AWAITING_CODE';
}

/** Issues the one valid doctor link. A new link retires the previous one. */
export function issueDoctorLink(state: EventState, link: { linkId: string; expiresAt: number }): void {
  if (!revealNotStarted(state)) fail('LOCKED', 'The reveal has already begun.');
  if (state.doctor.status === 'SUBMITTED') {
    fail('LOCKED', 'The doctor’s answer is already sealed. Reset the secret first if a new answer is needed.');
  }
  state.doctor.status = 'LINK_ISSUED';
  state.doctor.linkId = link.linkId;
  state.doctor.linkExpiresAt = link.expiresAt;
}

/** Whether `linkId` is the current, unexpired doctor link. */
export function isCurrentDoctorLink(state: EventState, linkId: string, now: number): boolean {
  const { doctor } = state;
  return doctor.linkId === linkId && doctor.linkExpiresAt !== null && now <= doctor.linkExpiresAt;
}

/**
 * Records that an answer was sealed under `selectionId`. Repeating it with the
 * same id is a safe no-op (double clicks, retries); anything else is refused.
 */
export function recordDoctorSelection(
  state: EventState,
  input: { linkId: string; selectionId: string },
  now: number,
): Outcome {
  const { doctor } = state;
  if (doctor.status === 'SUBMITTED') {
    if (doctor.linkId === input.linkId && doctor.selectionId === input.selectionId) return 'already-recorded';
    fail('ALREADY_SUBMITTED', 'An answer has already been sealed.');
  }
  if (!revealNotStarted(state)) fail('LOCKED', 'The reveal has already begun.');
  if (doctor.status !== 'LINK_ISSUED' || !isCurrentDoctorLink(state, input.linkId, now)) {
    fail('INVALID_LINK', 'This link isn’t valid or has expired.');
  }
  doctor.status = 'SUBMITTED';
  doctor.selectionId = input.selectionId;
  doctor.submittedAt = now;
  return 'recorded';
}

/**
 * Throws away the sealed answer and its code so the doctor can be asked again.
 * Only possible until the host's code has been accepted.
 */
export function resetSecret(state: EventState): { retiredSelectionId: string | null } {
  if (!revealNotStarted(state)) fail('LOCKED', 'The reveal has already begun and can’t be reset.');
  const retiredSelectionId = state.doctor.selectionId;
  state.doctor = {
    status: 'NOT_STARTED',
    generation: state.doctor.generation + 1,
    linkId: null,
    linkExpiresAt: null,
    selectionId: null,
    submittedAt: null,
  };
  return { retiredSelectionId };
}

/**
 * Starts the reveal once the server has matched the host's code to the current
 * sealed answer. The result is released only from `revealAt` on.
 */
export function authorizeReveal(
  state: EventState,
  input: { selectionId: string; delayMs: number; code: string },
  now: number,
): Outcome {
  if (state.phase !== 'REVEAL') fail('WRONG_PHASE', 'Start the reveal phase first.');
  if (state.doctor.status !== 'SUBMITTED' || state.doctor.selectionId !== input.selectionId) {
    fail('NOT_FOUND', 'That code doesn’t unlock the reveal.');
  }
  if (state.reveal.status === 'REVEALING' || state.reveal.status === 'REVEALED') return 'already-recorded';
  if (state.reveal.status !== 'AWAITING_CODE') fail('WRONG_PHASE', 'Start the reveal phase first.');
  state.reveal = { status: 'REVEALING', startedAt: now, revealAt: now + input.delayMs, code: input.code };
  return 'recorded';
}
