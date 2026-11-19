# Security review before production (Milestone 8)

Reviewed on 2026-11-19 against the code on `main`, the Terraform for dev and prod, and the dev deployment on AWS. The design itself is described in [`security.md`](security.md); this file records what was checked and what remains.

**Goal, as the spec sets it:** the gender stays hidden from everyone, the parents included, until the authorized reveal moment, with protection against accidental exposure and unauthorized application access. An AWS account administrator acting on purpose is out of scope (see "Accepted limits").

## Checked

| Area | What was checked | How | Result |
| --- | --- | --- | --- |
| The answer in API responses | Host desk, TV and guest views, exports, emails and logs are byte-identical whether the answer is BOY or GIRL | API test 17, both storage backends | ✓ |
| The answer in the browser | The TV requests the result only at the reveal moment; nothing is prefetched | Playwright against the real local API (first request ≥ 25 s after the code) | ✓ |
| The production bundle | No mock server, simulation, test password, development routes or preview tools in an HTTP build | Build with `VITE_API_MODE=http`, searched the output | ✓ |
| Phones | Guests see "Look at the big screen!", never the result | Playwright | ✓ |
| Who can open what | API: encrypt only. Mailer: open codes only. Reveal Lambda: open the answer only, read-only. Key policy denies the answer to every other role | `terraform test` with a mutation check | ✓ |
| Test and live | Ciphertexts and code hashes are bound to environment and event; dev and local can't be LIVE; prod's mode has no default; TEST-only routes (simulate, new rehearsal, dev routes) answer 404 in LIVE | API tests 13, config tests, prod `terraform test` | ✓ |
| Early or wrong codes | One neutral answer for every wrong code, 10 attempts per 15 minutes per event; the result endpoint answers 409 for every "not yet" | API tests 15 and 16 | ✓ |
| Logs | No codes, answers, tokens, passwords or IP addresses in Lambda or access logs | Read every log call; access log format | ✓ |
| Host access | scrypt hash in SSM, rate-limited sign-in, 12-hour sessions; prod has its own password | API tests, `aws:preflight` | ✓ |
| CORS | Prod accepts only its own web app (no localhost) | prod `terraform test` | ✓ |
| Web headers | CSP (`script-src 'self'`, no inline scripts), HSTS, frame denial, no referrer, permissions policy | Smoke test against dev | ✓ |
| Guest content | Names and messages are rendered as text by React, never as HTML; length-limited by schema | Code review | ✓ |
| Memories | Messages are never deleted (removing is a flag); new rehearsal runs erase nothing; prod tables refuse deletion and keep point-in-time recovery | API tests, prod `terraform test` | ✓ |
| Prod safety | `deploy-web prod` asks for a typed confirmation; `SMOKE_WRITE` and the rehearsal tool refuse prod | Script review | ✓ |
| Dependencies | `npm audit`: 0 known vulnerabilities (nodemailer pinned to ≥ 10.6 after an audit finding in 7.x) | `npm audit` | ✓ |

## Accepted limits

- **An AWS account administrator** can change policies and decrypt on purpose. The design prevents accidental and application-level exposure, not a determined owner of the account. The stronger option (an external key custodian with a time-locked policy) is described in `security.md`.
- **The result endpoint needs no sign-in.** From the reveal moment on, anyone who knows the API address can read the result. By then it is on the TV for everyone; before it, the endpoint says nothing.
- **`connect-src` allows any API Gateway address in the region**, not only this API's (naming it exactly would create a dependency cycle between the app and the API). Without a script injection this has no effect, and `script-src 'self'` with React's escaping leaves no known way to inject one.
- **Availability depends on the Lambda concurrency limit.** At 10 (new accounts) a party will see errors; `aws:preflight` fails until it is at least 100.
- **SES sandbox.** Only verified recipients can receive the code. That is what the app needs; `aws:preflight` checks each one.

## Before the party

`ADMIN_PASSWORD=… npm run aws:preflight -- prod` checks the mode, the event, the host password, the email path, the concurrency limit, the alarm subscription and the doctor's status in one go. See [`production.md`](production.md).
