# Milestone status

## Milestone 1: Premium UI/UX foundation (done)

- Monorepo, strict TypeScript, Vite 8, Tailwind CSS 4, Motion, React Router, Zod, Lucide.
- Design system, plus every guest, TV, host and doctor screen, running on mock data.
- See `design-system.md`.

## Milestone 2: Local event experience (done)

### Event core (`packages/event-core`)

The authoritative rules, written as pure TypeScript with no I/O:
- phase and quiz state machine with explicit guards;
- registration and session authentication;
- voting, answers, messages, quiz editing and scoring;
- guest, TV and admin views.

Every change goes through `transact()`, which copies the state, bumps the revision and leaves the original untouched if a rule fails. Clock and identifiers are injected, which keeps the rules deterministic in tests.

### Reliability

- **Idempotent retries.** Repeating the same vote or answer succeeds without counting twice; a different one is rejected.
- **No duplicate messages.** Each message carries a `clientMessageId`, and a resend returns the original.
- **Auto-closing questions.** `settle()` closes a question once its time plus a 1.5s grace has passed, on any read or write. No background timer is needed.
- **Server clock.** An offset keeps countdowns in step across devices.

### Sync

- `createRevisionPoller` polls every 1.5s with ±20% jitter.
- On failure it backs off exponentially, up to 15s.
- It pauses in hidden tabs and retries as soon as the device comes back online.
- Only one request is ever in flight.
- Guest actions retry on network errors only.
- A quiet "Reconnecting…" notice appears on phones, the TV and the host desk. A phone that can't connect at all sees "Finding the party…".

### Host desk

- **Quiz editor:** all 10 questions, each with four answers, the correct one, an optional note and a time limit. Changes are validated before saving and checked again by the rules. Questions lock once the quiz starts.
- **Admin session token:** required for every host call. Set `VITE_MOCK_ADMIN_PASSWORD` to require a password locally.
- **Preview tools:** "Simulate connection drop" takes the phones and TV offline for 10s while the host desk stays online.

### Guests

Up to 3 messages per guest, with "Write another". The limit is the `messagesPerGuest` setting.

### Tests

**Unit and integration tests** (Vitest):
- Phase transitions, each valid step and every rejected jump. (Spec test list #9 and #18.)
- Registration, late joining and forged sessions. (#1)
- Voting, including duplicate and closed-phase cases. (#2, #3)
- Answer validation, duplicates, grace period and auto-close. (#4, #5)
- No correct answer reaches guests or the TV before the reveal.
- Scoring and leaderboard ties. (#6, #7)
- Message persistence, deduplication, the per-guest limit and approval rules. (#8)
- Unauthorized admin actions. (#10)
- Export escaping. (#19)
- Revision poller backoff and visibility handling, plus the server clock.
- Mock adapter: outages and secrecy of the doctor's selection.

**End-to-end tests** (Playwright, `npm run test:e2e`; spec test list #20):
- the full evening on phone, TV and host desk;
- a dropped connection and recovery;
- late guests and a TV refresh;
- an auto-closing question;
- the quiz editor.

## Milestone 3: Backend foundations (done)

### `services/api`

- **Lambda handler** for an API Gateway HTTP API (payload v2).
- **Router:** no framework, a 16 KB body limit, Zod validation on every body, and consistent error codes and statuses.
- **Composition:** one root that wires the service and the repository.
- **Local Node server:** runs the same router, with CORS, LAN URLs and a generated host password.
- **Bundle:** esbuild bundles the handler for Node.js 22 into `dist/lambda/index.mjs`. The AWS SDK is provided by the runtime.

### `EventService`

Every use case runs load → settle → rule → diff → conditional commit. Lost races retry up to 4 times with jitter. A snapshot cache keyed by revision serves warm containers.

### Repositories

- **DynamoDB:** single table, conditional puts for guest actions, versioned `STATE` updates, a separate activity counter, paginated loads, sessions and rate limits with TTL.
- **In-memory:** identical semantics, optionally mirrored to `.local-data/event.json`.

### Security

- 256-bit tokens, stored only as SHA-256 hashes.
- Host passwords hashed with scrypt (`npm run hash-password -w @olu/api`).
- 10 sign-in attempts per 15 minutes per client.
- 12-hour host sessions.
- Dev routes are local-only and host-only.
- Config validation forbids memory storage or dev routes in deployed environments.

### Web

- `httpEventApi` uses timeouts and treats gateway errors as retryable.
- `VITE_API_MODE=http`, with the API URL defaulting to the same host on port 8787.
- Preview tools also work against the local server.
- `npm run dev:local` starts both.

### Tests

**80 API tests:**
- Change sets, security and configuration.
- The repository contract, run on memory and on the strict DynamoDB stand-in, plus real DynamoDB when `DYNAMODB_TEST_ENDPOINT` is set.
- DynamoDB request shapes, and the fidelity of the stand-in itself.
- The service on both backends, including concurrent votes, a double-tapped vote, simultaneous "Next question" clicks and simultaneous message resends.
- Settling through the revision check, cache reuse, sign-in, session expiry and rate limiting.
- HTTP statuses, validation, authentication, the doctor stubs, hidden dev routes, a generic 500 response and secret-free logs.
- The Lambda adapter.

**End-to-end:** the same Playwright evening runs against the real local API (`npm run test:e2e:api`). It covers the full evening, the quiz editor, late guests with a TV refresh, and auto-close.

### Not yet verified

The DynamoDB repository had not run against a real DynamoDB engine at the end of Milestone 3. Milestone 4 adds the command to run the same contract tests against AWS (`docs/deployment.md`, step 7).

## Milestone 4: Terraform development environment (built, not yet applied)

### Infrastructure (`infrastructure/terraform`)
- `bootstrap/`: versioned, encrypted, private S3 bucket for state with `prevent_destroy` and native lock files.
- Modules `database`, `api`, `hosting`, `monitoring`, and `environments/dev` wiring them together.
- DynamoDB on-demand with TTL and point-in-time recovery.
- Lambda Node.js 22 on arm64 with a least-privilege role: item access to one table, its own log group, read access to one SSM parameter.
- HTTP API with exact-origin CORS, throttling (150 requests per second, bursts of 300) and access logs without IP addresses.
- Amplify Hosting with SPA rewrites, a strict Content-Security-Policy and security headers.
- CloudWatch log retention of 14 days, alarms for Lambda errors, throttles and API 5xx, and an optional monthly budget alert.

### API
- The host password hash comes from SSM Parameter Store (SecureString), cached per container for 5 minutes. A missing parameter keeps guests playing and retries after 30 seconds.

### Scripts
- `npm run aws:build-api`, `aws:set-password`, `aws:deploy-web`, `aws:smoke`. None of them runs Terraform.

### Verified
- `terraform fmt`, `validate` and `terraform test` (15 runs across 6 suites, mocked AWS) pass.
- API tests (84) pass, including the SSM secret provider.

### Not yet verified
- Nothing has been applied to AWS. `terraform plan` against a real account, the deployment scripts, the smoke test, the contract tests against real DynamoDB, and the multi-device rehearsal all need your AWS credentials. The checklist is in `docs/deployment.md`.

## Milestone 5: Complete party functionality (done locally; AWS run pending)

### Messages can't be lost
- "Delete" is now "Remove": the message leaves the TV and the message exports, and the host can restore it from "Removed messages".
- No rule erases a message, and the API's storage layer refuses to turn a missing message into a delete.

### Keep the evening
- `GET /v1/admin/export` (host only) returns guests, votes, every quiz answer with its correctness, the final scores and all messages, read strongly consistent and without tokens.
- The host desk card "Keep the evening" downloads a complete JSON archive and CSV files for votes, quiz answers and scores.

### Rehearsal tool
- `npm run rehearse` plays a whole evening against any API with a host, a TV and simulated phones that poll like the real app, including double taps, changes of mind and a late arrival. It checks every count and score against what was sent and measures latency, peak request rate and how fast phones see each change.
- Locally with 40 and 100 phones: every check passes; phones see changes after 0.5 to 0.9 s (median), at most 1.8 s; traffic peaks at about 1.75 requests per second per phone.

### Infrastructure
- The API rate limit is configurable (`api_rate_limit`, default 300 per second, bursts of 600), enough for about 150 phones. Milestone 4's 150 would have throttled a 100-guest party.

### Verified
- Unit and integration tests, `terraform test`, and the end-to-end evening in the browser against the mock and against the real local API, now including remove, restore and the archive download.

### Not yet verified
- The rehearsal and real-device checklist against AWS (`docs/deployment.md`, steps 8 and 9). They need Milestone 4 applied.

## Milestone 6: Doctor security and email (next)

- Protected doctor link, secure random reveal code, encryption with KMS, SES email, test and live separation, reveal authorization.
