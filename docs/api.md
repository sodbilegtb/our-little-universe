# REST API (v1)

One Lambda behind an API Gateway HTTP API. Locally, `npm run dev:api` serves the same router on port 8787.

All bodies are JSON, at most 16 KB, and validated with the Zod schemas in `packages/shared`. Responses carry `cache-control: no-store`.

## Authentication

| Who | Header | Obtained from |
|---|---|---|
| Guest | `Authorization: Bearer <guestId>.<sessionToken>` | `POST /v1/guests` |
| Host | `Authorization: Bearer <token>` | `POST /v1/admin/sessions` |

- Tokens are 256-bit random values. The server stores only their SHA-256 hashes.
- Host sessions expire after `ADMIN_SESSION_HOURS` (default 12).
- Host sign-in allows 10 attempts per 15 minutes per client address.
- **Why bearer tokens and not cookies:** the web app (Amplify) and the API (API Gateway) run on different domains. Browsers, Safari especially, block cookies between them.

## Endpoints

| Method and path | Auth | Body | Success |
|---|---|---|---|
| `GET /v1/health` | none | | `200 {ok}` |
| `GET /v1/revision` | none | | `200 {revision}` |
| `GET /v1/views/tv` | none | | `200 TvView` |
| `GET /v1/views/guest` | optional guest | | `200 GuestView` (`me: null` without a valid credential) |
| `GET /v1/views/admin` | host | | `200 AdminView` |
| `GET /v1/admin/export` | host | | `200 EventExport`: guests, votes, every quiz answer, scores and all messages (removed ones flagged). Read strongly consistent. No tokens |
| `POST /v1/guests` | none | `{displayName}` | `201 {guestId, displayName, sessionToken}` |
| `POST /v1/votes` | guest | `{choice: "BOY" \| "GIRL"}` | `204` |
| `POST /v1/quiz/answers` | guest | `{questionId, optionIndex}` | `204` |
| `POST /v1/messages` | guest | `{clientMessageId, text}` | `204` |
| `POST /v1/admin/sessions` | none | `{password}` | `201 {token, expiresAt}` |
| `POST /v1/admin/commands` | host | an `AdminCommand` | `204` |
| `POST /v1/admin/reveal-code` | host | `{code}` | `200 {accepted: false, message}` until Milestone 6 |
| `GET /v1/doctor/links/:token`, `POST /v1/doctor/selections` | | | `501` until Milestone 6 |
| `POST /v1/dev/reset?seedGuests=n`, `POST /v1/dev/simulate` | host | | `204`. Local only; `404` when `DEV_ROUTES` is off |

Notes on specific endpoints:
- **`GET /v1/revision`** is polled every ~1.5s. Calling it also closes a question whose time has run out.
- **`POST /v1/votes`** succeeds again if the same vote is repeated.
- **`POST /v1/quiz/answers`** succeeds again if the same answer is repeated.
- **`POST /v1/messages`** is deduplicated by `clientMessageId`.
- **`SET_MESSAGE_REMOVED`** is the only way to take a message away, and it is reversible. No command erases a message, and the storage layer refuses to turn a missing message into a delete.

## Errors

Every error has the shape `{"error": {"code": "...", "message": "..."}}`. The message is written for the person who sees it and never contains secrets.

| Status | Codes |
|---|---|
| 400 | `INVALID_INPUT` |
| 401 | `UNAUTHORIZED` |
| 404 | `NOT_FOUND`, `INVALID_LINK` |
| 409 | `WRONG_PHASE`, `ALREADY_SUBMITTED`, `CLOSED`, `LIMIT_REACHED`, `LOCKED` |
| 429 | `RATE_LIMITED` |
| 500 | `NOT_AVAILABLE` (unexpected; details are only in the logs) |
| 501 | `NOT_AVAILABLE` (not built yet) |
| 503 | `NOT_AVAILABLE` (too many conflicting writes; retry) |

The web client treats 502, 503 and 504 like a dropped connection and retries guest actions.

## Logging

Each request logs one JSON line: request id, route, status, duration and error code. Bodies, tokens, passwords, names and message text are never logged. Unexpected errors log their type and message only.
