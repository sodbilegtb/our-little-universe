# Deploying the dev environment (Milestone 4)

This guide takes you from an empty AWS account to a working dev environment you can test on real phones and a TV. Every step that creates, changes or deletes AWS resources is a command **you** run, after reading its plan. Nothing here runs `terraform apply` or `destroy` for you.

```
Your laptop ──► Amplify Hosting (web app: /party /tv /admin /doctor)
                  │  CSP allows only itself + execute-api
                  ▼
             API Gateway HTTP API ($default stage, throttled, CORS = app URL)
                  ▼
             Lambda olu-dev-api (Node.js 22, arm64) ──► DynamoDB olu-dev-events
                  │                                      (on-demand, TTL, PITR)
                  └─► SSM /olu/dev/admin-password-hash (SecureString, read-only)
CloudWatch: logs (14 days), alarms → SNS email, monthly budget alert
```

## 1. Prerequisites

- Terraform **1.11 or newer** (`terraform version`). The S3 backend uses native lock files.
- AWS CLI v2, signed in to the account you want to use. Check with `aws sts get-caller-identity`.
  If you use profiles: `export AWS_PROFILE=olu` (Terraform and the scripts both respect it).
- Node.js 22 and `zip` (for the web upload).
- `export AWS_REGION=eu-central-1` (or the region you set in the tfvars).
- **Enough Lambda concurrency.** Newer accounts are often limited to 10 concurrent Lambda executions; the standard is 1000. With 40 phones that limit is hit at busy moments and API Gateway answers some requests with HTTP 503 ("The Lambda function is being throttled"). Check and, if needed, request the increase early, as approval can take from minutes to a few days. It is free.
  ```bash
  aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions'
  aws service-quotas request-service-quota-increase --service-code lambda \
    --quota-code L-B99A9384 --desired-value 1000 --region eu-central-1
  ```

## 2. Bootstrap the state bucket (once per account)

The state bucket lives outside the app's stacks, so tearing down dev or prod never deletes its own state. It is versioned, encrypted, private, and has `prevent_destroy`.

```bash
cd infrastructure/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars   # set state_bucket_name, e.g. olu-tfstate-<account id>
terraform init
terraform plan
terraform apply                                # review, then type yes
```

The bootstrap keeps its own small state file locally (`terraform.tfstate` in this folder, git-ignored). Keep a copy somewhere safe; it only describes the bucket.

## 3. Create the dev environment

```bash
npm install
npm run aws:build-api                          # bundles the Lambda into services/api/dist/lambda

cd infrastructure/terraform/environments/dev
cp backend.hcl.example backend.hcl             # bucket = output "state_bucket" from step 2
cp terraform.tfvars.example terraform.tfvars   # emails for alarms and the budget
terraform init -backend-config=backend.hcl
terraform fmt -check -recursive
terraform validate
terraform plan -out=dev.tfplan
terraform apply dev.tfplan                     # only after you have read the plan
```

The plan creates about 35 resources:
- the events table and the secrets table;
- the KMS key;
- three Lambdas (API, mailer, reveal) with their roles and log groups;
- the HTTP API and its routes;
- the Amplify app and branch;
- SES identities, the alarms, an SNS topic and the budget. If you set `alarm_email`, AWS sends a confirmation email; alarms only reach you after you click it.

Re-run `npm run aws:build-api` and `terraform apply` whenever the API code changes. Terraform notices the new bundle hash and updates the function.

## 4. Set the host password

The Lambda reads the password **hash** from SSM Parameter Store. It is never in Terraform state, tfvars or the Lambda configuration.

```bash
npm run aws:set-password -- dev
```

The script asks twice (hidden input), hashes with scrypt on your laptop, and stores only the hash as a SecureString. A running API picks up a changed password within 5 minutes. Until the parameter exists, guests can play but host sign-in answers "Host sign-in isn't configured on the server."

## 4b. Reveal code email (Amazon SES)

The mailer sends the reveal code through SES. Without an email configuration, dev still works: the host desk shows the email as skipped, and "Simulate the doctor (test)" shows the test code directly.

1. In `environments/dev/terraform.tfvars` set:
   ```hcl
   email_sender     = "reveal@your-domain.example"   # or your own address
   email_recipients = ["you@example.com"]
   # email_sender_domain = "your-domain.example"     # optional, recommended
   ```
2. Plan and apply (step 3). AWS emails a verification link to every address. Click each one: until then SES refuses to send.
3. If you set `email_sender_domain`, the domain needs three DKIM CNAME records. Mail from a verified domain is far less likely to land in spam than mail claiming to come from a Gmail address.
   - **DNS in Route 53 in the same AWS account** (`dig +short NS your-domain.example` shows `awsdns` servers): set `email_dns_in_route53 = true` and Terraform writes the records itself.
   - **DNS anywhere else:** run `terraform output email_dkim_records` and add the three records at your DNS provider. Most providers append the domain, so enter only the part before it (`xxxx._domainkey`). On Cloudflare, use "DNS only".

   SES then checks the records on its own, usually within 30 minutes. `aws sesv2 get-email-identity --email-identity your-domain.example --query VerifiedForSendingStatus` turns `true` when it's done.
4. New AWS accounts start in the **SES sandbox**. Only verified addresses can receive mail, and the limit is 200 emails a day. That's enough for this app, so you don't need production access.

Test-mode emails have the subject `[TEST] OFFICIAL BABY REVEAL CODE` and say they can't unlock the real reveal. How the secret is protected is described in [`security.md`](security.md).

## 5. Publish the web app

```bash
npm run aws:deploy-web -- dev
```

This builds the web app with `VITE_API_MODE=http` and the API URL from `terraform output`, uploads the zip to Amplify and waits for the deployment. It prints the TV and host URLs at the end.

## 6. Smoke test

```bash
npm run aws:smoke -- dev                               # read-only checks
ADMIN_PASSWORD='…' SMOKE_WRITE=1 npm run aws:smoke -- dev   # also sign-in and a test guest
```

It checks health, the TV view and its join URL, CORS (the app allowed, other sites refused), that host actions need sign-in, that development routes are off, and that the web app serves `/party` with its Content-Security-Policy. `SMOKE_WRITE=1` adds a guest named "Smoke test" to the event. The preview reset tools are disabled in AWS, so to start a fresh rehearsal, change `event_id` in the tfvars and apply again.

## 7. Run the DynamoDB contract tests against real DynamoDB

This closes the gap left in Milestone 3. The tests create their **own temporary table** (`olu-contract-<timestamp>`), run the same contract as the in-memory and fake repositories, and delete the table afterwards. They never touch `olu-dev-events`.

```bash
DYNAMODB_TEST_ENDPOINT=https://dynamodb.eu-central-1.amazonaws.com AWS_REGION=eu-central-1 \
  npm run test:dynamodb -w @olu/api
```

Your CLI user needs `dynamodb:CreateTable`, `DeleteTable`, `DescribeTable` and item access. The run costs well under a cent. If it is interrupted, delete any leftover `olu-contract-*` table in the console.

## 8. Rehearse with simulated guests

Before inviting people, let a script play a whole evening against the deployed API: a host, a TV and dozens of phones that poll exactly like the real app.

```bash
ADMIN_PASSWORD='…' npm run rehearse -- --env dev --guests 40
```

It plays the event through to the end, so it needs a fresh event (phase lobby, no votes yet), and you'll want another fresh one afterwards for step 9. Set a new `event_id` in `terraform.tfvars` (for example `rehearsal-2`) and apply; earlier rehearsals stay in the table untouched. It refuses to run against prod.

It checks, from the server's own answers:
- every guest is registered, and every vote, answer and message is counted exactly once, even with double taps, retries and changes of mind;
- a vote after closing is refused, and a late arrival can still play the quiz;
- every score matches the answers sent, and the leaderboard is in order;
- no message reaches the TV without approval, and removing and restoring keeps it;
- the export holds everything and no session tokens.

In TEST mode it also runs the whole secret flow with a simulated doctor:
- the answer is sealed and the code emailed (or recorded as skipped without SES);
- the TV view carries no answer, and a wrong code is refused;
- the emailed code starts the reveal;
- the result stays sealed during the countdown and is released at the reveal moment.

It never prints the simulated result.

It also reports latency per kind of request, the busiest request rate, and how long phones took to show each change. Locally, with 40 phones, phones showed each change after 0.5 to 0.9 seconds (median) and at most 1.8 seconds; traffic peaked at 74 requests per second, and at 175 with 100 phones. The dev API accepts 300 per second (`api_rate_limit`), enough for about 150 phones.

Against a local API: `ADMIN_PASSWORD=… npm run rehearse -- --api http://localhost:8787 --reset`.

## 9. Rehearse with real devices

Use the checklist below with at least two phones (one iOS, one Android if you can), a laptop as the host desk and the TV (or a laptop on the TV via HDMI, browser in full screen).

- [ ] TV `/tv` shows the welcome screen; the QR code opens `/party` on a phone.
- [ ] Two guests join with the same name; both get separate sessions.
- [ ] A guest refreshes; they are still signed in and see the current phase.
- [ ] Host signs in on `/admin`; a wrong password five times shows the normal error, the 11th attempt within 15 minutes is refused.
- [ ] Start voting: phones switch within about 2 seconds. Double-tapping a card records one vote.
- [ ] Turn a phone's Wi-Fi off for 20 seconds during voting, then on again: it shows "Reconnecting…" and catches up.
- [ ] A guest joins late (during the quiz) and lands on the current question.
- [ ] Quiz: countdown matches between TV and phones; a question closes on its own when time is up; leaderboard and winner appear.
- [ ] Refresh the TV in the middle of the quiz; it returns to the same screen.
- [ ] Messages: stars appear on the TV; text shows only after you approve it. Remove one and restore it from "Removed messages".
- [ ] Keep the evening: "Prepare downloads", then save the archive and the three CSV files and open each one.
- [ ] Close messages; phones show "Look at the big screen!" (the reveal itself is Milestone 7).
- [ ] CloudWatch: the Lambda log group shows one structured line per request and no tokens or passwords.

## 10. Costs

For a family party (about 30 guests, 3 hours, every phone polling every 1.5 seconds) the dev environment costs roughly **1 to 3 USD per rehearsal evening** and a few cents per month while idle.

| Service | What drives the cost | Estimate |
| --- | --- | --- |
| API Gateway HTTP API | ~1 USD per million requests. 30 phones + TV for 3 h ≈ 230,000 polls, plus view fetches while guests are active (the rehearsal measured about 1.5 requests per phone per second during activities) ≈ 300,000 requests | ~0.30 USD per evening |
| Lambda | 0.20 USD per million requests plus duration (512 MB, arm64, ~20 ms) | ~0.10 USD per evening |
| DynamoDB on-demand | 0.125 USD per million read units, 0.625 USD per million write units (us-east-1; Frankfurt is slightly higher). Each poll reads the state item (~2 units) and a counter (1 unit) | ~0.10 to 0.50 USD per evening |
| Amplify Hosting | 0.023 USD per GB stored and 0.15 USD per GB served, after the free tier of 5 GB stored and 15 GB served per month | usually 0 |
| CloudWatch | Logs at 14 days retention, 3 alarms | a few cents |
| Point-in-time recovery | Billed per GB of table data; the event is a few hundred KB | cents |
| KMS key | 1 USD per month while it exists (billed hourly); requests are within the free tier | ~1 USD per month |
| SES | 0.10 USD per 1,000 emails | 0 |

Not free: polling never stops while a tab is open and visible. The poller pauses in hidden tabs, but a TV left on overnight keeps polling. Close tabs after rehearsals. The budget alert emails you at 50% and 100% of `monthly_budget_usd` (default 10 USD).

Prices: [API Gateway](https://aws.amazon.com/api-gateway/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [DynamoDB on-demand](https://aws.amazon.com/dynamodb/pricing/on-demand/), [Amplify](https://aws.amazon.com/amplify/pricing/).

## 11. Tear down dev

Dev holds only rehearsal data, but export anything you want to keep first (host desk → Keep the evening).

```bash
cd infrastructure/terraform/environments/dev
terraform plan -destroy -out=destroy.tfplan
terraform apply destroy.tfplan                 # only after reading the plan
aws ssm delete-parameter --name /olu/dev/admin-password-hash   # not managed by Terraform
```

What is **not** removed by `destroy`:
- the state bucket and its versions (bootstrap, on purpose);
- the SSM password parameter (created by the script, see above);
- the KMS key is not deleted at once: it is scheduled for deletion after 7 days and costs nothing meanwhile. Within those days it can be restored (`aws kms cancel-key-deletion`);
- the confirmed SNS email subscription is removed, but AWS Budgets history is kept by AWS;
- CloudWatch logs from log groups Lambda may recreate after destroy if a request arrives in between (rare; delete `/aws/lambda/olu-dev-api` if it reappears).

The table has point-in-time recovery but no deletion protection in dev. Production (Milestone 8) turns deletion protection on, so destroying prod is a deliberate two-step change.

## Troubleshooting

- **`terraform init` fails on the backend:** the bucket name in `backend.hcl` must match the bootstrap output, and the region must match the bucket's region.
- **The web app loads but every request fails:** run the smoke test. A CORS failure means the app URL changed; `terraform apply` again. A 401 on host actions before sign-in is expected.
- **"Host sign-in isn't configured":** run step 4, then wait up to 30 seconds.
- **Phones show "Reconnecting…" during busy moments at a big party:** the API rate limit may be too low. The rehearsal prints the busiest request rate; raise `api_rate_limit` and apply.
- **AccessDenied from DynamoDB in the API, mailer or reveal logs:** each Lambda may read only specific attributes of the secrets table. If code changes which attributes it reads, the lists in `modules/secret/iam.tf` and `modules/api/iam.tf` must change with it.
- **Code email "Failed":** usually an unverified sender or recipient (SES sandbox). Check the verification emails, then "Send the code again" on the host desk. It sends the same code.
- **HTTP 503 "The Lambda function is being throttled" in the rehearsal or access logs:** the account's Lambda concurrency limit is too low (see Prerequisites). Leave `reserved_concurrency = -1` and request the quota increase.
- **Finding the cause of failed requests:** the rehearsal lists each one with its request id. Search the access logs for server errors:
  ```bash
  START=$(( ($(date +%s) - 7200) * 1000 ))
  aws logs filter-log-events --log-group-name /aws/apigateway/olu-dev-api --start-time $START \
    --filter-pattern '{ $.status = "5*" }' --query 'events[].message' --output text
  ```
- **No alarm emails:** confirm the SNS subscription email.
- **Amplify shows the old version:** check the job in the Amplify console; the deploy script exits non-zero if a deployment fails.
