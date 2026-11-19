import {
  adminCommandSchema,
  adminSignInSchema,
  babyMessageSchema,
  castVoteSchema,
  quizAnswerSchema,
  registerGuestSchema,
  revealCodeRequestSchema,
} from '@olu/shared';
import type { z } from 'zod';
import { AppError, unauthorized } from '../app/errors';
import type { EventService, GuestCredential } from '../app/EventService';
import type { Logger } from '../app/logger';
import { parseBearer, parseGuestCredential } from '../security/tokens';
import { BadRequest, errorResponse, json, noContent } from './responses';
import type { ApiRequest, ApiResponse } from './types';

const MAX_BODY_BYTES = 16 * 1024;

interface Context {
  request: ApiRequest;
  service: EventService;
  /** Parses and validates the JSON body. */
  body<T extends z.ZodType>(schema: T): z.infer<T>;
  guest(): GuestCredential;
  optionalGuest(): GuestCredential | null;
  admin(): Promise<void>;
}

type Handler = (ctx: Context) => Promise<ApiResponse>;

/** The REST API. Paths are versioned so the contract can evolve without breaking old clients. */
const routes: Record<string, Handler> = {
  'GET /v1/health': async () => json(200, { ok: true }),

  'GET /v1/revision': async ({ service }) => json(200, { revision: await service.revision() }),

  'GET /v1/views/tv': async ({ service }) => json(200, await service.tvView()),
  'GET /v1/views/guest': async ({ service, optionalGuest }) => json(200, await service.guestView(optionalGuest())),
  'GET /v1/views/admin': async ({ service, admin }) => {
    await admin();
    return json(200, await service.adminView());
  },

  'POST /v1/guests': async ({ service, body }) => json(201, await service.registerGuest(body(registerGuestSchema))),
  'POST /v1/votes': async ({ service, guest, body }) => {
    await service.castVote(guest(), body(castVoteSchema));
    return noContent();
  },
  'POST /v1/quiz/answers': async ({ service, guest, body }) => {
    await service.submitQuizAnswer(guest(), body(quizAnswerSchema));
    return noContent();
  },
  'POST /v1/messages': async ({ service, guest, body }) => {
    await service.submitMessage(guest(), body(babyMessageSchema));
    return noContent();
  },

  'GET /v1/admin/export': async ({ service, admin }) => {
    await admin();
    return json(200, await service.exportEvent());
  },
  'POST /v1/admin/sessions': async ({ service, body, request }) => {
    const { password } = body(adminSignInSchema);
    return json(201, await service.adminSignIn(password, request.sourceIp));
  },
  'POST /v1/admin/commands': async ({ service, admin, body }) => {
    await admin();
    await service.adminCommand(body(adminCommandSchema));
    return noContent();
  },
  'POST /v1/admin/reveal-code': async ({ service, admin, body }) => {
    await admin();
    body(revealCodeRequestSchema);
    return json(200, await service.submitRevealCode());
  },

  // The doctor workflow lives in a separate, narrowly privileged component (Milestone 6).
  'POST /v1/doctor/selections': async () => {
    throw new AppError('NOT_AVAILABLE', 'Doctor mode arrives in a later milestone.', 501);
  },

  // Local development only (DEV_ROUTES=true; 404 everywhere else), and host-only.
  'POST /v1/dev/reset': async ({ service, request, admin }) => {
    service.assertDevRoutes();
    await admin();
    await service.devReset(Math.min(12, Math.max(0, Number(request.query.seedGuests ?? 0) || 0)));
    return noContent();
  },
  'POST /v1/dev/simulate': async ({ service, admin }) => {
    service.assertDevRoutes();
    await admin();
    await service.devSimulate();
    return noContent();
  },
};

export function createRouter(service: EventService, logger: Logger) {
  return async function route(request: ApiRequest): Promise<ApiResponse> {
    const started = Date.now();
    const routeKey = `${request.method.toUpperCase()} ${request.path.replace(/\/+$/, '') || '/'}`;
    const doctorLink = /^GET \/v1\/doctor\/links\/[^/]+$/.test(routeKey);
    const handler = routes[routeKey];

    const ctx: Context = {
      request,
      service,
      body(schema) {
        if (!request.body) throw new BadRequest('A JSON body is required.');
        if (Buffer.byteLength(request.body) > MAX_BODY_BYTES) throw new BadRequest('The request is too large.');
        let parsed: unknown;
        try {
          parsed = JSON.parse(request.body);
        } catch {
          throw new BadRequest('The request body isn’t valid JSON.');
        }
        return schema.parse(parsed);
      },
      guest() {
        const credential = parseGuestCredential(request.headers.authorization);
        if (!credential) throw unauthorized('Your session has expired. Please join again.');
        return credential;
      },
      optionalGuest() {
        return parseGuestCredential(request.headers.authorization);
      },
      async admin() {
        await service.requireAdmin(parseBearer(request.headers.authorization));
      },
    };

    let response: ApiResponse;
    let errorCode: string | undefined;
    try {
      if (doctorLink) throw new AppError('NOT_AVAILABLE', 'Doctor mode arrives in a later milestone.', 501);
      if (!handler) throw new AppError('NOT_FOUND', 'Not found.', 404);
      response = await handler(ctx);
    } catch (error) {
      const { response: failure, expected } = errorResponse(error);
      response = failure;
      errorCode = (JSON.parse(failure.body) as { error: { code: string } }).error.code;
      if (!expected) {
        logger.error('unhandled error', {
          requestId: request.requestId,
          route: handler ? routeKey : 'unknown',
          error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
        });
      }
    }

    logger.info('request', {
      requestId: request.requestId,
      route: handler || doctorLink ? routeKey.replace(/\/links\/[^/]+$/, '/links/:token') : 'unknown',
      status: response.status,
      ms: Date.now() - started,
      ...(errorCode ? { code: errorCode } : {}),
    });
    return response;
  };
}
