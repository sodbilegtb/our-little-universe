import type { ApiErrorBody, GuestSession } from '@olu/shared';
import { ApiError, type AdminSession, type EventApi } from '../EventApi';

/*
 * EventApi over the REST API (services/api). Guests and the host authenticate
 * with bearer tokens. Cookies aren't used because the web app and the API run
 * on different domains, where browsers increasingly block them.
 */

interface RequestOptions {
  body?: unknown;
  auth?: string;
  timeoutMs?: number;
}

const guestAuth = (session: GuestSession) => `Bearer ${session.guestId}.${session.sessionToken}`;
const adminAuth = (admin: AdminSession) => `Bearer ${admin.token}`;

export function createHttpEventApi(baseUrl: string): EventApi {
  const root = baseUrl.replace(/\/$/, '');

  async function request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    let response: Response;
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers: {
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(options.auth ? { authorization: options.auth } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      throw new ApiError({ code: 'NETWORK', message: 'We can’t reach the party right now. Trying again…' });
    } finally {
      window.clearTimeout(timer);
    }

    if (response.status === 204) return undefined as T;
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Gateways can answer with HTML or nothing at all.
    }
    if (response.ok) return payload as T;

    // Gateway hiccups are transient: treat them like a dropped connection so callers retry.
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new ApiError({ code: 'NETWORK', message: 'The party server is busy. Trying again…' });
    }
    const error = (payload as { error?: ApiErrorBody } | null)?.error;
    throw new ApiError(error ?? { code: 'NOT_AVAILABLE', message: 'Something went wrong. Please try again.' });
  }

  return {
    getRevision: async () => (await request<{ revision: number }>('GET', '/v1/revision', { timeoutMs: 5000 })).revision,
    getGuestView: (session) => request('GET', '/v1/views/guest', { auth: session ? guestAuth(session) : undefined }),
    getTvView: () => request('GET', '/v1/views/tv'),
    getAdminView: (admin) => request('GET', '/v1/views/admin', { auth: adminAuth(admin) }),
    exportEvent: (admin) => request('GET', '/v1/admin/export', { auth: adminAuth(admin) }),

    // No push channel yet: clients rely on revision polling (WebSockets can plug in here later).
    subscribe: () => () => {},

    registerGuest: (input) => request('POST', '/v1/guests', { body: input }),
    castVote: (session, input) => request('POST', '/v1/votes', { body: input, auth: guestAuth(session) }),
    submitQuizAnswer: (session, input) => request('POST', '/v1/quiz/answers', { body: input, auth: guestAuth(session) }),
    submitMessage: (session, input) => request('POST', '/v1/messages', { body: input, auth: guestAuth(session) }),

    adminSignIn: async (password) => {
      const { token } = await request<{ token: string }>('POST', '/v1/admin/sessions', { body: { password } });
      return { token };
    },
    sendAdminCommand: (admin, command) => request('POST', '/v1/admin/commands', { body: command, auth: adminAuth(admin) }),
    submitRevealCode: (admin, code) => request('POST', '/v1/admin/reveal-code', { body: { code }, auth: adminAuth(admin) }),

    verifyDoctorLink: async () => {
      throw new ApiError({ code: 'INVALID_LINK', message: 'Doctor mode arrives in a later milestone.' });
    },
    submitDoctorSelection: async () => {
      throw new ApiError({ code: 'NOT_AVAILABLE', message: 'Doctor mode arrives in a later milestone.' });
    },

    dev: import.meta.env.DEV
      ? {
          reset: (admin) => request('POST', '/v1/dev/reset?seedGuests=9', { auth: adminAuth(admin) }),
          simulateActivity: (admin) => request('POST', '/v1/dev/simulate', { auth: adminAuth(admin) }),
        }
      : undefined,
  };
}
