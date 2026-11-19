import type {
  AdminCommand,
  AdminView,
  ApiErrorBody,
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
  RevealResult,
  SimulatedDoctorResult,
  TvView,
} from '@olu/shared';

export type Audience = 'guest' | 'tv' | 'admin';

/** Proof of host sign-in. In Milestone 3 this becomes an HttpOnly session cookie. */
export interface AdminSession {
  token: string;
}

/**
 * The single boundary between the UI and the backend.
 *
 * The mock implementation runs the real event rules (@olu/event-core) in the
 * browser. Milestone 3 adds an HTTP client for the Lambda REST API with the
 * same signatures, so screens do not change.
 */
export interface EventApi {
  /** The cheap "has anything changed?" call that clients poll every 1-2 seconds. */
  getRevision(audience: Audience): Promise<number>;

  /** Read models. Each role only ever receives its own projection. */
  getGuestView(session: GuestSession | null): Promise<GuestView>;
  getTvView(): Promise<TvView>;
  getAdminView(admin: AdminSession): Promise<AdminView>;
  /** Everything worth keeping (guests, votes, quiz answers, scores, all messages). Host only. */
  exportEvent(admin: AdminSession): Promise<EventExport>;

  /**
   * Optional push hint. The mock signals instantly across tabs; the HTTP client
   * relies on polling only (and can add WebSockets later behind this method).
   */
  subscribe(onChange: () => void): () => void;

  /** Guest actions. Votes and answers are idempotent; messages dedupe by clientMessageId. */
  registerGuest(input: RegisterGuestInput): Promise<GuestSession>;
  castVote(session: GuestSession, input: CastVoteInput): Promise<void>;
  submitQuizAnswer(session: GuestSession, input: QuizAnswerInput): Promise<void>;
  submitMessage(session: GuestSession, input: BabyMessageInput): Promise<void>;

  /** Host actions. Every call carries the admin session. */
  adminSignIn(password: string): Promise<AdminSession>;
  sendAdminCommand(admin: AdminSession, command: AdminCommand): Promise<void>;
  submitRevealCode(admin: AdminSession, code: string): Promise<RevealCodeResult>;
  /** The one valid doctor link; a new one retires the previous one. The URL is shown once. */
  createDoctorLink(admin: AdminSession): Promise<DoctorLinkResult>;
  /** Emails the same code again (never a new one). */
  resendRevealCode(admin: AdminSession): Promise<void>;
  /** Throws away the sealed answer and its code, before the reveal has begun. */
  resetSecret(admin: AdminSession): Promise<void>;
  /** TEST mode only: a random doctor answer, so a rehearsal can run end to end. */
  simulateDoctor(admin: AdminSession): Promise<SimulatedDoctorResult>;
  /** TEST mode only: starts the evening over as a new rehearsal run. Nothing is erased. */
  startNewRehearsal(admin: AdminSession): Promise<void>;

  /** Doctor actions. The selection travels one way only and is never read back. */
  verifyDoctorLink(token: string): Promise<DoctorSessionResult>;
  submitDoctorSelection(token: string, choice: DoctorChoice, submissionId: string): Promise<void>;

  /** The result, from the reveal moment on; null until then, whatever the reason. */
  getRevealResult(): Promise<RevealResult | null>;

  /** Local development aids. Absent against a deployed API. */
  dev?: DevTools;
}

export interface DevTools {
  /** Starts the event over, with placeholder guests so screens look realistic. */
  reset(admin: AdminSession): Promise<void>;
  /** Votes, answers or messages from placeholder guests, through the real rules. */
  simulateActivity(admin: AdminSession): Promise<void>;
  /** Test emails the local server or the preview "sent" (newest last). */
  outbox?(admin: AdminSession): Promise<{ subject: string; text: string }[]>;
  /** Mock only: cuts phones and the TV off for a while. */
  simulateOutage?(ms: number): void;
  outageEndsAt?(): number | null;
}

export class ApiError extends Error {
  readonly code: ApiErrorBody['code'];

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
  }
}

export const isNetworkError = (error: unknown) => error instanceof ApiError && error.code === 'NETWORK';

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}
