# Terraform

```
bootstrap/            S3 bucket for remote state (once per account, local state, prevent_destroy)
modules/
  database/           DynamoDB single table: on-demand, TTL, point-in-time recovery
  api/                Lambda (Node.js 22, arm64), least-privilege role, HTTP API, throttling, CORS, logs
  hosting/            Amplify Hosting app + branch, SPA rewrite, CSP and security headers
  monitoring/         SNS topic, Lambda/API alarms, optional monthly budget
  secret/             KMS key, secrets table, mailer and reveal Lambdas (see docs/security.md)
  email/              SES identities for the reveal code email (created by dev, reused by prod)
environments/
  dev/                The dev stack (state key dev/terraform.tfstate)
  prod/               The party (state key prod/terraform.tfstate): reveal_mode without default,
                      deletion protection, 30-day key window; see docs/production.md
```

Step-by-step instructions, costs and teardown are in [`docs/deployment.md`](../../docs/deployment.md) (dev) and [`docs/production.md`](../../docs/production.md) (prod).

## Commands

```bash
terraform init -backend-config=backend.hcl   # environments/*; bootstrap uses plain init
terraform fmt -recursive
terraform validate
terraform test                               # mocked AWS, creates nothing
terraform plan -out=dev.tfplan
terraform apply dev.tfplan                   # you, after reading the plan
terraform plan -destroy                      # review before any destroy
```

## Tests

Every module and both environments have `terraform test` suites in `tests/` that run against mocked providers, so they need no AWS credentials and create nothing. They check what matters for this project:

- DynamoDB is on-demand with TTL and point-in-time recovery.
- The Lambda runs Node.js 22 on arm64, uses DynamoDB, and has no password hash or development routes in its configuration.
- The IAM policy has no wildcards, no `Scan`, no table management, and SSM read access to one parameter only.
- CORS allows only the web app; `*` is rejected by validation.
- The API is throttled and its access logs record no IP addresses.
- The web app sends a strict CSP, HSTS and `frame-ancestors 'none'`, and deep links serve `index.html`.
- Alarms and the budget are wired, and nothing sends email when no address is configured.
- The state bucket is versioned, private and refuses plain HTTP.
- The API can't decrypt anything or read a ciphertext. The mailer can open only codes and can't read the answer. The reveal Lambda can open only the answer and writes nothing. The key policy denies opening the answer to every role but the reveal Lambda's.

## Configuration

| File | Committed | Purpose |
| --- | --- | --- |
| `*/terraform.tfvars.example` | yes | Template for your values |
| `*/terraform.tfvars` | no | Region, event id, alert emails |
| `environments/*/backend.hcl.example` | yes | Template for the state bucket |
| `environments/*/backend.hcl` | no | Your state bucket name |
| `.terraform.lock.hcl` | yes, once you create it | Provider checksums from your own `terraform init` |

Secrets never go through Terraform: the host password hash is written to SSM by `npm run aws:set-password`.

## Decisions

- **Amplify Hosting** (the spec default) with manual zip deployments, so no Git connection or build pipeline in AWS is needed. Teardown removes the app with `destroy`.
- **HTTP API**, not REST API: cheaper, simpler, enough for this app.
- **CSP `connect-src`** allows `https://*.execute-api.<region>.amazonaws.com` rather than the exact API URL. The exact URL would make hosting depend on the API while the API's CORS depends on the hosting URL, a cycle. CORS on the API remains exact.
- **One API Lambda** for all regular routes keeps cold starts rare at party scale. The secret has two more, narrowly privileged Lambdas (mailer, reveal), each with its own role.
- Prod: the mode written in tfvars reaches every Lambda, `live` or an empty alarm email or recipient list are refused, tables refuse deletion, SES identities are reused rather than created, and only the production web app may call the API.
