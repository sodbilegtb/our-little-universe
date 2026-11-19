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

## Milestone 6: Doctor security and email (done, verified on AWS)

### Workflow
- **Doctor link:** the host creates a one-time doctor link (shown once, with a QR code). The token is in the URL fragment and only its hash is stored. It is valid for 48 h, and a new link retires the old one.
- **Doctor page:** checks the link read-only, then lets the doctor choose and confirm. A submission id per confirmation makes double clicks and retries harmless. Refreshing after sealing shows "Already sealed".
- **Sealing:** the answer is encrypted with KMS at once. A random code (about 59 bits, no prefix) is encrypted with it and claimed as unique. The event records only an opaque selection id.
- **Code email:** sent by a separate mailer Lambda via SES (subject `OFFICIAL BABY REVEAL CODE`, `[TEST]` in test mode). Failed sends are retried, and "Send the code again" always repeats the same code.
- **Reveal code:** verified by hash bound to environment and event, matched to the current sealed answer, with 10 attempts per 15 minutes per event. Accepting it starts the reveal with a server-side `revealAt` (26 s).
- **Result:** `GET /v1/reveal/result` is served by a separate, read-only reveal Lambda, only from `revealAt` on.
- **Reset:** retires the answer, its code and the link (typed confirmation; impossible once the reveal began).
- **Test and live:** set by the environment. dev and local are TEST; prod is LIVE unless explicitly set to TEST. "Simulate the doctor" exists in TEST only.

### Infrastructure
- New `secret` module: customer managed KMS key (rotation on), separate secrets table, mailer and reveal Lambdas.
- Access is split three ways (IAM down to table attributes, plus a key policy that denies opening the answer to every role but the reveal Lambda's):
  - the API may only encrypt;
  - the mailer may open only codes;
  - the reveal Lambda may open only the answer.
- New `email` module: SES identities for the sender (address or domain with DKIM) and the recipients.
- The reveal route goes to its own integration; the mailer and reveal Lambdas have error alarms.

### Verified
- **API (105 tests):** spec items 11 to 17 on both storage backends. Two runs, BOY and GIRL, produce byte-identical host desk, TV and guest responses, exports, emails and logs.
- **Rules:** 9 new event-core tests.
- **Browser:** 6 Playwright scenarios on the mock and the local API, including the doctor link, sealing, refresh, the reset and unlocking with the emailed code.
- **Terraform:** 20 `terraform test` runs; a mutation check proves the IAM tests catch a mailer that could open the answer.
- **Local rehearsal:** the whole secret flow passes.

### Verified on AWS (dev)
- KMS, the IAM attribute conditions, the reveal Lambda and the code email (SES from a DKIM-verified domain, Route 53 records written by Terraform) work on the dev deployment; the 20-guest rehearsal passes.
- The rehearsal found a real bug only DynamoDB can produce: a query is not a snapshot, so a view could carry a newer revision than its content. Loads are now labelled with the revision read before them, and clients fetch again when a view arrives behind the revision.
- Gmail (SMTP with an app password) exists as a second way to send the code email (`email_transport`).

### Security limits
- An AWS account administrator can change policies and decrypt on purpose. The design prevents accidental and application-level exposure. A stronger option (an external key custodian with a time-locked key policy) is described in `docs/security.md`.

## Milestone 7: Cinematic reveal (done locally; AWS deployment pending)

### The sequence
About 30 seconds on the TV, laid out around the server's `revealAt` (R), see `apps/web/src/features/reveal/timeline.ts`:

| From | Stage | On screen |
|---|---|---|
| code accepted | hush | "THE FINAL SECRET" fades, the room darkens, stars come out |
| R-21 s | gather | the stars converge and a heart of light is drawn |
| R-11 s | tension | the heart beats faster, then folds into one point |
| R-5 s | countdown | 5, 4, 3, 2, 1 |
| R | pause | a breath of darkness while the TV asks for the result |
| R+1.2 s | burst | a flash of light, the colour, confetti, "IT'S A BOY!" or "IT'S A GIRL!" |
| R+9 s | celebrate | the celebration settles |

- **Secrecy:** the TV requests the result only once the reveal moment has come (server clock), and the burst waits for it. Before that no page, bundle or response holds it; the end-to-end test against the real API checks that the first request comes 26 s after the code. Pink and blue (soft dawn tones) appear only from the burst on. Phones keep showing "Look at the big screen!".
- **Refresh:** the stage is computed from the server clock, so a refreshed TV picks up at the right moment; one that returns long after the burst shows the celebration without replaying it.
- **After the evening:** the thank-you screen shows the result too (the reveal service keeps answering in the finished phase, never before `revealAt`).
- **Reduced motion:** no moving stars, no flash, no confetti; the same moments as calm fades.
- **Music:** none. The sequence announces its stages (`reveal-build`, `reveal-countdown`, `reveal-burst`, `reveal-celebration`) as TV cues, ready for TV-only audio later.

### A new rehearsal (test mode only)
- "Start a new rehearsal" on the host desk, and `npm run rehearse -- --env dev --fresh`, start the evening over in the lobby, so the reveal can be tried again without a new `event_id`.
- Nothing is erased: guest, vote, answer and message items carry their run, and only the current run is loaded. The earlier run's sealed answer is retired, so its code unlocks nothing. Live mode refuses it (`404`).

### Verified
- Timeline unit tests; API tests for new runs (no deletes, old code dead, live refuses) on both storage backends; Playwright on the mock and the local API: the whole sequence, a refresh mid-sequence and after it, the result request timing, phones without the result, the thank-you screen, and a new rehearsal.
- Frame-by-frame review of the sequence at 1920×1080.

### Not yet verified
- On AWS and on the real TV (`docs/deployment.md`, step 9).

## Milestone 8: Production preparation (ready; deploying it is up to you)

### Production stack
- `environments/prod`: the same modules with their own state, tables, KMS key, Lambdas, Amplify app and host password.
- `reveal_mode` has no default and accepts only `TEST` (dress rehearsal) or `LIVE`; `event_id` is required too. Going live is a written change that shows in the plan.
- Both tables refuse deletion and keep point-in-time recovery; the KMS key waits 30 days; logs are kept 30 days; alarms and budget emails are required.
- The SES identities are reused from dev (same account) instead of created twice; the plan fails if one isn't verified. The email module gained `manage_identities` for this.
- Only the production web app may call the production API.

### Tools
- `npm run aws:preflight -- <env>`: read-only go/no-go (mode and event, API and web app, host password, email path and verified identities, Lambda concurrency, alarm subscription, and with `ADMIN_PASSWORD` the doctor's status).
- `aws:deploy-web -- prod` shows mode and event and asks for a typed confirmation; `SMOKE_WRITE` and the rehearsal tool refuse prod.

### Reviews
- Security: [`security-review.md`](security-review.md).
- Costs and the runbook for the dress rehearsal, the switch to LIVE, the doctor and the evening: [`production.md`](production.md).

### Verified
- `terraform test` for prod (mode reaches every Lambda, `live` and missing alarm or recipient refused, deletion protection, reused identities, CORS) with mutation checks; email module tests for reused and unverified identities; a config test that only prod can be LIVE.
- `aws:preflight` against stand-ins for the AWS CLI and Terraform plus the local API.

### Not yet done (yours to decide and run)
- `terraform apply` for prod, the dress rehearsal on real devices, the switch to LIVE, and the doctor's visit.

## Milestone 9: Export and cleanup (ready; you run it after the party)

### Keeping the memories
- `npm run aws:export -- <env>` saves the evening to `exports/` (ignored by Git): `event.json` with everything and the result, CSV files, a printable `memory-book.html` (every message except removed ones, the result, the guesses, the quiz winner) and `manifest.json` with a SHA-256 checksum and row count per file. It checks the copy right away; `--verify <folder>` checks any copy later.
- `npm run aws:backup -- <env>`: an on-demand DynamoDB backup, which stays after the table is deleted.
- CSV files (here and on the host desk) defuse spreadsheet formulas in guest names and messages.

### Removing it safely
- `npm run aws:teardown-check -- <env>`, read-only: for prod it requires a verified export of the current event made after the evening, and a backup newer than that; for dev it requires prod to be gone (prod sends with dev's email identities). It prints the commands; it never runs them.
- Prod's deletion protection comes off only with `allow_destroy = true`, a separate plan and apply.
- [`after-the-party.md`](after-the-party.md): the order, the commands, and what stays afterwards (backups, SSM parameters, KMS keys waiting out their deletion window, the state bucket).

### Verified
- `node --test` for the archive: CSV round trip with quotes, line breaks, emoji and formula guards; a whole archive verifies, a changed or missing file is reported; the memory book escapes HTML and leaves out removed messages; the result appears only once revealed.
- The export end to end against the local API after a rehearsal; backup and teardown check against stand-ins for the AWS CLI and Terraform (ready, missing export, missing backup, dev while prod exists); prod `terraform test` for `allow_destroy`.
