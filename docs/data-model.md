# Data model (DynamoDB)

There is one table per environment, for example `olu-dev-events` and `olu-prod-events`. Development and production data can never mix, and the event id is set server-side (`EVENT_ID`).

The table has two keys:
- partition key `pk` (string)
- sort key `sk` (string)

It uses on-demand billing and TTL on the `ttl` attribute. There are no indexes: every access pattern is either a key lookup or a query on one partition.

## Items

| pk | sk | Attributes | Written by |
|---|---|---|---|
| `EVENT#<eventId>` | `STATE` | `ver`, `settleAt`, `data` (phase, quiz stage and timing, questions, open flags, doctor/reveal status, settings) | host commands; settling a timed-out question |
| `EVENT#<eventId>` | `COUNTER` | `ver` | +1 after any guest-visible activity |
| `EVENT#<eventId>` | `GUEST#<guestId>` | `displayName`, `tokenHash`, `joinedAt` | registration |
| `EVENT#<eventId>` | `VOTE#<guestId>` | `choice`, `castAt` | voting |
| `EVENT#<eventId>` | `ANSWER#<questionId>#<guestId>` | `optionIndex`, `answeredAt` | quiz |
| `EVENT#<eventId>` | `MESSAGE#<messageId>` | `clientMessageId`, `guestId`, `displayName`, `text`, `submittedAt`, `approved`, `hidden`, `removed`, `order` | messages and moderation; `removed` is a reversible flag, messages are never deleted |
| `ADMIN_SESSION#<tokenHash>` | `SESSION` | `expiresAt`, `ttl` | host sign-in |
| `RATE#<key>#<window>` | `RATE` | `count`, `ttl` | sign-in rate limit |

The doctor's selection and the reveal code are deliberately **not** in this table. Milestone 6 puts them in a separate store, encrypted with KMS and readable only by the narrowly privileged reveal function.

## How the spec's rules map to storage

| Rule | Mechanism |
|---|---|
| One vote per guest | Key `VOTE#<guestId>` + `attribute_not_exists(pk)` |
| One answer per guest per question | Key `ANSWER#<questionId>#<guestId>` + `attribute_not_exists(pk)` |
| Idempotent message resends | `messageId = sha256(guestId:clientMessageId)`, conditional put |
| Atomic phase transitions | `STATE` update with `ver = :expected`; on conflict, reload and re-check the rules |
| Persistent guest identity | `GUEST#…` item; the client keeps `guestId` + token, the server keeps the hash |
| Event isolation | Everything for an event lives under `EVENT#<eventId>` |
| Test/live isolation | Separate tables per environment, with `EVENT_ID` from server config |

## Access patterns

| Need | Operation |
|---|---|
| Has anything changed? (polled) | 2 × strongly consistent `GetItem` (`STATE`, `COUNTER`), projecting `ver`, `settleAt` |
| Load the event for a view or a change | `Query pk = EVENT#<id>`, strongly consistent, paginated |
| Guest action | 1 conditional `PutItem` + `UpdateItem ADD` on `COUNTER` |
| Host command | 1 conditional `UpdateItem` on `STATE` (a transaction only if one command touches several items) |

### Why guest writes avoid transactions

DynamoDB cancels concurrent transactions that touch the same item. If every vote checked the `STATE` item inside a transaction, 40 guests voting in the same second would keep cancelling each other. Instead:
- each vote or answer is checked by the rules against a strongly consistent read;
- the vote or answer is then written with a single conditional put.

A vote that arrives in the same moment the host closes voting can still count. That's acceptable, because it was cast before the close was visible.

### Revision

The revision clients see is `STATE.ver + COUNTER.ver`. Both only ever grow, so the sum does too.

Warm Lambda containers cache the loaded event per revision. When nothing changed, a view costs two tiny reads instead of a partition query.

## Size and cost (estimated, to be confirmed in Milestone 4)

- **Data:** a party of 40 guests produces roughly 600 items and about 150 KB per partition query.
- **Polling:** during the busiest moments (live voting or a quiz round), roughly 50 clients poll every 1.5s. Each changed revision costs about 40 read units per refetched view.
- **Cost:** with on-demand pricing, the whole evening should cost cents, not dollars. Milestone 4 will measure this on the real dev table before anything is promised.

## Secrets table (Milestone 6)

A separate table per environment (`olu-<env>-secrets`). Ciphertexts are KMS-encrypted with an encryption context of `purpose`, `environment`, `eventId` and `selectionId`.

| pk | sk | Holds | Readable by |
|---|---|---|---|
| `LINK#<sha256(token)>` | `LINK` | `eventId`, `linkId`, `expiresAt`, `ttl` | API |
| `CODE#<sha256(env, event, code)>` | `CODE` | `eventId`, `selectionId` (claims the code; codes are unique) | API |
| `EVENT#<eventId>` | `SELECTION#<id>` | `choiceCiphertext`, `codeCiphertext`, `codeHash`, `status` (ACTIVE or RETIRED), `submissionId`, `linkId`, `generation`, `createdAt`, `email*` | API: status fields only. Mailer: `codeCiphertext`, `status`, email fields. Reveal: `choiceCiphertext`, `status` |

The event's `STATE` item holds only `doctor.status`, the current `linkId`, an opaque `selectionId` and the reveal times. The reveal Lambda may read that item's `data` attribute and nothing else in the events table.
