import { spawnSync } from 'node:child_process';
import { optionalOutput, parseEnv, root } from './lib.mjs';

/*
 * A DynamoDB backup of the event table, as a second safety net next to the
 * exported archive:
 *   npm run aws:backup -- prod
 * On-demand backups stay after the table is deleted, until you delete them
 * (about 0.10 USD per GB and month; an evening is a few hundred KB).
 */

const env = parseEnv(process.argv);
const region = optionalOutput(env, 'region');
const table = optionalOutput(env, 'table_name');
if (!table) {
  console.error(`No table for ${env}: has terraform apply run?`);
  process.exit(1);
}

function aws(args) {
  const result = spawnSync('aws', [...args, '--region', region, '--output', 'json'], { cwd: root, encoding: 'utf8' });
  if (result.error) throw new Error('The AWS CLI is not installed or not on the PATH.');
  if (result.status !== 0) {
    console.error(result.stderr.trim());
    process.exit(1);
  }
  return JSON.parse(result.stdout);
}

const name = `${table}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const { BackupDetails } = aws(['dynamodb', 'create-backup', '--table-name', table, '--backup-name', name]);
console.log(`\nBacking up ${table} as ${name}…`);

const deadline = Date.now() + 10 * 60 * 1000;
for (;;) {
  const { BackupDescription } = aws(['dynamodb', 'describe-backup', '--backup-arn', BackupDetails.BackupArn]);
  const details = BackupDescription.BackupDetails;
  if (details.BackupStatus === 'AVAILABLE') {
    console.log(`  ✓ available (${details.BackupSizeBytes ?? 0} bytes)\n  ${details.BackupArn}\n`);
    console.log('It stays after the table is deleted. Restore it into a new table with:');
    console.log(`  aws dynamodb restore-table-from-backup --target-table-name ${table}-restored --backup-arn ${details.BackupArn} --region ${region}\n`);
    break;
  }
  if (Date.now() > deadline) {
    console.error(`  ✗ still ${details.BackupStatus} after 10 minutes. Check again with: npm run aws:teardown-check -- ${env}`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
