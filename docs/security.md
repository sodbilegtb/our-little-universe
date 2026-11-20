# Keeping the secret (Milestone 6)

The most important rule of the project: the baby's gender stays hidden until the reveal moment. This page describes how the app enforces it, what it protects against, and where its limits are.

## The flow

1. **Doctor link.** The host creates a link on the host desk ("The secret" card). It contains a 256-bit random token in the URL fragment (`/doctor#…`). Browsers never send fragments to a server, so the token appears in no access log. Only a SHA-256 hash of it is stored. The link expires after 48 hours (`doctor_link_hours`), and creating a new link retires the previous one.
2. **Sealing.** The doctor chooses and confirms. The API encrypts the choice with KMS at once, draws a random code (12 characters from 31, about 59 bits, no prefix or pattern), encrypts the code too, and stores both in the secrets table, together with a hash of the code that claims it as unique. The event state only records *that* an answer was sealed, as an opaque id.
   - The doctor's device sends a submission id, generated once per confirmation. Double clicks, retries and refreshes are the same submission, so a second code is never created.
   - A different submission with the same link is refused.
   - Opening or refreshing the doctor page is read-only.
3. **Code email.** The API asks the mailer Lambda (asynchronously, ids only) to send the code. The mailer opens the code, never the answer, and sends it through SES or a Gmail account (`email_transport`). The Gmail app password is an SSM SecureString that only the mailer role may read; it never passes through Terraform, Git or the logs. A failed send is retried twice by Lambda, and "Send the code again" on the host desk repeats the same code. The email contains the code and nothing else about the secret.
4. **Reveal.** In the reveal phase the host enters the code. The API hashes it with the environment and event, looks it up, and checks that it belongs to the answer sealed for this event right now and hasn't been retired. If so, the reveal starts with `revealAt = now + 30 s` on the server clock (`reveal_delay_seconds`). The accepted code is now spent, so the TV view carries it from here on and decodes it on screen; it says nothing about the result, and phones never get it. Wrong, malformed, retired and foreign codes all get the same answer, and attempts are limited to 10 per 15 minutes per event.
5. **Result.** `GET /v1/reveal/result` is served by the separate reveal Lambda. It answers a neutral 409 until `revealAt`, whatever the reason, and only then opens the answer. Clients never receive the result before that moment, not even hidden.

## Who can open what

| Role | Encrypt | Open the code | Open the answer | Secrets table |
| --- | --- | --- | --- | --- |
| API Lambda (guests, TV, host desk) | yes | no | no | store new items; read status fields only; set `status` |
| Mailer Lambda | no | yes | no | read `codeCiphertext` and `status`; write email fields |
| Reveal Lambda | no | no | yes | read `choiceCiphertext` and `status`; read the event's `STATE` item; no writes |

This is enforced three ways:
- **IAM policies.** Each role has its own policy. KMS permissions are conditioned on the encryption context (`purpose`, `environment`, `eventId`), and DynamoDB permissions on the exact attributes.
- **The KMS key policy.** It *denies* opening the answer to every principal except the reveal role, and opening codes to every principal except the mailer role. This covers account administrators using their everyday permissions, too.
- **Encryption context.** Every ciphertext is bound to its purpose, environment, event and selection. A code ciphertext can't be opened as an answer, and nothing can be opened for another event.

The Terraform tests (`modules/secret/tests`, `modules/api/tests`) check these rules. A mutation check (giving the mailer the answer's purpose) makes them fail.

## Test and live

- `REVEAL_MODE` comes from the environment, never from a client. dev and local are always TEST. prod is LIVE, and can only be set to TEST explicitly, for a rehearsal.
- TEST shows a "Test mode" badge on the host desk, marks emails `[TEST]`, and allows "Simulate the doctor", which seals a random answer and shows its code so a rehearsal can run end to end. LIVE has no simulation.
- Each environment has its own table, secrets table and KMS key. Code hashes include the environment and the event id. A test code can't even be found in prod, let alone unlock it.

## Proving it

- `services/api/src/app/secret.test.ts` covers spec items 11 to 17 on both storage backends. The central test plays the same evening twice, once with BOY and once with GIRL. Every response the host desk, the TV and guests receive, the export, the emails and the logs are compared, and the two are byte for byte identical. Only the reveal service, at the reveal moment, tells them apart.
- `npm run rehearse` runs the whole secret flow against a deployed dev environment in TEST mode: sealing, email, wrong code, right code, sealed during the countdown, released at the reveal moment. It never prints the (simulated) result.

## Limits, honestly

**An AWS account administrator can still learn the answer on purpose.** Whoever controls the account can edit the key policy and the IAM roles, or deploy a modified reveal Lambda. The design prevents accidental exposure and any access through the application (the host desk, guests, the TV, logs, emails, exports). It does not stop a determined account owner. Changing the key policy is a deliberate, logged act (CloudTrail), not something that happens by mistake.

The host desk's operator is also the account owner here, so the realistic risk is accidental exposure, and that is what the design rules out.

### If stronger protection is wanted later: a key custodian

A trusted person (not the parents) creates a KMS key in **their own** AWS account. Its key policy allows `kms:Decrypt` only:
- for the reveal Lambda's role in this account (cross-account);
- and only after the party starts (`aws:CurrentTime` later than the party start).

The answer would be encrypted twice, with this key and with the custodian's key. The parents' account could then not open it before the party, even with full administrator rights, because the custodian's key policy is outside their control.

Trade-offs:
- It needs a second account and a cross-account key.
- If the party moves, the custodian has to update the time.
- On the day itself, an administrator could still swap the reveal Lambda's code.

It isn't implemented, because the spec asks to avoid unnecessary cryptographic complexity in the first version.

## Costs

- KMS: a customer managed key costs 1 USD per month (billed hourly). Requests cost 0.03 USD per 10,000, after 20,000 free requests per month, and a party uses a few dozen. A key scheduled for deletion costs nothing; `terraform destroy` schedules it with a 7-day window, during which it can be restored. ([KMS pricing](https://aws.amazon.com/kms/pricing/))
- SES: 0.10 USD per 1,000 emails. ([SES pricing](https://aws.amazon.com/ses/pricing/))
- Gmail: free (about 500 emails a day per account).
- The secrets table and the two Lambdas cost fractions of a cent per evening.
