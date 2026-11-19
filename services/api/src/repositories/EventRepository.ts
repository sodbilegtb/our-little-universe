import type { EventState } from '@olu/event-core';
import type { ChangeSet } from '../domain/changeset';

export interface EventSnapshot {
  state: EventState;
  /** Version of the STATE item. Host commands write only if it is unchanged. */
  stateVersion: number;
  /** Bumped after every guest-visible activity (votes, answers, messages, guests). */
  activityVersion: number;
}

export interface RevisionInfo {
  stateVersion: number;
  activityVersion: number;
  /** Epoch ms after which the open question should be closed, or null. */
  settleAt: number | null;
}

export const combinedRevision = (r: { stateVersion: number; activityVersion: number }) => r.stateVersion + r.activityVersion;

/** Another request changed the same data first. The caller reloads and retries. */
export class ConcurrencyError extends Error {
  constructor(message = 'Concurrent update') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

/**
 * Storage for one environment. Implementations: DynamoDB (deployed) and
 * in-memory (tests and the local server). Both must pass the same contract tests.
 */
export interface EventRepository {
  /** Cheap, strongly consistent read of the versions only. Null if the event doesn't exist. */
  readRevision(eventId: string): Promise<RevisionInfo | null>;

  /** Strongly consistent read of the whole event. */
  load(eventId: string): Promise<EventSnapshot | null>;

  /** Creates the event if it doesn't exist yet. Never overwrites. */
  create(state: EventState): Promise<void>;

  /**
   * Persists a change set. A control change is written only if the STATE
   * version still equals `expectedStateVersion`; new items are written only if
   * they don't exist. Throws ConcurrencyError when a condition fails.
   */
  commit(eventId: string, expectedStateVersion: number, changes: ChangeSet): Promise<void>;

  putAdminSession(tokenHash: string, expiresAt: number): Promise<void>;
  hasAdminSession(tokenHash: string, now: number): Promise<boolean>;

  /** Fixed-window counter. Returns false once `limit` hits occurred in the window. */
  consumeRateLimit(key: string, windowMs: number, limit: number, now: number): Promise<boolean>;

  /** Local development only. */
  deleteEvent?(eventId: string): Promise<void>;
}
