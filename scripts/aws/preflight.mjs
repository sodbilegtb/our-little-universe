import { spawnSync } from 'node:child_process';
import { optionalOutput, parseEnv, root, terraformOutputs } from './lib.mjs';

/*
 * Go/no-go before a rehearsal or the party. Read-only: it changes nothing.
 *   npm run aws:preflight -- prod
 *   ADMIN_PASSWORD=... npm run aws:preflight -- prod   (also the evening's state)
 *
 * ✓ ready   ! worth a look   ✗ fix before the evening (exit code 1)
 */

const env = parseEnv(process.argv);
const out = terraformOutputs(env);
const region = out.region;
const api = out.apiEndpoint.replace(/\/$/, '');
let problems = 0;

const ok = (text) => console.log(`  ✓ ${text}`);
const warn = (text) => console.log(`  ! ${text}`);
const fail = (text) => {
  problems += 1;
  console.log(`  ✗ ${text}`);
};

/** Runs the AWS CLI and returns parsed JSON, or null (with the error text) when it fails. */
function aws(args) {
  const result = spawnSync('aws', [...args, '--region', region, '--output', 'json'], { cwd: root, encoding: 'utf8' });
  if (result.error) throw new Error('The AWS CLI is not installed or not on the PATH.');
  if (result.status !== 0) return { error: result.stderr.trim().split('\n').at(-1) ?? 'failed' };
  return { value: JSON.parse(result.stdout || 'null') };
}

console.log(`\nPreflight: ${env}  ${out.appUrl}\n`);

console.log('Event');
const mode = optionalOutput(env, 'reveal_mode');
const eventId = optionalOutput(env, 'event_id');
if (env === 'prod' && mode === 'LIVE') ok(`LIVE mode, event "${eventId}"`);
else if (env === 'prod') warn(`TEST mode (dress rehearsal), event "${eventId}". For the party: reveal_mode = "LIVE" and a new event_id`);
else ok(`${mode ?? 'TEST'} mode, event "${eventId ?? '?'}"`);

const health = await fetch(`${api}/v1/health`).then((r) => r.ok).catch(() => false);
if (health) ok('API answers');
else fail(`API not reachable: ${api}`);

const page = await fetch(`${out.appUrl}/tv`).then((r) => r.status).catch(() => 0);
if (page === 200) ok('Web app serves /tv');
else fail(`Web app: HTTP ${page} for /tv. Run npm run aws:deploy-web -- ${env}`);

console.log('\nHost password');
const parameter = aws(['ssm', 'describe-parameters', '--parameter-filters', `Key=Name,Values=/olu/${env}/admin-password-hash`]);
if (parameter.error) fail(`Could not check: ${parameter.error}`);
else if (parameter.value.Parameters?.length) ok(`/olu/${env}/admin-password-hash is set`);
else fail(`Not set. Run npm run aws:set-password -- ${env}`);

console.log('\nCode email');
const transport = optionalOutput(env, 'email_transport') ?? 'ses';
const identities = optionalOutput(env, 'email_identities') ?? [];
if (identities.length < 2) fail('No sender or no recipient configured in terraform.tfvars');
if (transport === 'gmail') {
  const gmail = aws(['ssm', 'describe-parameters', '--parameter-filters', `Key=Name,Values=/olu/${env}/gmail-app-password`]);
  if (!gmail.error && gmail.value.Parameters?.length) ok('Sends through Gmail; the app password is stored');
  else fail(`Sends through Gmail, but no app password. Run npm run aws:set-gmail-password -- ${env}`);
} else {
  const account = aws(['sesv2', 'get-account']);
  if (account.error) fail(`SES: ${account.error}`);
  else if (!account.value.SendingEnabled) fail('SES sending is disabled for this account');
  else ok(`SES sending enabled${account.value.ProductionAccessEnabled ? '' : ' (sandbox: only verified recipients, which is fine here)'}`);
  for (const identity of identities) {
    const found = aws(['sesv2', 'get-email-identity', '--email-identity', identity]);
    if (found.error) fail(`${identity}: not an SES identity in this account`);
    else if (found.value.VerifiedForSendingStatus) ok(`${identity} verified`);
    else fail(`${identity} not verified yet${identity.includes('@') ? ' (click the link in the email from AWS)' : ' (DKIM records)'}`);
  }
}

console.log('\nCapacity and alarms');
const quota = aws(['service-quotas', 'get-service-quota', '--service-code', 'lambda', '--quota-code', 'L-B99A9384']);
const concurrency = quota.value?.Quota?.Value;
if (concurrency === undefined) warn(`Lambda concurrency: could not read (${quota.error})`);
else if (concurrency >= 100) ok(`Lambda concurrency limit ${concurrency}`);
else fail(`Lambda concurrency limit is ${concurrency}: phones will see errors at a party. Request 1000 (docs/deployment.md)`);

const topic = optionalOutput(env, 'alarm_topic_arn');
if (topic) {
  const subs = aws(['sns', 'list-subscriptions-by-topic', '--topic-arn', topic]);
  const list = subs.value?.Subscriptions ?? [];
  if (subs.error) warn(`Alarm subscriptions: could not read (${subs.error})`);
  else if (list.length === 0) warn('No alarm email subscribed');
  else if (list.some((s) => s.SubscriptionArn === 'PendingConfirmation')) fail('Alarm email not confirmed yet: click the link in the email from AWS');
  else ok('Alarm email confirmed');
}

if (process.env.ADMIN_PASSWORD) {
  console.log('\nThe evening (host desk)');
  const session = await fetch(`${api}/v1/admin/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  if (session.status !== 201) {
    fail(
      session.status === 401
        ? `Host sign-in failed: ADMIN_PASSWORD isn't the ${env} password (dev and prod have their own). Set it again, or unset it to skip this part`
        : `Host sign-in failed (HTTP ${session.status})`,
    );
  } else {
    const { token } = await session.json();
    const view = await fetch(`${api}/v1/views/admin`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
    if (view.mode !== (mode ?? 'TEST')) fail(`The API runs in ${view.mode} mode, Terraform says ${mode}. Apply again`);
    else ok(`Host sign-in works, the API runs in ${view.mode} mode`);
    ok(`Phase ${view.phase}, ${view.guestCount} guests`);
    if (view.quizEnabled === false) ok('Mom vs. Dad quiz: skipped tonight');
    else if (view.quizEnabled === true) warn('Mom vs. Dad quiz: on. To skip it, "Skip the quiz tonight" on the host desk');
    const doctor = { NOT_STARTED: 'no doctor link yet', LINK_ISSUED: 'waiting for the doctor', SUBMITTED: 'answer sealed', CODE_SENT: 'answer sealed, code emailed' }[view.doctor.status];
    if (view.doctor.status === 'CODE_SENT') ok(`Doctor: ${doctor}`);
    else if (view.doctor.status === 'SUBMITTED' && view.doctor.email.status === 'FAILED') fail('Doctor: answer sealed, but the code email failed. "Send the code again" on the host desk');
    else warn(`Doctor: ${doctor}`);
  }
}

console.log(problems === 0 ? '\nReady.\n' : `\n${problems} thing(s) to fix before the evening.\n`);
process.exit(problems === 0 ? 0 : 1);
