import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function parseEnv(argv) {
  const env = argv[2];
  if (env !== 'dev' && env !== 'prod') {
    console.error(`Usage: node ${argv[1]} <dev|prod>`);
    process.exit(1);
  }
  return env;
}

/** Runs a command, streaming its output. Exits on failure. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(' ')} failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

/** Runs a command and returns its stdout parsed as JSON. */
export function json(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return JSON.parse(result.stdout);
}

/** Reads `terraform output` for an environment. */
export function terraformOutputs(env) {
  const outputs = json('terraform', [`-chdir=infrastructure/terraform/environments/${env}`, 'output', '-json']);
  const value = (name) => {
    if (!outputs[name]) {
      console.error(`Terraform output "${name}" is missing. Has \`terraform apply\` run for ${env}?`);
      process.exit(1);
    }
    return outputs[name].value;
  };
  return {
    appUrl: value('app_url'),
    apiEndpoint: value('api_endpoint'),
    amplifyAppId: value('amplify_app_id'),
    amplifyBranch: value('amplify_branch'),
    region: value('region'),
  };
}

/** Asks for a typed confirmation on the terminal; anything else stops the script. */
export async function confirmTyped(question, expected) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} Type "${expected}" to continue: `)).trim();
  rl.close();
  if (answer !== expected) {
    console.error('Stopped. Nothing was changed.');
    process.exit(1);
  }
}

/** A Terraform output that may be missing (older environments), or undefined. */
const outputCache = new Map();
export function optionalOutput(env, name) {
  if (!outputCache.has(env)) outputCache.set(env, json('terraform', [`-chdir=infrastructure/terraform/environments/${env}`, 'output', '-json']));
  return outputCache.get(env)[name]?.value;
}

/** Asks without echoing what is typed (for passwords). */
export async function askHidden(question) {
  const { createInterface } = await import('node:readline');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
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

/** Signs in to the host desk API and returns a bearer token. */
export async function hostToken(api) {
  const password = process.env.ADMIN_PASSWORD || (await askHidden('Host password: '));
  const response = await fetch(`${api}/v1/admin/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (response.status !== 201) {
    console.error(`Host sign-in failed (HTTP ${response.status}).`);
    process.exit(1);
  }
  return (await response.json()).token;
}
