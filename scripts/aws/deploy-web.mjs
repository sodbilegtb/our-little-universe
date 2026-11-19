import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { confirmTyped, json, optionalOutput, parseEnv, root, run, terraformOutputs } from './lib.mjs';

/*
 * Builds the web app against the deployed API and publishes it to Amplify:
 *   npm run aws:deploy-web -- dev
 * Needs: terraform apply done for the environment, the AWS CLI, `zip`.
 */

const env = parseEnv(process.argv);
const out = terraformOutputs(env);
const region = ['--region', out.region];

if (env === 'prod') {
  const mode = optionalOutput(env, 'reveal_mode');
  const eventId = optionalOutput(env, 'event_id');
  console.log(`\nProduction: ${out.appUrl}\n  reveal mode  ${mode}\n  event        ${eventId}`);
  await confirmTyped('This replaces the web app guests and the TV use.', 'prod');
}

console.log(`\nBuilding the web app for ${env} (API ${out.apiEndpoint})…`);
run('npm', ['run', 'build', '-w', '@olu/web'], {
  env: { ...process.env, VITE_API_MODE: 'http', VITE_API_BASE_URL: out.apiEndpoint },
});

const dist = join(root, 'apps/web/dist');
const zipPath = join(root, 'apps/web/web-deploy.zip');
rmSync(zipPath, { force: true });
run('zip', ['-q', '-r', zipPath, '.'], { cwd: dist });

console.log('Uploading to Amplify…');
const deployment = json('aws', ['amplify', 'create-deployment', '--app-id', out.amplifyAppId, '--branch-name', out.amplifyBranch, ...region, '--output', 'json']);
const upload = await fetch(deployment.zipUploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'application/zip' },
  body: readFileSync(zipPath),
});
rmSync(zipPath, { force: true });
if (!upload.ok) {
  console.error(`Upload failed: HTTP ${upload.status}`);
  process.exit(1);
}

json('aws', ['amplify', 'start-deployment', '--app-id', out.amplifyAppId, '--branch-name', out.amplifyBranch, '--job-id', deployment.jobId, ...region, '--output', 'json']);

const deadline = Date.now() + 5 * 60 * 1000;
for (;;) {
  const { job } = json('aws', ['amplify', 'get-job', '--app-id', out.amplifyAppId, '--branch-name', out.amplifyBranch, '--job-id', deployment.jobId, ...region, '--output', 'json']);
  const status = job.summary.status;
  if (status === 'SUCCEED') break;
  if (['FAILED', 'CANCELLED'].includes(status) || Date.now() > deadline) {
    console.error(`Deployment ${status === 'PENDING' || status === 'RUNNING' ? 'timed out' : status.toLowerCase()}.`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 4000));
}

console.log(`\nDeployed. Open:\n  TV:         ${out.appUrl}/tv\n  Host desk:  ${out.appUrl}/admin\n  Guests:     scan the QR code on the TV\n`);
