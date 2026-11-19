import { parseEnv, terraformOutputs } from './lib.mjs';

/*
 * Checks a deployed environment from the outside:
 *   npm run aws:smoke -- dev
 *   ADMIN_PASSWORD=... npm run aws:smoke -- dev     (also checks host sign-in)
 *   SMOKE_WRITE=1 npm run aws:smoke -- dev          (also registers a test guest)
 * Read-only by default, so it is safe to run against prod.
 */

const env = parseEnv(process.argv);
const out = terraformOutputs(env);
const api = out.apiEndpoint.replace(/\/$/, '');
let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

async function call(path, init = {}) {
  const started = Date.now();
  const response = await fetch(`${api}${path}`, init);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body, ms: Date.now() - started };
}

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

console.log(`\nSmoke test: ${env}\n  app ${out.appUrl}\n  api ${api}\n`);

await check('API health', async () => {
  const { response, ms } = await call('/v1/health');
  expect(response.ok, `HTTP ${response.status}`);
  return `${ms} ms`;
});

await check('Revision (creates the event on first call)', async () => {
  const { body } = await call('/v1/revision');
  expect(Number.isInteger(body?.revision), 'no revision');
  return `revision ${body.revision}`;
});

await check('TV view', async () => {
  const { body } = await call('/v1/views/tv');
  expect(body?.phase, 'no phase');
  expect(body.joinUrl === `${out.appUrl}/party`, `joinUrl is ${body.joinUrl}`);
  return `phase ${body.phase}, ${body.guestCount} guests`;
});

// A browser sends this preflight before every POST (joining, voting, host
// sign-in) and only proceeds on a 2xx response that allows the method and headers.
for (const path of ['/v1/guests', '/v1/admin/sessions']) {
  await check(`Browsers may POST to ${path} (CORS preflight)`, async () => {
    const response = await fetch(`${api}${path}`, {
      method: 'OPTIONS',
      headers: { origin: out.appUrl, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    expect(response.status >= 200 && response.status < 300, `preflight answered HTTP ${response.status}`);
    expect(response.headers.get('access-control-allow-origin') === out.appUrl, 'origin not allowed');
    const methods = (response.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    expect(methods.includes('POST'), `POST not allowed (${methods || 'no methods'})`);
    const headers = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(headers.includes('content-type') && headers.includes('authorization'), `headers not allowed (${headers || 'none'})`);
  });
}

await check('CORS refuses other sites', async () => {
  const response = await fetch(`${api}/v1/votes`, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
  });
  expect(!response.headers.get('access-control-allow-origin'), 'foreign origin allowed');
});

await check('Host actions require sign-in', async () => {
  const { response } = await call('/v1/admin/commands', { method: 'POST', body: '{"type":"START_VOTING"}' });
  expect(response.status === 401, `HTTP ${response.status}`);
});

await check('Development routes are disabled', async () => {
  const { response } = await call('/v1/dev/reset', { method: 'POST' });
  expect(response.status === 404, `HTTP ${response.status}`);
});

if (process.env.ADMIN_PASSWORD) {
  await check('Host sign-in', async () => {
    const { response, body } = await call('/v1/admin/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
    });
    expect(response.status === 201, body?.error?.message ?? `HTTP ${response.status}`);
  });
}

if (process.env.SMOKE_WRITE === '1') {
  await check('Guest registration and session', async () => {
    const joined = await call('/v1/guests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Smoke test' }),
    });
    expect(joined.response.status === 201, `HTTP ${joined.response.status}`);
    const view = await call('/v1/views/guest', {
      headers: { authorization: `Bearer ${joined.body.guestId}.${joined.body.sessionToken}` },
    });
    expect(view.body?.me?.displayName === 'Smoke test', 'session not restored');
  });
}

await check('Web app serves deep links with security headers', async () => {
  const response = await fetch(`${out.appUrl}/party`);
  expect(response.ok, `HTTP ${response.status}`);
  const csp = response.headers.get('content-security-policy') ?? '';
  expect(csp.includes("script-src 'self'"), 'missing Content-Security-Policy');
});

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
