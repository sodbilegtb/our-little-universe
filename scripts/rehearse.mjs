#!/usr/bin/env node
/*
 * Rehearses a whole evening against a running API: one host, one TV and many
 * simulated guest phones that poll the way real phones do.
 *
 *   ADMIN_PASSWORD=... npm run rehearse -- --api http://localhost:8787 --guests 30
 *   ADMIN_PASSWORD=... npm run rehearse -- --env dev --guests 40
 *
 * It checks that every vote, answer, score and message the server reports
 * matches what the simulated guests actually sent, including double taps,
 * retries and late arrivals, and measures how quickly phones see each change.
 *
 * It plays the event through to FINISHED, so it needs a fresh event (phase
 * LOBBY, no votes). It refuses to run against prod.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string' },
    env: { type: 'string' },
    guests: { type: 'string', default: '30' },
    poll: { type: 'string', default: '1500' },
    reset: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || (!args.api && !args.env)) {
  console.log(`Usage:
  ADMIN_PASSWORD=... npm run rehearse -- --api <url> [--guests 30] [--poll 1500] [--reset]
  ADMIN_PASSWORD=... npm run rehearse -- --env dev [--guests 30]

  --reset   start over first (local API only: uses the development reset route)`);
  process.exit(args.help ? 0 : 1);
}
if (args.env === 'prod' || /prod/i.test(args.api ?? '')) {
  console.error('The rehearsal plays an event to the end. It never runs against production.');
  process.exit(1);
}
if (args.env && args.env !== 'dev') {
  console.error('Only --env dev is supported.');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Set ADMIN_PASSWORD to the host password of that environment.');
  process.exit(1);
}

const api = args.env
  ? (await import('./aws/lib.mjs')).terraformOutputs(args.env).apiEndpoint.replace(/\/$/, '')
  : args.api.replace(/\/$/, '');
const GUESTS = Math.max(2, Math.min(200, Number.parseInt(args.guests, 10) || 30));
const POLL_MS = Math.max(500, Number.parseInt(args.poll, 10) || 1500);

/* ---------------------------------------------------------------- helpers */

const metrics = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function call(kind, method, path, { body, auth } = {}) {
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(auth ? { authorization: auth } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = response.status;
    const text = await response.text();
    return { status, body: text ? JSON.parse(text) : null };
  } catch (error) {
    return { status: 0, body: { error: { code: 'NETWORK', message: error.message } } };
  } finally {
    metrics.push({ kind, ms: performance.now() - started, status, at: started });
  }
}

const failures = [];
function check(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures.push(message);
    console.log(`  ✗ ${message}`);
  }
}

async function until(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(250);
  }
  failures.push(`timed out waiting for ${what}`);
  console.log(`  ✗ timed out waiting for ${what}`);
  return false;
}

/* --------------------------------------------------- propagation markers */

/** The change the host just made, and when each phone first saw it. */
let marker = null;
const propagation = [];

function mark(label, match) {
  if (marker) propagation.push(marker);
  marker = { label, match, t0: performance.now(), seen: new Map(), phones: guests.length };
}

/* ------------------------------------------------------------------ host */

let hostAuth;
async function host(type, extra = {}) {
  const result = await call('host', 'POST', '/v1/admin/commands', { body: { type, ...extra }, auth: hostAuth });
  if (result.status !== 204) {
    throw new Error(`${type} failed: ${result.status} ${result.body?.error?.message ?? ''}`);
  }
}
const adminView = async () => (await call('host', 'GET', '/v1/views/admin', { auth: hostAuth })).body;

/* ---------------------------------------------------------------- guests */

/** What the server must end up holding, built only from requests it accepted. */
const expected = { votes: new Map(), answers: new Map(), messages: new Map() };
const unexpected = [];
let stopped = false;

class Guest {
  constructor(name) {
    this.name = name;
    this.revision = -1;
    this.busy = false;
    this.messagesPlanned = Math.random() < 0.25 ? 2 : 1;
    this.messagesSent = 0;
  }

  async join() {
    const result = await call('action', 'POST', '/v1/guests', { body: { displayName: this.name } });
    if (result.status !== 201) throw new Error(`could not register ${this.name}: ${result.status}`);
    this.id = result.body.guestId;
    this.auth = `Bearer ${result.body.guestId}.${result.body.sessionToken}`;
  }

  async poll() {
    await sleep(between(0, POLL_MS));
    while (!stopped) {
      const rev = await call('revision', 'GET', '/v1/revision');
      if (rev.status === 200 && rev.body.revision !== this.revision) {
        const view = await call('view', 'GET', '/v1/views/guest', { auth: this.auth });
        if (view.status === 200) {
          this.revision = rev.body.revision;
          this.observe(view.body);
        }
      }
      await sleep(POLL_MS * between(0.8, 1.2));
    }
  }

  observe(view) {
    if (marker && !marker.seen.has(this.id) && marker.match(view)) {
      marker.seen.set(this.id, performance.now() - marker.t0);
    }
    if (this.busy) return;
    if (view.phase === 'VOTING' && view.voting.open && view.voting.myVote === null) {
      this.act(() => this.vote());
    } else if (view.phase === 'QUIZ' && view.quiz.stage === 'QUESTION_OPEN' && view.quiz.question && view.quiz.myAnswer === null) {
      this.act(() => this.answer(view.quiz.question));
    } else if (view.phase === 'MESSAGES' && view.messages.open && this.messagesSent < this.messagesPlanned) {
      this.act(() => this.message());
    }
  }

  act(fn) {
    this.busy = true;
    void (async () => {
      await sleep(between(400, 2500)); // reading the screen, thinking, tapping
      try {
        await fn();
      } finally {
        this.busy = false;
      }
    })();
  }

  /** Sends an action, then sometimes a double tap (same input) or a change of mind (other input). */
  async send(path, body, accept, other) {
    const first = await call('action', 'POST', path, { body, auth: this.auth });
    if (first.status < 200 || first.status > 299) {
      unexpected.push(`${this.name} ${path}: ${first.status} ${first.body?.error?.code ?? ''}`);
      return false;
    }
    accept();
    const roll = Math.random();
    if (roll < 0.15) {
      const again = await call('action', 'POST', path, { body, auth: this.auth });
      if (again.status < 200 || again.status > 299) unexpected.push(`${this.name} retry of ${path} was refused`);
    } else if (roll < 0.25 && other) {
      const changed = await call('action', 'POST', path, { body: other, auth: this.auth });
      if (changed.status !== 409) unexpected.push(`${this.name} changed an answer on ${path}: ${changed.status}`);
    }
    return true;
  }

  async vote() {
    const choice = pick(['BOY', 'GIRL']);
    await this.send('/v1/votes', { choice }, () => expected.votes.set(this.id, choice), {
      choice: choice === 'BOY' ? 'GIRL' : 'BOY',
    });
  }

  async answer(question) {
    const optionIndex = Math.floor(Math.random() * 4);
    await this.send(
      '/v1/quiz/answers',
      { questionId: question.id, optionIndex },
      () => {
        if (!expected.answers.has(question.id)) expected.answers.set(question.id, new Map());
        expected.answers.get(question.id).set(this.id, optionIndex);
      },
      { questionId: question.id, optionIndex: (optionIndex + 1) % 4 },
    );
  }

  async message() {
    const clientMessageId = randomUUID();
    const text = `Rehearsal note ${this.messagesSent + 1} from ${this.name}`;
    const ok = await this.send('/v1/messages', { clientMessageId, text }, () => {
      expected.messages.set(clientMessageId, { guestId: this.id, text });
    });
    if (ok) this.messagesSent += 1;
  }
}

/* --------------------------------------------------------------- the TV */

async function tvLoop() {
  let revision = -1;
  while (!stopped) {
    const rev = await call('revision', 'GET', '/v1/revision');
    if (rev.status === 200 && rev.body.revision !== revision) {
      revision = rev.body.revision;
      await call('view', 'GET', '/v1/views/tv');
    }
    await sleep(POLL_MS * between(0.8, 1.2));
  }
}

/* --------------------------------------------------------------- report */

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const fmt = (ms) => `${Math.round(ms)} ms`;

function report(startedAt) {
  const minutes = (performance.now() - startedAt) / 60_000;
  console.log('\nRequests');
  for (const kind of ['revision', 'view', 'action', 'host']) {
    const rows = metrics.filter((m) => m.kind === kind);
    if (rows.length === 0) continue;
    const ms = rows.map((m) => m.ms).sort((a, b) => a - b);
    const errors = rows.filter((m) => m.status === 0 || m.status >= 500).length;
    console.log(
      `  ${kind.padEnd(9)} ${String(rows.length).padStart(6)} calls   p50 ${fmt(percentile(ms, 50)).padStart(7)}   p95 ${fmt(percentile(ms, 95)).padStart(7)}   max ${fmt(ms.at(-1)).padStart(7)}   ${errors} server or network errors`,
    );
  }
  const total = metrics.length;
  // Busiest 10-second stretch: what the API's rate limit has to absorb.
  const times = metrics.map((m) => m.at).sort((a, b) => a - b);
  let peak = 0;
  for (let i = 0, j = 0; i < times.length; i += 1) {
    while (times[i] - times[j] > 10_000) j += 1;
    peak = Math.max(peak, i - j + 1);
  }
  console.log(
    `  ${total} requests in ${minutes.toFixed(1)} minutes: about ${Math.round(total / minutes / 60)} per second on average, ${Math.round(peak / 10)} per second at the busiest`,
  );

  if (marker) propagation.push(marker);
  console.log('\nHow long phones took to show each change');
  for (const step of propagation) {
    const ms = [...step.seen.values()].sort((a, b) => a - b);
    console.log(
      `  ${step.label.padEnd(16)} ${String(ms.length).padStart(3)}/${step.phones} phones   median ${fmt(percentile(ms, 50)).padStart(7)}   slowest ${fmt(ms.at(-1) ?? 0).padStart(7)}`,
    );
  }
}

let guests = [];

/* --------------------------------------------------------------- evening */

async function main() {
  console.log(`\nRehearsal against ${api} with ${GUESTS} guests (polling every ${POLL_MS} ms)\n`);

  const health = await call('host', 'GET', '/v1/health');
  if (health.status !== 200) throw new Error(`API not reachable (${health.status}).`);
  const session = await call('host', 'POST', '/v1/admin/sessions', { body: { password } });
  if (session.status !== 201) throw new Error(`Host sign-in failed: ${session.body?.error?.message ?? session.status}`);
  hostAuth = `Bearer ${session.body.token}`;

  if (args.reset) {
    const reset = await call('host', 'POST', '/v1/dev/reset', { auth: hostAuth });
    if (reset.status !== 204) throw new Error('Reset is only available on a local API.');
  }
  const start = await adminView();
  if (start.phase !== 'LOBBY' || start.voting.tally.total > 0) {
    throw new Error(
      `The event is already under way (phase ${start.phase}). Use a fresh event: --reset locally, or a new event_id in AWS.`,
    );
  }
  const existingGuests = start.guests.length;
  const startedAt = performance.now();
  const loops = [tvLoop()];

  console.log('Lobby');
  guests = Array.from({ length: GUESTS }, (_, i) => new Guest(`Rehearsal ${String(i + 1).padStart(2, '0')}`));
  // Phones arrive over a few seconds, several at the same moment.
  await Promise.all(guests.map(async (g) => (await sleep(between(0, 4000)), g.join())));
  loops.push(...guests.map((g) => g.poll()));
  check((await adminView()).guests.length === existingGuests + GUESTS, `${GUESTS} guests registered`);

  console.log('\nVoting');
  await host('START_VOTING');
  mark('voting opens', (v) => v.phase === 'VOTING');
  await until(() => expected.votes.size === guests.length, 60_000, 'every vote');
  await sleep(POLL_MS * 2);
  let view = await adminView();
  const boys = [...expected.votes.values()].filter((c) => c === 'BOY').length;
  check(view.voting.tally.total === expected.votes.size, `tally counts each guest once (${view.voting.tally.total})`);
  check(view.voting.tally.boy === boys && view.voting.tally.girl === expected.votes.size - boys, 'Boy and Girl counts match');

  await host('CLOSE_VOTING');
  const late = new Guest('Rehearsal late arrival');
  await late.join();
  const lateVote = await call('action', 'POST', '/v1/votes', { body: { choice: 'BOY' }, auth: late.auth });
  check(lateVote.status === 409, 'a vote after closing is refused');
  guests.push(late);
  loops.push(late.poll());

  console.log('\nQuiz');
  await host('START_QUIZ');
  const questions = (await adminView()).quiz.questions;
  for (let i = 0; i < questions.length; i += 1) {
    await host(i === 0 ? 'OPEN_QUESTION' : 'NEXT_QUESTION');
    mark(`question ${i + 1}`, (v) => v.phase === 'QUIZ' && v.quiz.stage === 'QUESTION_OPEN' && v.quiz.questionNumber === i + 1);
    await until(
      () => (expected.answers.get(questions[i].id)?.size ?? 0) === guests.length,
      (questions[i].timeLimitSec + 5) * 1000,
      `answers to question ${i + 1}`,
    );
    view = await adminView();
    if (view.quiz.stage === 'QUESTION_OPEN') await host('CLOSE_QUESTION');
    await host('REVEAL_ANSWER');
  }
  await host('FINISH_QUIZ');
  view = await adminView();
  const scores = new Map(view.leaderboard.map((e) => [e.guestId, e.score]));
  let mismatches = 0;
  for (const g of guests) {
    const want = questions.reduce(
      (sum, q) => sum + (expected.answers.get(q.id)?.get(g.id) === q.correctOptionIndex ? 100 : 0),
      0,
    );
    if ((scores.get(g.id) ?? 0) !== want) mismatches += 1;
  }
  check(mismatches === 0, `every score matches the answers sent (${guests.length} guests, 10 questions)`);
  const ranked = view.leaderboard.every((e, i, all) => i === 0 || all[i - 1].score >= e.score);
  check(ranked, 'leaderboard is ordered by score');

  console.log('\nMessages');
  await host('START_MESSAGES');
  mark('messages open', (v) => v.phase === 'MESSAGES');
  const planned = guests.reduce((sum, g) => sum + g.messagesPlanned, 0);
  await until(() => expected.messages.size === planned, 60_000, 'every message');
  await sleep(POLL_MS * 2);
  view = await adminView();
  const ours = view.messages.items.filter((m) => guests.some((g) => g.id === m.guestId));
  check(ours.length === planned, `each message stored exactly once (${ours.length})`);
  check(ours.every((m) => !m.approved), 'no message reaches the TV without approval');
  await host('SET_MESSAGE_REMOVED', { messageId: ours[0].id, removed: true });
  await host('SET_MESSAGE_REMOVED', { messageId: ours[0].id, removed: false });
  check((await adminView()).messages.items.length === view.messages.items.length, 'remove and restore keep the message');

  console.log('\nReveal and finish');
  await host('START_REVEAL');
  mark('reveal phase', (v) => v.phase === 'REVEAL');
  await sleep(POLL_MS * 3);
  await host('FINISH_EVENT');
  mark('finished', (v) => v.phase === 'FINISHED');
  await sleep(POLL_MS * 3);

  const exported = await call('host', 'GET', '/v1/admin/export', { auth: hostAuth });
  const data = exported.body;
  check(
    exported.status === 200 &&
      data.voting.votes.length === expected.votes.size &&
      data.messages.length === view.messages.items.length &&
      data.quiz.questions.every((q) => q.answers.filter((a) => guests.some((g) => g.id === a.guestId)).length === (expected.answers.get(q.id)?.size ?? 0)),
    'the export holds every vote, answer and message',
  );
  check(!JSON.stringify(data).includes(guests[0].auth.split('.')[1]), 'the export contains no session tokens');

  check(unexpected.length === 0, 'no guest action was unexpectedly refused');
  for (const line of unexpected.slice(0, 10)) console.log(`      ${line}`);

  stopped = true;
  await Promise.allSettled(loops);
  report(startedAt);
  const serverErrors = metrics.filter((m) => m.status === 0 || m.status >= 500).length;
  if (serverErrors > 0) failures.push(`${serverErrors} server or network errors`);

  console.log(failures.length ? `\n${failures.length} problem(s) found.\n` : '\nThe evening ran cleanly.\n');
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  stopped = true;
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
