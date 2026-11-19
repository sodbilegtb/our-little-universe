# Our Little Universe

An interactive, synchronized gender reveal for our first baby. Guests join on their phones, the TV tells the story, the host runs the evening from a laptop, and the doctor seals the secret.

**Status: Milestone 3, backend foundations.** The REST API (`services/api`) runs locally, so real phones on your Wi-Fi can join. The browser-only preview still works without it. No AWS resources exist yet, no Terraform, no audio.

## Quick start

Requirements: Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. This is the browser-only preview: everything runs in your browser, and tabs stay in sync. The start page links every surface:

| Route | Surface | Notes |
| --- | --- | --- |
| `/tv` | TV presentation | Fixed 1920×1080 stage, scales to any screen. Press F11 for fullscreen. |
| `/admin` | Host desk | Any password works, unless you set `VITE_MOCK_ADMIN_PASSWORD` in `apps/web/.env.local`. |
| `/party` | Guest phone | Use `/party?slot=2` for a second guest in the same browser. |
| `/doctor/demo-test-link` | Doctor | Test link. The choice is never stored. |

### Walking through the evening

1. Open `/tv`, `/admin` and `/party` in **tabs of the same browser**. They stay in sync through `BroadcastChannel`.
2. Join as a guest on `/party`.
3. On the host desk, press the main button to move through each phase.
4. Before the quiz, edit the ten **Mom vs. Dad questions** on the host desk. They lock once the quiz starts.
5. Use **Preview tools → Simulate guest activity** to add votes, answers and messages from placeholder guests.
6. **Simulate connection drop** takes phones and the TV offline for 10 seconds, so you can see them reconnect and catch up.
7. **Reset the preview** starts over.

Useful in the browser console (dev only): `__olu.mockTools.simulateActivity()`, `__olu.mockTools.reset()`.

### With real phones on your Wi-Fi (local API)

```bash
npm run dev:local
```

This starts the API on port 8787 and the web app on port 5173 in HTTP mode. Then:

1. The API prints a **host password** for this run. Set `ADMIN_PASSWORD=...` to choose your own.
2. Open the TV page using the **Network** address Vite prints, for example `http://192.168.1.20:5173/tv`, not `localhost`. That way the QR code points somewhere phones can reach.
3. Phones on the same Wi-Fi scan the QR code and join the same event.
4. If macOS asks whether `node` may accept incoming connections, allow it.

Event data lives in `.local-data/event.json` and survives restarts. **Preview tools → Reset the preview** starts over. Doctor mode isn't available in this mode until Milestone 6; use the browser-only preview for it.

## Scripts

```bash
npm run dev        # Vite dev server for the web app (exposed on your LAN)
npm run build      # Type-check and production build
npm run typecheck  # Type-check all workspaces
npm test           # Unit and integration tests (Vitest)
npm run test:e2e      # End-to-end tests against the browser-only preview
npm run test:e2e:api  # The same evening against the real local API
npm run dev:api       # Only the API (port 8787)

# AWS (see docs/deployment.md; Terraform itself is always run by you)
npm run aws:build-api                 # Bundle the Lambda
npm run aws:set-password -- dev       # Store the host password hash in SSM
npm run aws:deploy-web -- dev         # Build and publish the web app to Amplify
npm run aws:smoke -- dev              # Check a deployed environment
ADMIN_PASSWORD=… npm run rehearse -- --env dev --guests 40   # Play a whole evening with simulated phones
```

Before the first end-to-end run, install the browser once: `npx playwright install chromium` (from `apps/web`).

## Structure

```
apps/web/                  React + TypeScript + Vite + Tailwind CSS v4
  src/components/          sky/ brand/ ui/ layout/ celebration/ constellation/
  src/features/            registration/ voting/ quiz/ messages/ reveal/ doctor/ admin/ tv/ finished/
  src/pages/               party/ tv/ admin/ doctor/ + DevLauncher
  src/services/api/        EventApi interface + mock implementation
  src/services/sync/       Revision poller, server clock, retries
  src/hooks/               useLiveView, useGuestSession
  e2e/                     Playwright tests
packages/shared/           Phases, API types, Zod schemas, leaderboard ranking
packages/event-core/       The event rules: state machine, guest actions, scoring, role-specific views
services/api/              REST API: Lambda handler, router, DynamoDB + in-memory repositories, local server
infrastructure/terraform/  Bootstrap, modules (database, api, hosting, monitoring), dev environment, tests
scripts/aws/               Web deployment and smoke test
docs/                      Architecture, API, data model, deployment, design system, milestone status
```

## What is real, mock, or still to come

**Working now**
- All guest, TV, host and doctor screens, with animations, reduced-motion support and keyboard focus states.
- The authoritative event rules in `packages/event-core`:
  - forward-only phases and host-paced quiz stages, with every invalid jump rejected;
  - one vote per guest, one answer per question, and safe retries;
  - questions that close on their own when time runs out;
  - scoring and a deterministic leaderboard;
  - up to 3 messages per guest, never duplicated by a resend;
  - quiz editing that locks once the quiz starts.
- Role-specific views: guests and the TV never receive a correct answer before the reveal.
- Sync by revision polling (1.5s, with backoff and pausing in hidden tabs), "Reconnecting…" states, automatic retries for guest actions, and server-clock countdowns.
- Host desk: quiz editor, message moderation, and JSON/CSV export.

- A REST API with the same rules (`docs/api.md`):
  - DynamoDB storage with conditional writes (`docs/data-model.md`);
  - hashed guest and host tokens;
  - scrypt host passwords and rate-limited sign-in;
  - structured logs that never contain secrets.
- A web HTTP client (`VITE_API_MODE=http`). Production HTTP builds contain no mock code.

- Terraform for the dev environment (`infrastructure/terraform`): DynamoDB, Lambda, HTTP API, Amplify Hosting, alarms and a budget. Formatted, validated and covered by `terraform test` with mocked AWS.

**Built but not yet run in AWS**
- Nothing has been applied. Follow [`docs/deployment.md`](docs/deployment.md) to plan, apply, deploy and rehearse.
- The DynamoDB repository passes the shared contract tests on a strict DynamoDB stand-in. Step 7 of the deployment guide runs them against real DynamoDB in a temporary table.

**Still mock**
- The browser-only preview (`services/api/mock`).
- The doctor workflow and reveal code: stubs until Milestone 6.

**Not started (by design)**
- The cinematic reveal sequence and result (Milestone 7). No gender value exists anywhere in this codebase.
- Audio. The TV emits scene cues (`src/lib/tvCues.ts`) as the extension point for future TV-only music.
- SES and KMS (Milestone 6) and the production environment (Milestone 8).

See [`docs/`](docs) for details.
