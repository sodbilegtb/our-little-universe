import { hashPassword } from '../security/password';
import { askHidden, awsRegion, environmentArgument, putSecureString } from './cli';

/*
 * Sets the host password for a deployed environment:
 *   npm run aws:set-password -- dev
 *
 * Hashes the password locally (scrypt) and stores only the hash in SSM
 * Parameter Store as a SecureString: /olu/<env>/admin-password-hash.
 * Uses your AWS CLI credentials (AWS_PROFILE / AWS_REGION are respected).
 * The password is never echoed, logged, or passed on a command line.
 */

const env = environmentArgument('npm run aws:set-password --');
const name = `/olu/${env}/admin-password-hash`;

const password = await askHidden(`New host password for ${env} (at least 10 characters): `);
const repeat = await askHidden('Repeat it: ');
if (password !== repeat) {
  console.error('The passwords do not match. Nothing was changed.');
  process.exit(1);
}
putSecureString(name, await hashPassword(password), 'Our Little Universe host password (scrypt hash)');
console.log(`Saved the hash to ${name} in ${awsRegion()}. The API picks it up within 5 minutes.`);
