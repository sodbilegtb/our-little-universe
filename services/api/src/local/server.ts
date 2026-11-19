import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApp, createRepository } from '../app/createApp';
import { localSecrets } from '../app/EventService';
import { createLogger } from '../app/logger';
import { loadConfig } from '../config/config';
import { NOT_YET } from '../handlers/reveal';
import { readRevealResult } from '../reveal/revealResult';
import { hashPassword } from '../security/password';
import { parseBearer, randomToken } from '../security/tokens';
import type { ApiRequest } from '../http/types';

/*
 * Local development server: the same router the Lambda uses, on plain Node.
 * Defaults to in-memory storage mirrored to .local-data/, so phones on your
 * Wi-Fi can join a real, shared event without any AWS resources.
 *
 * Environment (all optional):
 *   PORT=8787                   listening port
 *   ADMIN_PASSWORD=...          local host password (otherwise one is generated and printed)
 *   REPOSITORY=dynamodb TABLE_NAME=... DYNAMODB_ENDPOINT=http://localhost:8000   use DynamoDB Local
 *   MEMORY_FILE=path            where in-memory data is mirrored ("none" to disable)
 *   ALLOWED_ORIGINS=a,b         CORS origins (default: any, local only)
 *
 * Secrets are kept in memory with a key that only lives for this run, and the
 * reveal code "email" lands in an outbox instead of being sent: it is printed
 * here, and GET /v1/dev/outbox (host only) returns it. Always TEST mode.
 */

const port = Number(process.env.PORT ?? 8787);

let password = process.env.ADMIN_PASSWORD;
const generated = !password && !process.env.ADMIN_PASSWORD_HASH;
if (generated) password = randomToken(9);

const config = loadConfig({
  REPOSITORY: 'memory',
  DEV_ROUTES: 'true',
  ...process.env,
  ENVIRONMENT: 'local',
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH ?? (password ? await hashPassword(password, { minLength: 1 }) : undefined),
});

const memoryFile =
  process.env.MEMORY_FILE === 'none' ? undefined : resolve(process.env.MEMORY_FILE ?? '.local-data/event.json');
const repository = createRepository(config, memoryFile);
const secrets = localSecrets(config, createLogger(config.logLevel, { environment: 'local' }));
const app = createApp(config, repository, { secrets: secrets.deps });
const outboxPrinted = new Set<string>();

/** The local stand-in for the reveal Lambda (GET /v1/reveal/result). */
async function revealResult() {
  const result = await readRevealResult({
    loadControl: async () => (await repository.load(config.eventId))?.state ?? null,
    store: secrets.store,
    opener: secrets.vault,
    environment: config.environment,
    eventId: config.eventId,
    now: Date.now,
  });
  return result ? { status: 200, body: result } : { status: 409, body: NOT_YET };
}
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim());

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin) return {};
  if (allowedOrigins && !allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) break; // the router rejects anything over 16 KB anyway
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : null;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const json = (status: number, body: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors }).end(JSON.stringify(body));
  if (req.method === 'GET' && url.pathname === '/v1/reveal/result') {
    const { status, body } = await revealResult();
    json(status, body);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/v1/dev/outbox') {
    try {
      await app.service.requireAdmin(parseBearer(req.headers.authorization));
      json(200, secrets.outbox.sent.map(({ subject, text, to, messageId }) => ({ subject, text, to, messageId })));
    } catch {
      json(401, { error: { code: 'UNAUTHORIZED', message: 'Please sign in to the host desk again.' } });
    }
    return;
  }
  const headers: ApiRequest['headers'] = {};
  for (const [name, value] of Object.entries(req.headers)) headers[name] = Array.isArray(value) ? value.join(',') : value;
  const response = await app.route({
    method: req.method ?? 'GET',
    path: url.pathname,
    headers,
    query: Object.fromEntries(url.searchParams),
    body: await readBody(req),
    sourceIp: req.socket.remoteAddress ?? 'local',
    requestId: randomUUID(),
  });
  res.writeHead(response.status, { ...response.headers, ...cors }).end(response.body);
  for (const mail of secrets.outbox.sent) {
    if (outboxPrinted.has(mail.messageId)) continue;
    outboxPrinted.add(mail.messageId);
    console.log(`\n  ✉  ${mail.subject} → ${mail.to.join(', ')}\n${mail.text.replace(/^/gm, '     ')}\n`);
  }
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
  console.log(`\n  Our Little Universe API (local, ${config.repository} storage)`);
  console.log(`  http://localhost:${port}${lan.length ? `  ·  ${lan.join('  ·  ')}` : ''}`);
  if (memoryFile && config.repository === 'memory') console.log(`  Data: ${memoryFile}`);
  if (generated) console.log(`  Host password for this run: ${password}`);
  console.log('');
});
