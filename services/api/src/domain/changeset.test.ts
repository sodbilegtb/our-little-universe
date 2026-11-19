import { describe, expect, it } from 'vitest';
import { applyAdminCommand, castVote, registerGuest, submitMessage, type Ids } from '@olu/event-core';
import { freshState } from '../testing/support';
import { assembleState, controlOf, diff, hasActivity, isEmpty, settleAt, UnsupportedChangeError } from './changeset';

const ids: Ids = { guestId: () => 'gst_1', sessionToken: () => 'tok', messageId: (g, c) => `msg_${g}_${c}` };

describe('change sets', () => {
  it('detects nothing for an unchanged state', () => {
    const state = freshState();
    expect(isEmpty(diff(state, structuredClone(state)))).toBe(true);
  });

  it('separates control changes from activity', () => {
    const before = freshState();
    const after = structuredClone(before);
    applyAdminCommand(after, { type: 'START_VOTING' }, 0);
    const changes = diff(before, after);
    expect(changes.control?.phase).toBe('VOTING');
    expect(hasActivity(changes)).toBe(false);

    const withGuest = structuredClone(after);
    const guest = registerGuest(withGuest, { displayName: 'Mia' }, ids, 1);
    castVote(withGuest, guest, { choice: 'BOY' }, 2);
    const activity = diff(after, withGuest);
    expect(activity.control).toBeNull();
    expect(activity.guestsAdded).toHaveLength(1);
    expect(activity.votesAdded).toEqual([{ guestId: 'gst_1', vote: { choice: 'BOY', castAt: 2 } }]);
  });

  it('records approval changes but refuses edits to message text', () => {
    const before = freshState();
    applyAdminCommand(before, { type: 'START_VOTING' }, 0);
    before.phase = 'MESSAGES';
    before.messages.open = true;
    const guest = registerGuest(before, { displayName: 'Mia' }, ids, 1);
    submitMessage(before, guest, { clientMessageId: 'client-0001', text: 'Hi' }, ids, 2);

    const approved = structuredClone(before);
    approved.messages.items[0]!.approved = true;
    expect(diff(before, approved).messagesUpdated).toEqual([
      { id: 'msg_gst_1_client-0001', approved: true, hidden: false, removed: false },
    ]);

    const removed = structuredClone(before);
    removed.messages.items[0]!.removed = true;
    expect(diff(before, removed).messagesUpdated).toEqual([
      { id: 'msg_gst_1_client-0001', approved: false, hidden: false, removed: true },
    ]);

    const edited = structuredClone(before);
    edited.messages.items[0]!.text = 'Changed';
    expect(() => diff(before, edited)).toThrow(UnsupportedChangeError);
  });

  it('never turns a missing message into a delete', () => {
    const before = freshState();
    before.phase = 'MESSAGES';
    before.messages.open = true;
    const guest = registerGuest(before, { displayName: 'Mia' }, ids, 1);
    submitMessage(before, guest, { clientMessageId: 'client-0001', text: 'Hi' }, ids, 2);
    const erased = structuredClone(before);
    erased.messages.items = [];
    expect(() => diff(before, erased)).toThrow(UnsupportedChangeError);
  });

  it('refuses to change or remove a recorded vote', () => {
    const before = freshState();
    before.phase = 'VOTING';
    before.voting.open = true;
    const guest = registerGuest(before, { displayName: 'Mia' }, ids, 1);
    castVote(before, guest, { choice: 'BOY' }, 2);
    const flipped = structuredClone(before);
    flipped.voting.votes[guest.id] = { choice: 'GIRL', castAt: 2 };
    expect(() => diff(before, flipped)).toThrow(UnsupportedChangeError);
    const removed = structuredClone(before);
    removed.voting.votes = {};
    expect(() => diff(before, removed)).toThrow(UnsupportedChangeError);
  });

  it('round-trips control and collections', () => {
    const state = freshState();
    const rebuilt = assembleState(controlOf(state), { guests: [], votes: {}, answers: {}, messages: [] }, state.revision);
    expect(rebuilt).toEqual(state);
  });

  it('computes when an open question should be settled', () => {
    const state = freshState();
    expect(settleAt(controlOf(state))).toBeNull();
    applyAdminCommand(state, { type: 'START_VOTING' }, 0);
    applyAdminCommand(state, { type: 'START_QUIZ' }, 0);
    applyAdminCommand(state, { type: 'OPEN_QUESTION' }, 1000);
    expect(settleAt(controlOf(state))).toBe(1000 + 20_000 + 1500);
  });
});
