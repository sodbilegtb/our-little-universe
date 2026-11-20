import {
  DomainError,
  EXAMPLE_QUESTIONS,
  applyAdminCommand,
  authenticateGuest,
  authorizeReveal,
  isCurrentDoctorLink,
  issueDoctorLink,
  recordDoctorSelection,
  resetSecret,
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
  startNewRun,
} from '@olu/event-core';
import type {
  AdminCommand,
  AdminView,
  BabyMessageInput,
  CastVoteInput,
  DoctorChoice,
  DoctorLinkResult,
  DoctorSessionResult,
  EventExport,
  GuestSession,
  GuestView,
  QuizAnswerInput,
  RegisterGuestInput,
  RevealCodeResult,
  RevealMode,
  SimulatedDoctorResult,
  TvView,
} from '@olu/shared';
import { randomInt, randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/config';
import { diff, isEmpty } from '../domain/changeset';
import { combinedRevision, ConcurrencyError, type EventRepository, type EventSnapshot } from '../repositories/EventRepository';
import { verifyPassword } from '../security/password';
import { randomToken, sha256 } from '../security/tokens';
import { InlineMailerTrigger, type MailerTrigger } from '../mail/trigger';
import { OutboxTransport } from '../mail/transport';
import { doctorTokenHash, generateRevealCode, normalizeRevealCode, revealCodeHash, selectionIdFor } from '../secret/codes';
import { MemorySecretStore, type ApiSecretStore, type DoctorLinkRecord } from '../secret/SecretStore';
import { LocalVault, type Sealer } from '../secret/vault';
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
  /** The secret workflow's dependencies. Only the local server may fall back to in-memory ones. */
  secrets?: SecretDeps;
  /** Tests: deterministic code generation. */
  randomPick?: (max: number) => number;
}

export interface SecretDeps {
  store: ApiSecretStore;
  sealer: Sealer;
  mailer: MailerTrigger;
}

/** In-memory secrets for the local server, with an outbox instead of email. */
export function localSecrets(config: AppConfig, logger: Logger, now: () => number = Date.now) {
  const store = new MemorySecretStore();
  const vault = new LocalVault();
  const outbox = new OutboxTransport();
  const mailer = new InlineMailerTrigger(
    {
      store,
      opener: vault,
      transport: outbox,
      logger,
      now,
      config: {
        environment: config.environment,
        eventId: config.eventId,
        eventName: config.eventName,
        appUrl: config.appUrl,
        mode: config.revealMode,
        sender: config.emailSender ?? 'reveal@localhost',
        recipients: config.emailRecipients.length ? config.emailRecipients : ['host@localhost'],
      },
    },
    logger,
  );
  return { store, vault, outbox, deps: { store, sealer: vault, mailer } satisfies SecretDeps };
}

const MAX_ATTEMPTS = 4;
const DOCTOR_WINDOW_MS = 15 * 60 * 1000;
const DOCTOR_LIMIT = 30;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const CODE_LIMIT = 10;
const CODE_REJECTED = 'That code doesn’t unlock the reveal. Check it and try again.';
const LINK_INVALID = 'This link isn’t valid or has expired. Please ask the parents for a new one.';
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
  private readonly secrets: SecretDeps;
  private readonly randomPick: (max: number) => number;
  /** Warm Lambda containers reuse the last snapshot while the revision is unchanged. */
  private cache: { revision: number; snapshot: EventSnapshot } | null = null;

  constructor(deps: ServiceDeps) {
    this.config = deps.config;
    this.repository = deps.repository;
    this.ids = deps.ids;
    this.now = deps.clock ?? Date.now;
    this.logger = deps.logger ?? silentLogger;
    this.passwordHash = deps.passwordHash ?? (async () => deps.config.adminPasswordHash);
    if (!deps.secrets && deps.config.environment !== 'local') {
      throw new Error('Deployed environments need the KMS-backed secret store');
    }
    this.secrets = deps.secrets ?? localSecrets(deps.config, this.logger, this.now).deps;
    this.randomPick = deps.randomPick ?? randomInt;
  }

  get mode(): RevealMode {
    return this.config.revealMode;
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

  /**
   * Loads the whole event. A DynamoDB query is not a snapshot: a guest's write
   * landing while it runs can be half visible (the new activity counter, but
   * not yet the answer behind it). So what was read is labelled with the
   * revision from before the read. That label can only be too low, which costs
   * a client one extra fetch; it can never let a stale view pass as current.
   */
  private async loadFresh(): Promise<EventSnapshot> {
    const before = await this.repository.readRevision(this.eventId);
    let snapshot = await this.repository.load(this.eventId);
    if (!snapshot) {
      await this.ensureEvent();
      snapshot = await this.repository.load(this.eventId);
    }
    if (!snapshot) throw new AppError('NOT_AVAILABLE', 'The event could not be created.', 503);
    const revision = before ? Math.min(combinedRevision(before), combinedRevision(snapshot)) : combinedRevision(snapshot);
    snapshot.state.revision = revision; // what every view reports; never part of a write
    this.cache = { revision, snapshot };
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
    const state = await this.current();
    const view = toAdminView(state, this.now(), this.config.joinUrl, this.mode);
    const { selectionId } = state.doctor;
    if (state.doctor.status === 'SUBMITTED' && selectionId) {
      const meta = await this.secrets.store.getSelectionMeta(this.eventId, selectionId);
      if (meta) {
        view.doctor.email = {
          status: meta.email.status,
          attempts: meta.email.attempts,
          sentAt: meta.email.sentAt === null ? null : new Date(meta.email.sentAt).toISOString(),
        };
        if (meta.email.status === 'SENT') view.doctor.status = 'CODE_SENT';
      }
    }
    return view;
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

  /* ---------- the secret: doctor link, sealed answer, reveal code ---------- */

  private sealContext(selectionId: string) {
    return { environment: this.config.environment, eventId: this.eventId, selectionId };
  }

  private async limit(key: string, windowMs: number, max: number): Promise<void> {
    const allowed = await this.repository.consumeRateLimit(key, windowMs, max, this.now());
    if (!allowed) throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait a few minutes.', 429);
  }

  /**
   * Issues the one valid doctor link. The token is returned once, inside the
   * URL fragment (browsers don't send fragments to servers or log them); only
   * its hash is stored. A new link retires the previous one.
   */
  async createDoctorLink(): Promise<DoctorLinkResult> {
    const { token, expiresAt } = await this.issueLink();
    const base = this.config.appUrl || '';
    this.logger.info('doctor link issued');
    return { url: `${base}/doctor#${token}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  private async issueLink(): Promise<{ token: string; linkId: string; expiresAt: number }> {
    const token = randomToken(32);
    const linkId = `lnk_${randomToken(12)}`;
    const expiresAt = this.now() + this.config.doctorLinkMs;
    // Store the link first: if the state change is refused, the link simply never becomes current.
    await this.secrets.store.putDoctorLink({ tokenHash: doctorTokenHash(token), eventId: this.eventId, linkId, expiresAt });
    await this.mutate((draft) => issueDoctorLink(draft, { linkId, expiresAt }));
    return { token, linkId, expiresAt };
  }

  /** The link record, if this token belongs to this event. Never says why a link is unusable. */
  private async findLink(token: string): Promise<DoctorLinkRecord> {
    const link = await this.secrets.store.findDoctorLink(doctorTokenHash(token));
    if (!link || link.eventId !== this.eventId) throw new AppError('INVALID_LINK', LINK_INVALID, 404);
    return link;
  }

  /** Checks a doctor link. Read-only: opening or refreshing the page never creates anything. */
  async doctorSession(token: string, clientKey: string): Promise<DoctorSessionResult> {
    await this.limit(`doctor:${sha256(clientKey)}`, DOCTOR_WINDOW_MS, DOCTOR_LIMIT);
    const link = await this.findLink(token);
    const { state } = await this.loadFresh();
    const { doctor } = state;
    if (doctor.status === 'SUBMITTED' && doctor.linkId === link.linkId) return { mode: this.mode, status: 'SEALED' };
    if (doctor.status !== 'LINK_ISSUED' || !isCurrentDoctorLink(state, link.linkId, this.now())) {
      throw new AppError('INVALID_LINK', LINK_INVALID, 404);
    }
    return { mode: this.mode, status: 'READY' };
  }

  /**
   * Seals the doctor's answer. The choice is encrypted at once and dropped; a
   * random code is generated, sealed with it and claimed as unique; then the
   * event records *that* an answer exists, and the mailer is asked to send the
   * code. Double clicks and retries (same submissionId) are harmless and
   * never create a second code.
   */
  async submitDoctorSelection(
    input: { token: string; choice: DoctorChoice; submissionId: string },
    clientKey: string,
  ): Promise<{ status: 'SEALED' }> {
    await this.limit(`doctor:${sha256(clientKey)}`, DOCTOR_WINDOW_MS, DOCTOR_LIMIT);
    const link = await this.findLink(input.token);
    await this.sealSelection(link, input.choice, input.submissionId);
    return { status: 'SEALED' };
  }

  /** Returns the plaintext code only to callers inside the service (the test-mode simulation). */
  private async sealSelection(link: DoctorLinkRecord, choice: DoctorChoice, submissionId: string): Promise<{ code: string | null }> {
    const state = (await this.loadFresh()).state;
    const alreadySealedHere = state.doctor.status === 'SUBMITTED' && state.doctor.linkId === link.linkId;
    if (!alreadySealedHere && !isCurrentDoctorLink(state, link.linkId, this.now())) {
      throw new AppError('INVALID_LINK', LINK_INVALID, 404);
    }
    const selectionId = selectionIdFor(link.linkId);
    const existing = await this.secrets.store.getSelectionMeta(this.eventId, selectionId);
    if (existing) {
      if (existing.submissionId !== submissionId) {
        throw new AppError('ALREADY_SUBMITTED', 'An answer has already been sealed with this link.', 409);
      }
      await this.recordSelection(link.linkId, selectionId); // finishes an interrupted earlier attempt
      return { code: null };
    }

    const context = this.sealContext(selectionId);
    const choiceCiphertext = await this.secrets.sealer.seal('doctor-selection', choice, context);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const code = generateRevealCode(this.randomPick);
      const result = await this.secrets.store.putSelection({
        eventId: this.eventId,
        selectionId,
        linkId: link.linkId,
        submissionId,
        generation: state.doctor.generation,
        choiceCiphertext,
        codeCiphertext: await this.secrets.sealer.seal('reveal-code', code, context),
        codeHash: revealCodeHash(this.config, code),
        createdAt: this.now(),
      });
      if (result === 'code-taken') continue; // astronomically rare; draw again
      if (result === 'exists') return this.sealSelection(link, choice, submissionId); // lost a race to a double click
      await this.recordSelection(link.linkId, selectionId);
      return { code };
    }
    throw new AppError('NOT_AVAILABLE', 'Please try again.', 503);
  }

  /** Marks the answer as sealed in the event; the first time, asks for the code email. */
  private async recordSelection(linkId: string, selectionId: string): Promise<void> {
    const outcome = await this.mutate((draft, now) => recordDoctorSelection(draft, { linkId, selectionId }, now));
    if (outcome === 'recorded') {
      this.logger.info('doctor answer sealed');
      await this.requestCodeEmail(selectionId);
    }
  }

  private async requestCodeEmail(selectionId: string): Promise<void> {
    try {
      await this.secrets.mailer.trigger({ eventId: this.eventId, selectionId });
    } catch (error) {
      // The answer is sealed either way; the host can send the code again.
      this.logger.error('could not request the reveal code email', { error: (error as Error).name });
    }
  }

  /** Sends the same code again (never a new one). */
  async resendRevealCode(): Promise<void> {
    const { doctor } = (await this.loadFresh()).state;
    if (doctor.status !== 'SUBMITTED' || !doctor.selectionId) {
      throw new AppError('WRONG_PHASE', 'There is no sealed answer yet.', 409);
    }
    await this.secrets.mailer.trigger({ eventId: this.eventId, selectionId: doctor.selectionId });
    this.logger.info('reveal code email requested again');
  }

  /**
   * Throws away the sealed answer, its code and the doctor link, so the doctor
   * can be asked again with a new link. Old codes stop working at once (the
   * event no longer points at their answer, and the answer is retired).
   */
  async resetSecret(): Promise<void> {
    const { retiredSelectionId } = await this.mutate((draft) => resetSecret(draft));
    if (retiredSelectionId) await this.secrets.store.retireSelection(this.eventId, retiredSelectionId);
    this.logger.warn('secret reset by the host');
  }

  /**
   * TEST mode only: plays the doctor with a random answer, so a rehearsal can
   * run end to end without anyone knowing (or choosing) the outcome. Returns
   * the code, which is fine for a rehearsal and impossible in LIVE mode.
   */
  async simulateDoctor(): Promise<SimulatedDoctorResult> {
    if (this.mode !== 'TEST') throw new AppError('NOT_FOUND', 'Not found.', 404);
    const { doctor } = (await this.loadFresh()).state;
    if (doctor.status === 'SUBMITTED') await this.resetSecret();
    const { token } = await this.issueLink();
    const choice: DoctorChoice = this.randomPick(2) === 0 ? 'BOY' : 'GIRL';
    const { code } = await this.sealSelection(await this.findLink(token), choice, randomUUID());
    if (!code) throw new AppError('NOT_AVAILABLE', 'Please try again.', 503);
    this.logger.info('doctor simulated (test mode)');
    return { code };
  }

  /**
   * TEST mode only: starts the evening over as a new rehearsal run, so the
   * whole flow (reveal included) can be tried again without a new event id.
   * Nothing is erased: the earlier run stays stored and stops being shown.
   * Guests of the earlier run are asked for their name again. LIVE: 404.
   */
  async startNewRehearsal(): Promise<void> {
    if (this.mode !== 'TEST') throw new AppError('NOT_FOUND', 'Not found.', 404);
    const { retiredSelectionId } = await this.mutate((draft) => startNewRun(draft));
    if (retiredSelectionId) await this.secrets.store.retireSelection(this.eventId, retiredSelectionId);
    this.logger.info('new rehearsal run started (test mode)');
  }

  /**
   * Checks the host's code and, if it belongs to the answer sealed for this
   * event right now, starts the reveal. Every way a code can be wrong gets the
   * same answer. Attempts are limited per event.
   */
  async submitRevealCode(code: string): Promise<RevealCodeResult> {
    const { state } = await this.loadFresh();
    if (state.phase !== 'REVEAL') {
      return { accepted: false, message: 'Start the reveal first, then enter the code.' };
    }
    await this.limit(`reveal-code:${this.eventId}`, CODE_WINDOW_MS, CODE_LIMIT);
    const normalized = normalizeRevealCode(code);
    if (!normalized) return { accepted: false, message: 'Codes look like R7KM-92PX-L4QT: 12 letters and digits.' };

    const found = await this.secrets.store.findCode(revealCodeHash(this.config, normalized));
    const meta = found && found.eventId === this.eventId ? await this.secrets.store.getSelectionMeta(this.eventId, found.selectionId) : null;
    if (!found || !meta || meta.status !== 'ACTIVE') {
      this.logger.warn('reveal code rejected');
      return { accepted: false, message: CODE_REJECTED };
    }
    try {
      await this.mutate((draft, now) => authorizeReveal(draft, { selectionId: found.selectionId, delayMs: this.config.revealDelayMs, code: normalized }, now));
    } catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') {
        this.logger.warn('reveal code rejected');
        return { accepted: false, message: CODE_REJECTED };
      }
      throw error;
    }
    const revealAt = (await this.loadFresh()).state.reveal.revealAt;
    this.logger.info('reveal code accepted');
    return {
      accepted: true,
      message: 'The code is right. The reveal has begun.',
      ...(revealAt === null ? {} : { revealAt: new Date(revealAt).toISOString() }),
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
