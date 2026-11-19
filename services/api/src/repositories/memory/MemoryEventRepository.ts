import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AnswerRecord, EventState, GuestRecord, MessageRecord, VoteRecord } from '@olu/event-core';
import { assembleState, controlOf, settleAt, type ChangeSet, type ControlState } from '../../domain/changeset';
import { ConcurrencyError, type EventRepository, type EventSnapshot, type RevisionInfo } from '../EventRepository';

interface StoredEvent {
  control: ControlState;
  stateVersion: number;
  activityVersion: number;
  guests: Record<string, GuestRecord>;
  votes: Record<string, VoteRecord>;
  /** Keyed "<questionId>#<guestId>", like the DynamoDB sort key. */
  answers: Record<string, AnswerRecord>;
  messages: Record<string, MessageRecord>;
}

interface StoredData {
  events: Record<string, StoredEvent>;
  adminSessions: Record<string, number>;
  rateLimits: Record<string, { count: number; expiresAt: number }>;
}

/**
 * In-memory storage with the same semantics as the DynamoDB repository:
 * conditional writes, all-or-nothing commits, guest secrets stored as given
 * (already hashed by the service). Optionally mirrored to a JSON file so the
 * local server survives restarts.
 */
export class MemoryEventRepository implements EventRepository {
  private data: StoredData;

  constructor(private readonly filePath?: string) {
    this.data = { events: {}, adminSessions: {}, rateLimits: {} };
    if (filePath && existsSync(filePath)) {
      this.data = JSON.parse(readFileSync(filePath, 'utf8')) as StoredData;
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data));
  }

  async readRevision(eventId: string): Promise<RevisionInfo | null> {
    const event = this.data.events[eventId];
    if (!event) return null;
    return { stateVersion: event.stateVersion, activityVersion: event.activityVersion, settleAt: settleAt(event.control) };
  }

  async load(eventId: string): Promise<EventSnapshot | null> {
    const event = this.data.events[eventId];
    if (!event) return null;
    const answers: Record<string, Record<string, AnswerRecord>> = {};
    for (const [key, answer] of Object.entries(event.answers)) {
      const [questionId, guestId] = key.split('#') as [string, string];
      (answers[questionId] ??= {})[guestId] = structuredClone(answer);
    }
    const state = assembleState(
      event.control,
      {
        guests: Object.values(event.guests).map((g) => structuredClone(g)),
        votes: structuredClone(event.votes),
        answers,
        messages: Object.values(event.messages).map((m) => ({ ...structuredClone(m), removed: m.removed === true })),
      },
      event.stateVersion + event.activityVersion,
    );
    return { state, stateVersion: event.stateVersion, activityVersion: event.activityVersion };
  }

  async create(state: EventState): Promise<void> {
    if (this.data.events[state.eventId]) return;
    this.data.events[state.eventId] = {
      control: controlOf(state),
      stateVersion: 1,
      activityVersion: 0,
      guests: {},
      votes: {},
      answers: {},
      messages: {},
    };
    this.persist();
  }

  async commit(eventId: string, expectedStateVersion: number, changes: ChangeSet): Promise<void> {
    const event = this.data.events[eventId];
    if (!event) throw new ConcurrencyError('Event does not exist');

    // Check every condition before applying anything (all or nothing).
    if (changes.control && event.stateVersion !== expectedStateVersion) throw new ConcurrencyError('STATE version changed');
    for (const g of changes.guestsAdded) if (event.guests[g.id]) throw new ConcurrencyError('guest exists');
    for (const v of changes.votesAdded) if (event.votes[v.guestId]) throw new ConcurrencyError('vote exists');
    for (const a of changes.answersAdded) {
      if (event.answers[`${a.questionId}#${a.guestId}`]) throw new ConcurrencyError('answer exists');
    }
    for (const m of changes.messagesAdded) if (event.messages[m.id]) throw new ConcurrencyError('message exists');
    for (const m of changes.messagesUpdated) if (!event.messages[m.id]) throw new ConcurrencyError('message missing');

    if (changes.control) {
      event.control = structuredClone(changes.control);
      event.stateVersion += 1;
    }
    for (const g of changes.guestsAdded) event.guests[g.id] = structuredClone(g);
    for (const v of changes.votesAdded) event.votes[v.guestId] = structuredClone(v.vote);
    for (const a of changes.answersAdded) event.answers[`${a.questionId}#${a.guestId}`] = structuredClone(a.answer);
    for (const a of changes.answersDeleted) delete event.answers[`${a.questionId}#${a.guestId}`];
    for (const m of changes.messagesAdded) event.messages[m.id] = structuredClone(m);
    for (const m of changes.messagesUpdated) {
      const stored = event.messages[m.id];
      if (stored) Object.assign(stored, { approved: m.approved, hidden: m.hidden, removed: m.removed });
    }

    const activity =
      changes.guestsAdded.length +
      changes.votesAdded.length +
      changes.answersAdded.length +
      changes.answersDeleted.length +
      changes.messagesAdded.length +
      changes.messagesUpdated.length;
    if (activity > 0) event.activityVersion += 1;
    this.persist();
  }

  async putAdminSession(tokenHash: string, expiresAt: number): Promise<void> {
    this.data.adminSessions[tokenHash] = expiresAt;
    this.persist();
  }

  async hasAdminSession(tokenHash: string, now: number): Promise<boolean> {
    const expiresAt = this.data.adminSessions[tokenHash];
    return expiresAt !== undefined && expiresAt > now;
  }

  async consumeRateLimit(key: string, windowMs: number, limit: number, now: number): Promise<boolean> {
    const window = Math.floor(now / windowMs);
    const id = `${key}#${window}`;
    const entry = this.data.rateLimits[id] ?? { count: 0, expiresAt: (window + 1) * windowMs };
    entry.count += 1;
    this.data.rateLimits[id] = entry;
    for (const [k, v] of Object.entries(this.data.rateLimits)) if (v.expiresAt < now) delete this.data.rateLimits[k];
    return entry.count <= limit;
  }

  async deleteEvent(eventId: string): Promise<void> {
    delete this.data.events[eventId];
    this.persist();
  }
}
