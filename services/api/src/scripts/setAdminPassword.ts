import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { hashPassword } from '../security/password';

/*
 * Sets the host password for a deployed environment:
 *   npm run aws:set-password -- dev
 *
 * Hashes the password locally (scrypt) and stores only the hash in SSM
 * Parameter Store as a SecureString: /olu/<env>/admin-password-hash.
 * Uses your AWS CLI credentials (AWS_PROFILE / AWS_REGION are respected).
 * The password is never echoed, logged, or passed on a command line.
 */

const env = process.argv[2];
if (env !== 'dev' && env !== 'prod') {
  console.error('Usage: npm run aws:set-password -- <dev|prod>');
  process.exit(1);
}
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-central-1';
const name = `/olu/${env}/admin-password-hash`;

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

const password = await askHidden(`New host password for ${env} (at least 10 characters): `);
const repeat = await askHidden('Repeat it: ');
if (password !== repeat) {
  console.error('The passwords do not match. Nothing was changed.');
  process.exit(1);
}
const hash = await hashPassword(password);

// Pass the value through a private temp file, not argv, so it never shows up in process lists.
const dir = mkdtempSync(join(tmpdir(), 'olu-'));
const file = join(dir, 'parameter.json');
try {
  writeFileSync(
    file,
    JSON.stringify({
      Name: name,
      Value: hash,
      Type: 'SecureString',
      Overwrite: true,
      Description: 'Our Little Universe host password (scrypt hash)',
    }),
    { mode: 0o600 },
  );
  const result = spawnSync('aws', ['ssm', 'put-parameter', '--region', region, '--cli-input-json', `file://${file}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (result.error) {
    console.error('Could not run the AWS CLI. Is it installed and on your PATH?');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`Saved the hash to ${name} in ${region}. The API picks it up within 5 minutes.`);
