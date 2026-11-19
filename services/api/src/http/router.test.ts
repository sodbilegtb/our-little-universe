import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { EventService } from '../app/EventService';
import type { Logger } from '../app/logger';
import { toApiRequest } from '../handlers/http';
import { MemoryEventRepository } from '../repositories/memory/MemoryEventRepository';
import { hashPassword } from '../security/password';
import { serverIds } from '../security/tokens';
import type { AppConfig } from '../config/config';
import { testConfig } from '../testing/support';
import { createRouter } from './router';
import type { ApiRequest } from './types';

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('host password 123');
});

function setup(
  overrides: Record<string, string> = {},
  repository = new MemoryEventRepository(),
  patch: Partial<AppConfig> = {},
) {
  const logs: { message: string; fields?: Record<string, unknown> }[] = [];
  const logger: Logger = {
    debug: () => {},
    info: (message, fields) => logs.push({ message, fields }),
    warn: (message, fields) => logs.push({ message, fields }),
    error: (message, fields) => logs.push({ message, fields }),
  };
  const service = new EventService({
    config: { ...testConfig({ ADMIN_PASSWORD_HASH: passwordHash, ...overrides }), ...patch },
    repository,
    ids: serverIds,
  });
  const route = createRouter(service, logger);
  const call = async (method: string, path: string, options: { body?: unknown; auth?: string; raw?: string } = {}) => {
    const request: ApiRequest = {
      method,
      path,
      headers: options.auth ? { authorization: options.auth } : {},
      query: {},
      body: options.raw ?? (options.body === undefined ? null : JSON.stringify(options.body)),
      sourceIp: '192.0.2.10',
      requestId: 'req-1',
    };
    const response = await route(request);
    return { ...response, json: response.body ? (JSON.parse(response.body) as Record<string, any>) : null };
  };
  const signIn = async () => (await call('POST', '/v1/admin/sessions', { body: { password: 'host password 123' } })).json!.token as string;
  return { call, signIn, logs };
}

describe('HTTP API', () => {
  it('serves health, revision and public views with safe headers', async () => {
    const { call } = setup();
    expect((await call('GET', '/v1/health')).status).toBe(200);
    const revision = await call('GET', '/v1/revision');
    expect(revision.json).toEqual({ revision: 1 });
    expect(revision.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    expect((await call('GET', '/v1/views/tv')).json!.phase).toBe('LOBBY');
    expect((await call('GET', '/v1/views/guest')).json!.me).toBeNull();
  });

  it('returns 404 for unknown routes and methods', async () => {
    const { call } = setup();
    expect((await call('GET', '/v1/nope')).status).toBe(404);
    expect((await call('DELETE', '/v1/guests')).status).toBe(404);
  });

  it('validates input with clear 400 errors', async () => {
    const { call } = setup();
    const empty = await call('POST', '/v1/guests', { body: { displayName: '   ' } });
    expect(empty.status).toBe(400);
    expect(empty.json!.error).toEqual({ code: 'INVALID_INPUT', message: 'Please enter your name.' });
    expect((await call('POST', '/v1/guests', { raw: '{oops' })).json!.error.message).toMatch(/valid JSON/);
    expect((await call('POST', '/v1/guests')).status).toBe(400);
    expect((await call('POST', '/v1/guests', { body: { displayName: 'x'.repeat(17_000) } })).json!.error.message).toMatch(/too large/);
  });

  it('runs a guest flow over HTTP', async () => {
    const { call, signIn } = setup();
    const joined = await call('POST', '/v1/guests', { body: { displayName: 'Mia' } });
    expect(joined.status).toBe(201);
    const auth = `Bearer ${joined.json!.guestId}.${joined.json!.sessionToken}`;
    expect((await call('POST', '/v1/votes', { body: { choice: 'BOY' }, auth })).json!.error.code).toBe('WRONG_PHASE');
    const token = await signIn();
    expect((await call('POST', '/v1/admin/commands', { body: { type: 'START_VOTING' }, auth: `Bearer ${token}` })).status).toBe(204);
    expect((await call('POST', '/v1/votes', { body: { choice: 'BOY' }, auth })).status).toBe(204);
    expect((await call('POST', '/v1/votes', { body: { choice: 'GIRL' }, auth })).status).toBe(409);
    expect((await call('GET', '/v1/views/guest', { auth })).json!.voting.myVote).toBe('BOY');
  });

  it('requires credentials for guest and host actions', async () => {
    const { call, signIn } = setup();
    expect((await call('POST', '/v1/votes', { body: { choice: 'BOY' } })).status).toBe(401);
    expect((await call('POST', '/v1/votes', { body: { choice: 'BOY' }, auth: 'Bearer nonsense' })).status).toBe(401);
    expect((await call('POST', '/v1/admin/commands', { body: { type: 'START_VOTING' } })).status).toBe(401);
    expect((await call('GET', '/v1/views/admin', { auth: `Bearer ${'a'.repeat(43)}` })).status).toBe(401);
    expect((await call('POST', '/v1/admin/sessions', { body: { password: 'wrong one' } })).status).toBe(401);
    const token = await signIn();
    expect((await call('GET', '/v1/views/admin', { auth: `Bearer ${token}` })).status).toBe(200);
    expect((await call('GET', '/v1/views/tv')).json!.phase).toBe('LOBBY'); // nothing changed by the failures
  });

  it('never fails a CORS preflight that reaches the Lambda', async () => {
    const { call } = setup();
    for (const path of ['/v1/guests', '/v1/admin/sessions', '/v1/anything']) {
      const preflight = await call('OPTIONS', path);
      expect(preflight.status).toBe(204);
      expect(preflight.body).toBe('');
    }
  });

  it('rejects malformed host commands', async () => {
    const { call, signIn } = setup();
    const auth = `Bearer ${await signIn()}`;
    expect((await call('POST', '/v1/admin/commands', { body: { type: 'SELF_DESTRUCT' }, auth })).status).toBe(400);
    expect((await call('POST', '/v1/admin/commands', { body: { type: 'START_VOTING', phase: 'REVEAL' }, auth })).status).toBe(400);
    expect((await call('POST', '/v1/admin/commands', { body: { type: 'UPDATE_QUIZ_QUESTIONS', questions: [] }, auth })).status).toBe(400);
    expect((await call('POST', '/v1/admin/commands', { body: { type: 'START_QUIZ' }, auth })).json!.error.code).toBe('WRONG_PHASE');
  });

  it('runs the doctor workflow over HTTP, with the token only in request bodies', async () => {
    const { call, signIn, logs } = setup({ PUBLIC_APP_URL: 'https://app.example' });
    const auth = `Bearer ${await signIn()}`;
    expect((await call('POST', '/v1/admin/doctor/link')).status).toBe(401);
    const link = await call('POST', '/v1/admin/doctor/link', { auth });
    expect(link.status).toBe(201);
    expect(link.json!.url).toMatch(/^https:\/\/app\.example\/doctor#[A-Za-z0-9_-]{43}$/);
    const token = String(link.json!.url).split('#')[1];

    expect((await call('POST', '/v1/doctor/session', { body: { token } })).json).toEqual({ mode: 'TEST', status: 'READY' });
    expect((await call('POST', '/v1/doctor/session', { body: { token: 'x'.repeat(43) } })).status).toBe(404);
    const unconfirmed = { token, choice: 'GIRL', submissionId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' };
    expect((await call('POST', '/v1/doctor/selection', { body: unconfirmed })).status).toBe(400);
    const sealed = await call('POST', '/v1/doctor/selection', { body: { ...unconfirmed, confirmed: true } });
    expect(sealed.json).toEqual({ status: 'SEALED' });
    expect(sealed.body).not.toMatch(/GIRL|BOY/);
    expect((await call('POST', '/v1/doctor/session', { body: { token } })).json!.status).toBe('SEALED');

    expect((await call('POST', '/v1/admin/doctor/reset', { body: {}, auth })).status).toBe(400);
    expect((await call('POST', '/v1/admin/doctor/reset', { body: { confirm: 'RESET' }, auth })).status).toBe(204);
    expect((await call('POST', '/v1/doctor/session', { body: { token } })).status).toBe(404);
    expect(JSON.stringify(logs)).not.toContain(token);
  });

  it('allows the doctor simulation in test mode only', async () => {
    const test = setup();
    expect((await test.call('POST', '/v1/admin/doctor/simulate', { auth: `Bearer ${await test.signIn()}` })).json!.code).toMatch(
      /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/,
    );
    // The config itself refuses LIVE outside prod; patched here to test the service's own check.
    const live = setup({}, undefined, { revealMode: 'LIVE' });
    expect((await live.call('POST', '/v1/admin/doctor/simulate', { auth: `Bearer ${await live.signIn()}` })).status).toBe(404);
  });

  it('hides development routes outside local development', async () => {
    const { call } = setup({ DEV_ROUTES: 'false' });
    expect((await call('POST', '/v1/dev/reset')).status).toBe(404);
  });

  it('answers unexpected failures with a generic 500 and logs without secrets', async () => {
    const repository = new MemoryEventRepository();
    vi.spyOn(repository, 'readRevision').mockRejectedValue(new Error('disk on fire'));
    const { call, logs } = setup({}, repository);
    const response = await call('GET', '/v1/revision', { auth: 'Bearer secret-token-value-123456789' });
    expect(response.status).toBe(500);
    expect(response.body).not.toContain('disk on fire');
    const logged = JSON.stringify(logs);
    expect(logged).toContain('disk on fire');
    expect(logged).not.toContain('secret-token-value');
  });

  it('exports the whole evening for the host only, without secrets', async () => {
    const { call, signIn } = setup();
    const auth = `Bearer ${await signIn()}`;
    const joined = (await call('POST', '/v1/guests', { body: { displayName: 'Mia' } })).json!;
    const guestAuth = `Bearer ${joined.guestId}.${joined.sessionToken}`;
    await call('POST', '/v1/admin/commands', { body: { type: 'START_VOTING' }, auth });
    await call('POST', '/v1/votes', { body: { choice: 'GIRL' }, auth: guestAuth });
    const host = async (type: string) =>
      expect((await call('POST', '/v1/admin/commands', { body: { type }, auth })).status).toBe(204);
    await host('CLOSE_VOTING');
    await host('START_QUIZ');
    await host('OPEN_QUESTION');
    const firstQuestion = (await call('GET', '/v1/views/guest', { auth: guestAuth })).json!.quiz.question;
    await call('POST', '/v1/quiz/answers', { body: { questionId: firstQuestion.id, optionIndex: 1 }, auth: guestAuth });
    for (let i = 0; i < 10; i += 1) {
      await host('CLOSE_QUESTION');
      await host('REVEAL_ANSWER');
      await host(i < 9 ? 'NEXT_QUESTION' : 'FINISH_QUIZ');
    }
    await host('START_MESSAGES');
    await call('POST', '/v1/messages', { body: { clientMessageId: 'client-0001', text: 'Welcome, little star' }, auth: guestAuth });
    const [message] = (await call('GET', '/v1/views/admin', { auth })).json!.messages.items;
    await call('POST', '/v1/admin/commands', { body: { type: 'SET_MESSAGE_REMOVED', messageId: message.id, removed: true }, auth });

    expect((await call('GET', '/v1/admin/export')).status).toBe(401);
    expect((await call('GET', '/v1/admin/export', { auth: guestAuth })).status).toBe(401);

    const exported = await call('GET', '/v1/admin/export', { auth });
    expect(exported.status).toBe(200);
    expect(exported.headers['cache-control']).toBe('no-store');
    expect(exported.json).toMatchObject({
      format: 'our-little-universe/event-export',
      guests: [{ displayName: 'Mia' }],
      voting: { tally: { girl: 1, total: 1 }, votes: [{ displayName: 'Mia', choice: 'GIRL' }] },
      messages: [{ text: 'Welcome, little star', removed: true }],
    });
    expect(exported.json!.quiz.questions).toHaveLength(10);
    expect(exported.json!.quiz.questions[0]).toMatchObject({
      number: 1,
      scored: true,
      answers: [{ displayName: 'Mia', optionIndex: 1 }],
    });
    expect(exported.json!.quiz.leaderboard).toHaveLength(1);
    expect(exported.body).not.toContain(joined.sessionToken);
    expect(exported.body).not.toMatch(/sessionToken|tokenHash/);
  });

  it('never logs request bodies or tokens', async () => {
    const { call, logs } = setup();
    const joined = await call('POST', '/v1/guests', { body: { displayName: 'Secret Name' } });
    await call('GET', '/v1/views/guest', { auth: `Bearer ${joined.json!.guestId}.${joined.json!.sessionToken}` });
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain('Secret Name');
    expect(logged).not.toContain(joined.json!.sessionToken);
  });
});

describe('Lambda adapter', () => {
  it('maps an API Gateway v2 event, including base64 bodies and header case', () => {
    const event = {
      rawPath: '/v1/votes',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      queryStringParameters: { a: '1' },
      body: Buffer.from('{"choice":"BOY"}').toString('base64'),
      isBase64Encoded: true,
      requestContext: { http: { method: 'POST', sourceIp: '203.0.113.9' }, requestId: 'abc-123' },
    } as unknown as APIGatewayProxyEventV2;
    expect(toApiRequest(event)).toEqual({
      method: 'POST',
      path: '/v1/votes',
      headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
      query: { a: '1' },
      body: '{"choice":"BOY"}',
      sourceIp: '203.0.113.9',
      requestId: 'abc-123',
    });
  });
});
