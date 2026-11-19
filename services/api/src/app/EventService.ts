import {
  DomainError,
  EXAMPLE_QUESTIONS,
  applyAdminCommand,
  authenticateGuest,
  castVote,
  createEventState,
  registerGuest,
  seedSimulatedGuests,
  settle,
  simulateActivity,
  submitMessage,
  submitQuizAnswer,
  toAdminView,
  toEventExport,
  toGuestView,
  toTvView,
  type EventState,
  type GuestRecord,
  type Ids,
  type SimulationContext,
} from '@olu/event-core';
import type {
  AdminCommand,
  AdminView,
  BabyMessageInput,
  CastVoteInput,
  EventExport,
  GuestSession,
  GuestView,
  QuizAnswerInput,
  RegisterGuestInput,
  TvView,
} from '@olu/shared';
import type { AppConfig } from '../config/config';
import { diff, isEmpty } from '../domain/changeset';
import { combinedRevision, ConcurrencyError, type EventRepository, type EventSnapshot } from '../repositories/EventRepository';
import { verifyPassword } from '../security/password';
import { randomToken, sha256 } from '../security/tokens';
import { AppError, unauthorized } from './errors';
import { silentLogger, type Logger } from './logger';

export interface GuestCredential {
  guestId: string;
  sessionToken: string;
}

export interface ServiceDeps {
  config: AppConfig;
  repository: EventRepository;
  ids: Ids;
  clock?: () => number;
  logger?: Logger;
  /** Where the host password hash comes from (SSM when deployed). Defaults to config. */
  passwordHash?: () => Promise<string | undefined>;
}

const MAX_ATTEMPTS = 4;
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const SIGN_IN_LIMIT = 10;

/**
 * The use cases behind the API. Every write follows the same path:
 * load (strongly consistent) → settle time-based transitions → apply one rule
 * from @olu/event-core to a copy → diff → conditional commit. A lost race
 * reloads and re-runs the rule, so the rule always judges the latest state.
 */
export class EventService {
  private readonly config: AppConfig;
  private readonly repository: EventRepository;
  private readonly ids: Ids;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly passwordHash: () => Promise<string | undefined>;
  /** Warm Lambda containers reuse the last snapshot while the revision is unchanged. */
  private cache: { revision: number; snapshot: EventSnapshot } | null = null;

  constructor(deps: ServiceDeps) {
    this.config = deps.config;
    this.repository = deps.repository;
    this.ids = deps.ids;
    this.now = deps.clock ?? Date.now;
    this.logger = deps.logger ?? silentLogger;
    this.passwordHash = deps.passwordHash ?? (async () => deps.config.adminPasswordHash);
  }

  private get eventId() {
    return this.config.eventId;
  }

  /* ---------- state access ---------- */

  private async ensureEvent(): Promise<void> {
    const state = createEventState({ eventId: this.eventId, eventName: this.config.eventName, questions: EXAMPLE_QUESTIONS });
    await this.repository.create(state);
    this.logger.info('event created', { eventId: this.eventId });
  }

  private async loadFresh(): Promise<EventSnapshot> {
    let snapshot = await this.repository.load(this.eventId);
    if (!snapshot) {
      await this.ensureEvent();
      snapshot = await this.repository.load(this.eventId);
    }
    if (!snapshot) throw new AppError('NOT_AVAILABLE', 'The event could not be created.', 503);
    this.cache = { revision: combinedRevision(snapshot), snapshot };
    return snapshot;
  }

  /**
   * Applies `rule` to the latest state and persists what it changed.
   * Retries when another request committed first.
   */
  async mutate<T>(rule: (draft: EventState, now: number) => T): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const snapshot = await this.loadFresh();
      const now = this.now();
      const draft = structuredClone(snapshot.state);
      settle(draft, now);
      const result = rule(draft, now); // DomainErrors propagate unchanged
      const changes = diff(snapshot.state, draft);
      if (isEmpty(changes)) return result;
      try {
        await this.repository.commit(this.eventId, snapshot.stateVersion, changes);
        this.cache = null;
        return result;
      } catch (error) {
        if (!(error instanceof ConcurrencyError)) throw error;
        this.logger.debug('write conflict, retrying', { attempt });
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * attempt));
      }
    }
    throw new AppError('NOT_AVAILABLE', 'The party is very busy right now. Please try again.', 503);
  }

  /** The cheap call every client polls. Also closes a timed-out question. */
  async revision(): Promise<number> {
    const info = await this.repository.readRevision(this.eventId);
    if (!info) {
      await this.ensureEvent();
      return this.revision();
    }
    if (info.settleAt !== null && this.now() > info.settleAt) {
      await this.mutate(() => undefined); // mutate() settles before applying the no-op
      const settled = await this.repository.readRevision(this.eventId);
      return settled ? combinedRevision(settled) : combinedRevision(info);
    }
    return combinedRevision(info);
  }

  /** Current state for read models, reusing the cached snapshot while nothing changed. */
  private async current(): Promise<EventState> {
    const revision = await this.revision();
    const snapshot = this.cache && this.cache.revision === revision ? this.cache.snapshot : await this.loadFresh();
    return snapshot.state;
  }

  /* ---------- read models ---------- */

  async tvView(): Promise<TvView> {
    return toTvView(await this.current(), this.now(), this.config.joinUrl);
  }

  async guestView(credential: GuestCredential | null): Promise<GuestView> {
    const state = await this.current();
    const guest = credential ? this.findGuest(state, credential) : null;
    return toGuestView(state, guest?.id ?? null, this.now());
  }

  async adminView(): Promise<AdminView> {
    return toAdminView(await this.current(), this.now(), this.config.joinUrl);
  }

  /** The complete keepsake. Always read fresh (strongly consistent), never from the cache. */
  async exportEvent(): Promise<EventExport> {
    const snapshot = await this.loadFresh();
    this.logger.info('event exported', {
      guests: snapshot.state.guests.length,
      messages: snapshot.state.messages.items.length,
    });
    const state = structuredClone(snapshot.state);
    settle(state, this.now()); // a question past its deadline counts as closed, as in every view
    return toEventExport(state, this.now());
  }

  private findGuest(state: EventState, credential: GuestCredential): GuestRecord | null {
    try {
      return authenticateGuest(state, credential.guestId, sha256(credential.sessionToken));
    } catch {
      return null;
    }
  }

  /* ---------- guest actions ---------- */

  async registerGuest(input: RegisterGuestInput): Promise<GuestSession> {
    const rawToken = this.ids.sessionToken();
    const guest = await this.mutate((draft, now) => {
      const created = registerGuest(draft, input, { ...this.ids, sessionToken: () => rawToken }, now);
      created.sessionToken = sha256(rawToken); // only the hash is ever stored
      return { id: created.id, displayName: created.displayName };
    });
    return { guestId: guest.id, displayName: guest.displayName, sessionToken: rawToken };
  }

  private guestRule(credential: GuestCredential, action: (draft: EventState, guest: GuestRecord, now: number) => unknown) {
    return (draft: EventState, now: number) => {
      const guest = authenticateGuest(draft, credential.guestId, sha256(credential.sessionToken));
      action(draft, guest, now);
    };
  }

  async castVote(credential: GuestCredential, input: CastVoteInput): Promise<void> {
    await this.mutate(this.guestRule(credential, (draft, guest, now) => castVote(draft, guest, input, now)));
  }

  async submitQuizAnswer(credential: GuestCredential, input: QuizAnswerInput): Promise<void> {
    await this.mutate(this.guestRule(credential, (draft, guest, now) => submitQuizAnswer(draft, guest, input, now)));
  }

  async submitMessage(credential: GuestCredential, input: BabyMessageInput): Promise<void> {
    await this.mutate(this.guestRule(credential, (draft, guest, now) => submitMessage(draft, guest, input, this.ids, now)));
  }

  /* ---------- host ---------- */

  async adminSignIn(password: string, clientKey: string): Promise<{ token: string; expiresAt: string }> {
    const now = this.now();
    const hash = await this.passwordHash();
    if (!hash) {
      throw new AppError('NOT_AVAILABLE', 'Host sign-in isn’t configured on the server.', 503);
    }
    const allowed = await this.repository.consumeRateLimit(`signin:${sha256(clientKey)}`, SIGN_IN_WINDOW_MS, SIGN_IN_LIMIT, now);
    if (!allowed) throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait a few minutes.', 429);
    if (!(await verifyPassword(password, hash))) {
      this.logger.warn('host sign-in failed');
      throw unauthorized('That password isn’t right.');
    }
    const token = randomToken(32);
    const expiresAt = now + this.config.adminSessionMs;
    await this.repository.putAdminSession(sha256(token), expiresAt);
    this.logger.info('host signed in');
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async requireAdmin(token: string | null): Promise<void> {
    if (!token || !(await this.repository.hasAdminSession(sha256(token), this.now()))) {
      throw unauthorized('Please sign in to the host desk again.');
    }
  }

  async adminCommand(command: AdminCommand): Promise<void> {
    await this.mutate((draft, now) => applyAdminCommand(draft, command, now));
    this.logger.info('host command', { command: command.type });
  }

  /** Placeholder until the secure reveal workflow (Milestone 6). Never unlocks anything. */
  async submitRevealCode(): Promise<{ accepted: boolean; message: string }> {
    return {
      accepted: false,
      message: 'Reveal codes are verified by the secure reveal service, which arrives in a later milestone. Nothing was unlocked.',
    };
  }

  /* ---------- local development only ---------- */

  /** Called before authentication, so disabled dev routes look like any unknown route. */
  assertDevRoutes(): void {
    this.requireDevRoutes();
  }

  private requireDevRoutes(): void {
    if (!this.config.devRoutes) throw new AppError('NOT_FOUND', 'Not found.', 404);
  }

  private simulation(): SimulationContext {
    return {
      ids: this.ids,
      simulatedIds: { ...this.ids, guestId: () => `sim_${randomToken(9)}` },
      isSimulated: (guestId) => guestId.startsWith('sim_'),
    };
  }

  async devReset(seedGuests = 0): Promise<void> {
    this.requireDevRoutes();
    await this.repository.deleteEvent?.(this.eventId);
    this.cache = null;
    await this.ensureEvent();
    if (seedGuests > 0) {
      await this.mutate((draft, now) => seedSimulatedGuests(draft, seedGuests, this.simulation(), now - 60 * 60_000));
    }
  }

  async devSimulate(): Promise<void> {
    this.requireDevRoutes();
    await this.mutate((draft, now) => simulateActivity(draft, now, this.simulation()));
  }
}

export { DomainError };
