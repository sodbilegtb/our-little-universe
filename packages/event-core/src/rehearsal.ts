import type { EventState } from './state';
import { INITIAL_REVEAL } from './state';

/**
 * Test mode only (the server refuses it in LIVE): starts the evening over as a
 * new rehearsal run. Guests, votes, answers, messages and the doctor's answer
 * of the current run are left behind, not erased: storage keeps them, tagged
 * with their run, and the event simply stops showing them. The quiz questions,
 * settings and name carry over, since the host prepared those.
 *
 * Returns the sealed answer that is no longer current, so the server can
 * retire it and its code.
 */
export function startNewRun(state: EventState): { retiredSelectionId: string | null } {
  const retiredSelectionId = state.doctor.selectionId;
  state.run += 1;
  state.phase = 'LOBBY';
  state.guests = [];
  state.voting = { open: false, votes: {} };
  state.quiz = {
    ...state.quiz,
    stage: 'INTRO',
    index: 0,
    opensAt: null,
    closesAt: null,
    openedAt: {},
    answers: {},
  };
  state.messages = { open: false, items: [], nextOrder: 0 };
  // The generation keeps counting, so nothing from an earlier run is ever valid again.
  state.doctor = {
    status: 'NOT_STARTED',
    generation: state.doctor.generation + 1,
    linkId: null,
    linkExpiresAt: null,
    selectionId: null,
    submittedAt: null,
  };
  state.reveal = { ...INITIAL_REVEAL };
  return { retiredSelectionId };
}
