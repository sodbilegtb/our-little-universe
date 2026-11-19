import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { settle } from './machine';
import { toAdminView, toGuestView, toTvView } from './projections';
import { authorizeReveal, issueDoctorLink, recordDoctorSelection, resetSecret } from './secret';
import { upgradeState } from './state';
import { createHarness } from './testHarness';

const HOUR = 60 * 60 * 1000;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

/** Plays the evening up to the reveal phase. */
function toRevealPhase(h: ReturnType<typeof createHarness>) {
  h.commands('START_VOTING', 'CLOSE_VOTING', 'START_QUIZ', 'OPEN_QUESTION');
  for (let i = 0; i < 9; i += 1) h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'NEXT_QUESTION');
  h.commands('CLOSE_QUESTION', 'REVEAL_ANSWER', 'FINISH_QUIZ', 'START_MESSAGES', 'CLOSE_MESSAGES', 'START_REVEAL');
}

function sealed(h: ReturnType<typeof createHarness>, linkId = 'lnk_1', selectionId = 'sel_1') {
  h.run((s) => issueDoctorLink(s, { linkId, expiresAt: h.clock.now + 48 * HOUR }));
  return h.run((s) => recordDoctorSelection(s, { linkId, selectionId }, h.clock.now));
}

describe('doctor link', () => {
  it('accepts only the newest link, and only until it expires', () => {
    const h = createHarness();
    h.run((s) => issueDoctorLink(s, { linkId: 'lnk_old', expiresAt: h.clock.now + HOUR }));
    h.run((s) => issueDoctorLink(s, { linkId: 'lnk_new', expiresAt: h.clock.now + HOUR }));
    expect(codeOf(() => h.run((s) => recordDoctorSelection(s, { linkId: 'lnk_old', selectionId: 'sel_1' }, h.clock.now)))).toBe(
      'INVALID_LINK',
    );
    h.advance(HOUR + 1);
    expect(codeOf(() => h.run((s) => recordDoctorSelection(s, { linkId: 'lnk_new', selectionId: 'sel_1' }, h.clock.now)))).toBe(
      'INVALID_LINK',
    );
    expect(h.state.doctor.status).toBe('LINK_ISSUED');
  });

  it('seals one answer; repeats are harmless and a second answer is refused', () => {
    const h = createHarness();
    expect(sealed(h)).toBe('recorded');
    const before = structuredClone(h.state.doctor);
    h.advance(1_000);
    expect(h.run((s) => recordDoctorSelection(s, { linkId: 'lnk_1', selectionId: 'sel_1' }, h.clock.now))).toBe('already-recorded');
    expect(h.state.doctor).toEqual(before);
    expect(codeOf(() => h.run((s) => recordDoctorSelection(s, { linkId: 'lnk_1', selectionId: 'sel_2' }, h.clock.now)))).toBe(
      'ALREADY_SUBMITTED',
    );
    expect(codeOf(() => h.run((s) => issueDoctorLink(s, { linkId: 'lnk_2', expiresAt: h.clock.now + HOUR })))).toBe('LOCKED');
  });
});

describe('reset', () => {
  it('retires the sealed answer and the link, and bumps the generation', () => {
    const h = createHarness();
    sealed(h);
    const { retiredSelectionId } = h.run((s) => resetSecret(s));
    expect(retiredSelectionId).toBe('sel_1');
    expect(h.state.doctor).toMatchObject({ status: 'NOT_STARTED', generation: 1, linkId: null, selectionId: null });
    // the old link is dead; a new link works
    expect(codeOf(() => h.run((s) => recordDoctorSelection(s, { linkId: 'lnk_1', selectionId: 'sel_1' }, h.clock.now)))).toBe(
      'INVALID_LINK',
    );
    expect(sealed(h, 'lnk_2', 'sel_2')).toBe('recorded');
  });

  it('is impossible once the reveal has begun', () => {
    const h = createHarness();
    sealed(h);
    toRevealPhase(h);
    h.run((s) => authorizeReveal(s, { selectionId: 'sel_1', delayMs: 26_000 }, h.clock.now));
    expect(codeOf(() => h.run((s) => resetSecret(s)))).toBe('LOCKED');
  });
});

describe('reveal authorization', () => {
  it('needs the reveal phase and the current sealed answer', () => {
    const h = createHarness();
    sealed(h);
    expect(codeOf(() => h.run((s) => authorizeReveal(s, { selectionId: 'sel_1', delayMs: 26_000 }, h.clock.now)))).toBe(
      'WRONG_PHASE',
    );
    toRevealPhase(h);
    expect(codeOf(() => h.run((s) => authorizeReveal(s, { selectionId: 'sel_retired', delayMs: 26_000 }, h.clock.now)))).toBe(
      'NOT_FOUND',
    );
    expect(h.state.reveal.status).toBe('AWAITING_CODE');
  });

  it('sets the reveal time on the server clock and switches to REVEALED only then', () => {
    const h = createHarness();
    sealed(h);
    toRevealPhase(h);
    const startedAt = h.clock.now;
    expect(h.run((s) => authorizeReveal(s, { selectionId: 'sel_1', delayMs: 26_000 }, h.clock.now))).toBe('recorded');
    expect(h.state.reveal).toEqual({ status: 'REVEALING', startedAt, revealAt: startedAt + 26_000 });
    // entering the code again doesn't restart the countdown
    h.advance(5_000);
    expect(h.run((s) => authorizeReveal(s, { selectionId: 'sel_1', delayMs: 26_000 }, h.clock.now))).toBe('already-recorded');
    expect(h.state.reveal.revealAt).toBe(startedAt + 26_000);

    h.advance(20_999);
    expect(h.run((s) => settle(s, h.clock.now))).toBe(false);
    h.advance(1);
    expect(h.run((s) => settle(s, h.clock.now))).toBe(true);
    expect(h.state.reveal.status).toBe('REVEALED');
  });

  it('gives every audience times and statuses only', () => {
    const h = createHarness();
    sealed(h);
    toRevealPhase(h);
    h.run((s) => authorizeReveal(s, { selectionId: 'sel_1', delayMs: 26_000 }, h.clock.now));
    const views = [toTvView(h.state, h.clock.now, ''), toGuestView(h.state, null, h.clock.now), toAdminView(h.state, h.clock.now, '', 'TEST')];
    for (const view of views) {
      const text = JSON.stringify(view);
      expect(text).not.toContain('sel_1');
      expect(text).not.toContain('lnk_1');
    }
    expect(toTvView(h.state, h.clock.now, '').reveal).toEqual({
      status: 'REVEALING',
      startedAt: new Date(h.clock.now).toISOString(),
      revealAt: new Date(h.clock.now + 26_000).toISOString(),
    });
  });
});

describe('stored events from before milestone 6', () => {
  it('load with the new fields filled in', () => {
    const old = { doctor: { status: 'NOT_STARTED' }, reveal: { status: 'AWAITING_CODE' } } as never;
    expect(upgradeState(old)).toMatchObject({
      doctor: { status: 'NOT_STARTED', generation: 0, linkId: null, selectionId: null },
      reveal: { status: 'AWAITING_CODE', startedAt: null, revealAt: null },
    });
  });
});
