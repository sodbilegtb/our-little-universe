# After the party

The guests' messages are the one thing that can't be made again. So the order is: copy, check the copy, keep a second copy, back up, and only then remove anything. None of the scripts below deletes anything; the teardown is two Terraform commands you run yourself after reading the plan.

Every command runs from the repository root unless it says `cd`.

## 1. The same evening: keep the memories

```bash
ADMIN_PASSWORD='…' npm run aws:export -- prod
```

This saves everything to `exports/prod-<event>-<time>/` on your computer (never committed to Git) and checks the copy right away:

| File | What's in it |
| --- | --- |
| `memory-book.html` | Every message for the baby (except removed ones) with the guest's name, the result, the guesses and the quiz winner. Open it in a browser; it prints as a small book. |
| `event.json` | Everything the server knows about the evening, the result included: guests, votes, every quiz answer, all messages (hidden and removed ones flagged). |
| `messages.csv`, `guests.csv`, `votes.csv`, `quiz-answers.csv`, `quiz-scores.csv` | The same for spreadsheets. |
| `manifest.json` | A checksum and row count per file. |

Then:

1. Open `memory-book.html` and look through it.
2. Copy the whole folder to a second place (cloud drive, USB stick) and check that copy:
   ```bash
   npm run aws:export -- --verify "/path/to/the/copy"
   ```
3. Make a backup of the table too. It stays after the table is deleted:
   ```bash
   npm run aws:backup -- prod
   ```

The host desk's "Keep the evening" downloads the same data in the browser, if you want a copy before you're at your computer.

## 2. Remove production

There's no hurry: prod costs about 1 to 2 USD per month while it stays. When you're ready:

```bash
npm run aws:teardown-check -- prod
```

It only says "Safe to remove prod" when there's a verified export of the current event made after the evening was finished, and an available backup that is newer than the export. Then:

1. Turn off the deletion protection: set `allow_destroy = true` in `environments/prod/terraform.tfvars`.
   ```bash
   cd infrastructure/terraform/environments/prod
   terraform plan -out=unprotect.tfplan     # expect: 2 to change (the two tables), nothing else
   terraform apply unprotect.tfplan
   ```
2. Destroy, after reading the plan. Every resource in it is named `olu-prod-…`; the email identities and your domain's DNS records are not in it (they belong to dev):
   ```bash
   terraform plan -destroy -out=destroy.tfplan
   terraform apply destroy.tfplan
   ```

## 3. Remove dev

Dev must go after prod: prod sends with the email identities dev manages. The check makes sure prod is gone; in dev a missing export or backup is only a note (rehearsal data).

```bash
npm run aws:teardown-check -- dev
cd infrastructure/terraform/environments/dev
terraform plan -destroy -out=destroy.tfplan
terraform apply destroy.tfplan
```

This plan also removes the SES identities and the three DKIM records Terraform added to your domain's Route 53 zone. The zone itself and every other record in it (your portfolio) stay; Terraform never managed them.

## 4. What stays, and how to remove it

`terraform destroy` removes what Terraform created. These were made another way, or are kept on purpose:

| What | Why it stays | Remove it with |
| --- | --- | --- |
| DynamoDB backups | On purpose: your second safety net. A few cents per month at most. | `aws dynamodb list-backups`, then `aws dynamodb delete-backup --backup-arn …` once you trust your copies |
| Host passwords, Gmail app password (SSM) | Created by the scripts, not Terraform | `aws ssm delete-parameter --name /olu/prod/admin-password-hash` (and `/olu/dev/…`, `…/gmail-app-password` if used) |
| KMS keys | AWS waits before deleting a key: 30 days (prod), 7 days (dev). Free while waiting. | Nothing to do. `aws kms cancel-key-deletion` would bring one back. |
| CloudWatch log groups | Lambda may recreate them if a request arrived during the destroy | `aws logs delete-log-group --log-group-name /aws/lambda/olu-prod-api` (etc.) |
| The state bucket `olu-tfstate-…` | Bootstrap, protected on purpose; holds the history of both environments | Keep it (cents), or empty it and remove `prevent_destroy` in `bootstrap/main.tf`, then destroy bootstrap |
| Route 53 zone of your domain, the Lambda concurrency limit | Yours, not the project's; both free or already paid | Nothing to do |
| `exports/` on your computer | Your archive | Keep it |

To see whether anything tagged for the project is left (except the state bucket, this should end up empty):

```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=our-little-universe --region eu-central-1 --query 'ResourceTagMappingList[].ResourceARN'
```
