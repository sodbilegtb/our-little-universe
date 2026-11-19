# Production and the party

Production (`infrastructure/terraform/environments/prod`) is a complete second copy of the stack for the real evening: its own state, tables, KMS key, Lambdas, web app and host password. Nothing from dev reaches it. It differs from dev on purpose:

- **`reveal_mode` has no default.** `"TEST"` for a dress rehearsal on the production stack, `"LIVE"` for the party. Going live is a line you change, plan, read and apply. Dev can never be LIVE.
- **Data is protected.** Both tables refuse deletion and keep point-in-time recovery; the KMS key waits 30 days before it can be deleted; logs are kept 30 days.
- **The SES identities are reused from dev.** They belong to the AWS account, so prod doesn't create them a second time; the plan fails if they aren't verified. Keep dev until after the party (see "After the party").
- **Safer scripts.** `aws:deploy-web -- prod` shows the mode and event and asks you to type `prod`; `SMOKE_WRITE` is refused; the rehearsal tool never runs against prod.

Every command below runs from the repository root unless it says `cd`.

## 1. Before you start

- Dev works end to end, including the code email (`docs/deployment.md`). Its SES identities (sender domain, recipients) are verified.
- The Lambda concurrency limit is at least 100. New accounts start at 10, which a party of phones exceeds:
  ```bash
  aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 --region eu-central-1 --query Quota.Value
  ```
  If it is lower, request 1000 (`docs/deployment.md`, prerequisites) and wait for it before the dress rehearsal.

## 2. Set up production (once)

```bash
cd infrastructure/terraform/environments/prod
cp backend.hcl.example backend.hcl            # same state bucket as dev; prod has its own key in it
cp terraform.tfvars.example terraform.tfvars  # fill in: reveal_mode = "TEST", event_id = "dress-rehearsal", emails
cd ../../../..
npm run aws:build-api
cd infrastructure/terraform/environments/prod
terraform init -backend-config=backend.hcl
terraform plan -out=prod.tfplan
```

Read the plan. On the first run it only adds resources and destroys nothing. Then, after you approve it yourself:

```bash
terraform apply prod.tfplan
cd ../../../..
npm run aws:set-password -- prod     # a different password from dev
npm run aws:deploy-web -- prod       # shows mode and event, asks you to type "prod"
npm run aws:smoke -- prod
npm run aws:preflight -- prod
```

Confirm the alarm subscription email AWS sends to `alarm_email`. `aws:preflight` lists anything still missing.

## 3. Dress rehearsal on production (TEST)

With `reveal_mode = "TEST"` the production stack behaves exactly like the party, except that the host desk can simulate the doctor and start a new rehearsal. Rehearse with the real TV, phones and laptop at the party location if you can, using the checklist in `docs/deployment.md` (step 9). "Start a new rehearsal" brings everyone back to the lobby between runs.

## 4. Switch to LIVE

When the dress rehearsal is done, change two lines in `terraform.tfvars`:

```hcl
reveal_mode = "LIVE"
event_id    = "baby-reveal"   # new: nothing from the dress rehearsal belongs to the party
```

```bash
cd infrastructure/terraform/environments/prod
terraform plan -out=prod.tfplan
```

Expect only changes in place to the three Lambdas and their policies (the mode and the event id), nothing added or destroyed. Apply, then check:

```bash
terraform apply prod.tfplan
cd ../../../..
npm run aws:preflight -- prod        # must say "LIVE mode"
```

The host desk now shows "Live"; "Simulate the doctor" and "Start a new rehearsal" are gone, and the server refuses them. Don't switch back during the party.

## 5. The doctor

1. Create the doctor link on the host desk (`/admin`, "The secret") shortly before the appointment. It is valid for `doctor_link_hours` (48 by default) and shown only once, with a QR code. Send it to the doctor only.
2. The doctor opens it on a phone, chooses, confirms and sees "Sealed. Thank you." The answer is encrypted at once; nobody, including the host desk, can see it.
3. The recipients get **OFFICIAL BABY REVEAL CODE**. It contains the code and nothing about the answer. Keep it for the evening.
4. Check: `ADMIN_PASSWORD=… npm run aws:preflight -- prod` shows "answer sealed, code emailed".

If the email doesn't arrive: "Send the code again" on the host desk (always the same code). If SES itself fails, switch to Gmail (`docs/deployment.md`, 4b, option A, with `-- prod`) and send again. If something went wrong at the doctor's (wrong choice, wrong person): "Reset the secret" (type RESET), then a new link. The old code stops working.

## 6. The evening

**The day before**
- `ADMIN_PASSWORD=… npm run aws:preflight -- prod`: everything ✓, LIVE, answer sealed and code emailed.
- Open `/tv` on the TV device once: full screen, fonts and sharpness look right.

**One hour before**
- TV: `/tv` in full screen (F11 or the browser's presentation mode). Disable sleep or screen savers.
- Host laptop: `/admin`, signed in, charger plugged in. Keep the code email at hand.
- Wi-Fi for guests works; a phone hotspot is the fallback.
- Don't test-join with a spare phone: every join counts as a guest on the TV. Join with your own phone as a real guest.

**The flow** (host desk, top to bottom): start voting, close voting, start the quiz, ten questions (open, close, reveal answer, next), finish the quiz, start messages (approve the ones for the TV), start the reveal, enter the code from the email, watch the TV (about 30 seconds), finish the event.

**If something goes wrong**

| Problem | What to do |
| --- | --- |
| The TV loses the connection or freezes | Reload the page. It returns to the current screen; during the reveal it picks up at the right moment. |
| A phone is stuck | Reload. The guest stays signed in. |
| The host laptop dies | Sign in on `/admin` from any device. |
| The code is "not accepted" | Copy it again from the email (the dashes and case don't matter). After 10 wrong tries in 15 minutes, wait. |
| Guests get errors everywhere | Check `aws:preflight` (Lambda limit) and the alarm emails. |
| The internet is down | A phone hotspot for the TV and the host laptop is enough; guests can follow on the TV. |

## 7. After the party

1. Right away: "Keep the evening" on the host desk, download every file and open each one. `aws:preflight` keeps working afterwards.
2. Milestone 9 covers the verified export and the teardown. Destroy prod before dev: dev owns the SES identities prod uses. The production tables refuse deletion until you turn that off on purpose.

## 8. Costs

| What | While it exists | The evening |
| --- | --- | --- |
| KMS key (one per environment) | 1 USD per month each | |
| DynamoDB, point-in-time recovery, CloudWatch | cents per month | |
| Amplify Hosting | within the free tier | |
| API Gateway, Lambda, DynamoDB requests | 0 when idle | about 1 to 3 USD for 30 guests over 3 hours |
| SES | | under 0.01 USD |

So prod costs about 1 to 2 USD per month while it waits for the party, plus 1 to 3 USD for the evening; dev adds about 1 USD per month while it exists. The budget alert (`monthly_budget_usd`) counts the whole account. Close `/tv` tabs after rehearsals: an open TV keeps polling.
