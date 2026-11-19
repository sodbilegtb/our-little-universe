import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { archiveFiles, manifestFor, MANIFEST, verifyArchive } from './archive.mjs';
import { hostToken, parseEnv, root, terraformOutputs } from './lib.mjs';

/*
 * Saves the evening to your computer and checks the copy:
 *   npm run aws:export -- prod
 *   npm run aws:export -- --verify exports/prod-baby-reveal-2026-…   (check a copy again later)
 *
 * Writes exports/<env>-<event>-<time>/ (never committed): event.json (everything,
 * with the result once revealed), CSV files, a printable memory-book.html and
 * manifest.json with a checksum and row count per file. Read-only on AWS.
 */

function report(dir) {
  const problems = verifyArchive(dir);
  if (problems.length === 0) {
    console.log(`  ✓ every file is there, unchanged and readable`);
    return true;
  }
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  return false;
}

if (process.argv[2] === '--verify') {
  const dir = process.argv[3];
  if (!dir || !existsSync(join(dir, MANIFEST))) {
    console.error('Usage: npm run aws:export -- --verify <archive folder>');
    process.exit(1);
  }
  console.log(`\nChecking ${dir}`);
  process.exit(report(dir) ? 0 : 1);
}

const env = parseEnv(process.argv);
const out = terraformOutputs(env);
const api = out.apiEndpoint.replace(/\/$/, '');
const token = await hostToken(api);

const exported = await fetch(`${api}/v1/admin/export`, { headers: { authorization: `Bearer ${token}` } });
if (!exported.ok) {
  console.error(`The export failed (HTTP ${exported.status}).`);
  process.exit(1);
}
const data = await exported.json();
// The result belongs in the keepsake once it is out; before the reveal the server says nothing.
const revealed = await fetch(`${api}/v1/reveal/result`);
const reveal = revealed.ok ? await revealed.json() : null;

const stamp = data.exportedAt.replace(/[:.]/g, '-');
const dir = join(root, 'exports', `${env}-${data.eventId}-${stamp}`);
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
const files = archiveFiles(data, reveal);
for (const file of files) writeFileSync(join(dir, file.name), file.content, { mode: 0o600 });
writeFileSync(join(dir, MANIFEST), JSON.stringify(manifestFor(data, files, env), null, 2), { mode: 0o600 });

const messages = data.messages.filter((m) => !m.removed).length;
console.log(`\nSaved ${env} event "${data.eventId}" to ${relative(root, dir)}`);
console.log(`  ${data.guests.length} guests, ${data.voting.votes.length} votes, ${messages} messages for the baby${reveal ? ', the result' : ''}`);
if (data.phase !== 'FINISHED') console.log(`  ! the evening is in phase ${data.phase}: export again once it is finished`);
console.log('\nChecking the copy');
const whole = report(dir);
console.log(
  whole
    ? `\nOpen memory-book.html to read (or print) the messages. Keep a second copy somewhere safe\nand check it there with: npm run aws:export -- --verify <folder>\n`
    : '\nThe copy is not complete. Export again before removing anything.\n',
);
process.exit(whole ? 0 : 1);
