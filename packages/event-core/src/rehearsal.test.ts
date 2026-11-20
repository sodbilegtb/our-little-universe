import { describe, expect, it } from 'vitest';
import { castVote } from './guests';
import { startNewRun } from './rehearsal';
import { issueDoctorLink, recordDoctorSelection } from './secret';
import { createHarness } from './testHarness';

describe('a new rehearsal run', () => {
  it('starts the evening over but keeps what the host prepared', () => {
    const h = createHarness();
    h.command({
      type: 'UPDATE_QUIZ_QUESTIONS',
      questions: h.state.quiz.questions.map((q, i) => (i === 0 ? { ...q, text: 'Who sleeps in on Sundays?' } : q)),
    });
    h.command({ type: 'SET_QUIZ_ENABLED', enabled: false });
    const mia = h.join('Mia');
    h.commands('START_VOTING');
    h.run((s) => castVote(s, mia, { choice: 'GIRL' }, h.clock.now));
    h.run((s) => issueDoctorLink(s, { linkId: 'lnk_1', expiresAt: h.clock.now + 1000 }));
    h.run((s) => recordDoctorSelection(s, { linkId: 'lnk_1', selectionId: 'sel_1' }, h.clock.now));
    const generation = h.state.doctor.generation;

    const { retiredSelectionId } = h.run((s) => startNewRun(s));

    expect(retiredSelectionId).toBe('sel_1');
    expect(h.state).toMatchObject({
      run: 1,
      phase: 'LOBBY',
      guests: [],
      voting: { open: false, votes: {} },
      quiz: { stage: 'INTRO', index: 0, answers: {} },
      messages: { open: false, items: [] },
      doctor: { status: 'NOT_STARTED', linkId: null, selectionId: null },
      reveal: { status: 'LOCKED', revealAt: null },
    });
    expect(h.state.doctor.generation).toBeGreaterThan(generation);
    expect(h.state.quiz.questions[0]?.text).toBe('Who sleeps in on Sundays?');
    expect(h.state.eventName).toBe('Test');
    expect(h.state.settings.quizEnabled).toBe(false); // the host's choice carries over
  });
});
