# Architecture (Milestone 6)

## Layers

```
screens ──► EventApi ──► mock adapter (browser preview) ──► @olu/event-core
                     └─► HTTP client ──► API Gateway ──► Lambda (services/api)
                                                          └─► EventService ──► @olu/event-core
                                                                           └─► EventRepository ──► DynamoDB
                                                                                               └─► memory (tests, local server)
```

- **`@olu/event-core`** holds every rule as pure functions over an `EventState`, with clock and ids injected. `transact()` applies a change to a copy and bumps the revision; a broken rule throws `DomainError` and leaves the state untouched. `settle(state, now)` applies time-based transitions lazily (a timed-out question closes on the next read or write), so the backend needs no timers.
- **`EventApi`** (`apps/web/src/services/api/EventApi.ts`) is the only thing screens know. The mock adapter adds storage, ids, admin tokens, latency and simulated outages around the core. Milestone 3's HTTP client keeps the same signatures.
- **`services/api`** runs the same core functions on the server. Every write follows one path:
  1. a strongly consistent load;
  2. `settle()`;
  3. apply one rule to a copy;
  4. `diff()` the before and after states into a change set;
  5. commit with conditional writes.

  If another request committed first, it reloads and re-runs the rule. That's why two simultaneous "Next question" clicks advance exactly once. See `data-model.md` and `api.md`.

The API returns **role-specific read models**, defined in `packages/shared/src/types.ts`:

- `GuestView`: the guest's own vote, answer, score and rank. It has no correct answers until the host reveals them.
- `TvView`: tallies, the public question, the leaderboard, message stars, and approved message text only.
- `AdminView`: everything the host needs, including quiz answers for editing. **It never includes the doctor's selection.**

No view type has a field that could carry the baby's gender. That is the first line of defense; KMS encryption and separate, narrowly privileged Lambdas are the second (`docs/security.md`).

## Synchronization

`useLiveView(audience, fetcher)` runs a revision poller (`services/sync/revisionPoller.ts`):
- It calls the cheap `getRevision` endpoint every 1.5s ± 20% jitter.
- It fetches the full view only when the revision moves.
- After failures it backs off exponentially, up to 15s.
- It pauses in hidden tabs and polls immediately when the tab becomes visible again or the browser comes back online.
- Only one request is ever in flight, and older revisions never overwrite newer ones.
- `api.subscribe` is an optional push hint: the mock uses `BroadcastChannel`, and API Gateway WebSockets can use it later.

Each view carries `serverTime`. `services/sync/serverClock.ts` keeps a smoothed offset, so countdowns end at the same moment on every device.

Guest actions retry on network errors only (`services/sync/retry.ts`). Retrying is safe because votes and answers are idempotent and messages dedupe by `clientMessageId`.

## Phases

`LOBBY → VOTING → QUIZ → MESSAGES → REVEAL → FINISHED`, defined in `packages/shared/src/phases.ts`. Transitions only move forward. The quiz has its own host-paced stages: `INTRO → QUESTION_OPEN → QUESTION_CLOSED → ANSWER_REVEALED → (LEADERBOARD) → … → RESULTS`. The mock enforces the same guards the backend will.

## Scoring

100 points per correct answer. Ties are broken by faster total response time on correct answers, then by earlier registration, then by guest id. Every rank is unique, so there is always one winner (`rankLeaderboard` in `packages/shared`).

## Future TV-only audio

The TV page emits a `TvCue` for every scene change (`src/lib/tvCues.ts`). A later milestone can attach a music controller on the TV device only. Guest phones never emit or receive cues.

## Decisions taken in Milestone 1

- **npm workspaces monorepo:** `apps/web` plus `packages/shared`, so the Lambda API (Milestone 3) reuses the same types and Zod schemas.
- **Tailwind v4, CSS-first:** design tokens live in `@theme` in `src/styles/index.css`.
- **Routes are code-split:** guests download only the party bundle.
- **No TanStack Query yet:** a small `useLiveView` hook covers mock sync. TanStack Query fits better once real HTTP polling and retries arrive in Milestone 3.
- **Up to 3 messages per guest.** This is the `messagesPerGuest` setting in event-core.
- **Admin session token on every host call.** The mock keeps it in sessionStorage; Milestone 3 moves it to an HttpOnly cookie.
- **Questions lock once the quiz starts,** so nobody sees a question change mid-game.

## Deployment (Milestone 4)

The dev environment runs the same `services/api` bundle as one Lambda behind an API Gateway HTTP API, with DynamoDB as the repository and the web app on Amplify Hosting. The host password hash is read from SSM Parameter Store at runtime, so no secret passes through Terraform. Infrastructure, decisions and costs: `infrastructure/terraform/README.md` and `docs/deployment.md`.

## The secret (Milestone 6)

```
doctor ──► API Lambda ──seal (KMS Encrypt only)──► secrets table
              │  └─ invoke (ids only) ──► mailer Lambda ──open code──► SES or Gmail ──► parents
host ──code──► API Lambda: hash, match, start reveal (revealAt)
TV ──GET /v1/reveal/result──► reveal Lambda ──open answer, from revealAt on──► { result }
```

Three Lambdas, three roles. Details, guarantees and limits: `docs/security.md`.
