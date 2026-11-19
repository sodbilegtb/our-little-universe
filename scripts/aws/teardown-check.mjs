import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MANIFEST, verifyArchive } from './archive.mjs';
import { optionalOutput, parseEnv, root } from './lib.mjs';

/*
 * Before removing an environment: is everything worth keeping safe?
 *   npm run aws:teardown-check -- prod
 * Read-only. It never destroys anything; it tells you whether it is safe to,
 * and the exact commands. For prod it requires a verified export of the
 * current event and an available backup. For dev it requires prod to be gone
 * first (prod sends with the email identities dev manages).
 */

const env = parseEnv(process.argv);
const region = optionalOutput(env, 'region');
const table = optionalOutput(env, 'table_name');
const eventId = optionalOutput(env, 'event_id');
const strict = env === 'prod';
let blockers = 0;

const ok = (text) => console.log(`  ✓ ${text}`);
const note = (text) => console.log(`  ! ${text}`);
/** "(dev) …" marks what only matters for prod: in dev (rehearsal data) it is a note, not a blocker. */
const block = (text) => {
  const onlyProd = text.startsWith('(dev) ');
  const message = onlyProd ? text.slice(6) : text;
  if (onlyProd && !strict) return note(message);
  blockers += 1;
  console.log(`  ✗ ${message}`);
};

function aws(args) {
  const result = spawnSync('aws', [...args, '--region', region, '--output', 'json'], { cwd: root, encoding: 'utf8' });
  if (result.error) throw new Error('The AWS CLI is not installed or not on the PATH.');
  return result.status === 0 ? { value: JSON.parse(result.stdout || 'null') } : { error: result.stderr.trim().split('\n').at(-1) };
}

console.log(`\nTeardown check: ${env}${table ? ` (${table})` : ''}\n`);
if (!table) {
  console.log('  Nothing deployed (no Terraform outputs). Nothing to remove.\n');
  process.exit(0);
}

console.log('Your copy of the evening');
const exportsDir = join(root, 'exports');
const archives = existsSync(exportsDir)
  ? readdirSync(exportsDir)
      .filter((name) => name.startsWith(`${env}-${eventId}-`) && existsSync(join(exportsDir, name, MANIFEST)))
      .sort()
  : [];
const latest = archives.at(-1);
let exportedAt = null;
if (!latest) {
  block(`(dev) No export of event "${eventId}" yet. Run: npm run aws:export -- ${env}`);
} else {
  const dir = join(exportsDir, latest);
  const problems = verifyArchive(dir);
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
  exportedAt = manifest.exportedAt;
  if (problems.length) block(`(dev) ${relative(root, dir)} is not whole: ${problems.join('; ')}. Export again`);
  else ok(`${relative(root, dir)}: verified (${manifest.counts.guests} guests, ${manifest.counts.messages} messages)`);
  const event = JSON.parse(readFileSync(join(dir, 'event.json'), 'utf8'));
  if (event.phase !== 'FINISHED') block(`(dev) The export was made in phase ${event.phase}, before the evening was finished. Export again`);
}

console.log('\nBackup');
const backups = aws(['dynamodb', 'list-backups', '--table-name', table]);
const available = (backups.value?.BackupSummaries ?? []).filter((b) => b.BackupStatus === 'AVAILABLE');
const newest = available.sort((a, b) => String(a.BackupCreationDateTime).localeCompare(String(b.BackupCreationDateTime))).at(-1);
if (backups.error) block(`Could not list backups: ${backups.error}`);
else if (!newest) block(`(dev) No backup of ${table}. Run: npm run aws:backup -- ${env}`);
else if (exportedAt && new Date(newest.BackupCreationDateTime) < new Date(exportedAt)) block(`(dev) The newest backup is older than the export. Run: npm run aws:backup -- ${env}`);
else ok(`${newest.BackupName} (kept after the table is deleted)`);

if (env === 'dev') {
  console.log('\nProduction first');
  const prodState = spawnSync('terraform', ['-chdir=infrastructure/terraform/environments/prod', 'state', 'list'], { cwd: root, encoding: 'utf8' });
  const resources = prodState.status === 0 ? prodState.stdout.trim().split('\n').filter(Boolean) : [];
  if (resources.length) block(`Prod still has ${resources.length} resources and sends with the email identities dev manages. Tear down prod first`);
  else ok('Prod is gone (or was never created)');
}

console.log('\nDeletion protection');
const described = aws(['dynamodb', 'describe-table', '--table-name', table]);
const protectedTable = described.value?.Table?.DeletionProtectionEnabled === true;
if (protectedTable && env === 'prod') note('On. Set allow_destroy = true in terraform.tfvars, then plan and apply (only the protection changes)');
else if (protectedTable) block(`On for ${table}, which dev doesn't set. Turn it off in the DynamoDB console first`);
else ok('Off');

if (blockers > 0) {
  console.log(`\nNot yet: ${blockers} thing(s) above first. Nothing was changed.\n`);
  process.exit(1);
}
console.log(`\nSafe to remove ${env}. You run it, after reading the plan:\n`);
console.log(`  cd infrastructure/terraform/environments/${env}`);
if (protectedTable && env === 'prod') console.log('  # allow_destroy = true in terraform.tfvars, then: terraform plan -out=unprotect.tfplan && terraform apply unprotect.tfplan');
console.log('  terraform plan -destroy -out=destroy.tfplan');
console.log('  terraform apply destroy.tfplan');
console.log(`\nAfterwards, by hand (Terraform doesn't own these): docs/after-the-party.md, "What stays".\n`);
