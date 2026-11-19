import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** Helpers for the small setup scripts that store secrets in SSM. */

export const awsRegion = () => process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-central-1';

export function environmentArgument(usage: string): 'dev' | 'prod' {
  const env = process.argv[2];
  if (env !== 'dev' && env !== 'prod') {
    console.error(`Usage: ${usage} <dev|prod>`);
    process.exit(1);
  }
  return env;
}

/** Asks without echoing what is typed. */
export function askHidden(question: string): Promise<string> {
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

/**
 * Stores a SecureString with the AWS CLI. The value goes through a private
 * temp file, not argv, so it never shows up in process lists.
 */
export function putSecureString(name: string, value: string, description: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'olu-'));
  const file = join(dir, 'parameter.json');
  try {
    writeFileSync(file, JSON.stringify({ Name: name, Value: value, Type: 'SecureString', Overwrite: true, Description: description }), {
      mode: 0o600,
    });
    const result = spawnSync('aws', ['ssm', 'put-parameter', '--region', awsRegion(), '--cli-input-json', `file://${file}`], {
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
}
