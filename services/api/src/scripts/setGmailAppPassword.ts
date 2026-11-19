import { askHidden, awsRegion, environmentArgument, putSecureString } from './cli';

/*
 * Stores the app password of the Gmail account that sends the reveal code:
 *   npm run aws:set-gmail-password -- dev
 *
 * Create it at https://myaccount.google.com/apppasswords (2-Step Verification
 * must be on). It goes to SSM Parameter Store as a SecureString,
 * /olu/<env>/gmail-app-password, read only by the mailer Lambda. It is never
 * echoed, logged, or passed on a command line.
 */

const env = environmentArgument('npm run aws:set-gmail-password --');
const name = `/olu/${env}/gmail-app-password`;

const typed = await askHidden(`Gmail app password for ${env} (16 letters, spaces don't matter): `);
const password = typed.replace(/\s+/g, '');
if (!/^[a-z]{16}$/i.test(password)) {
  console.error('That is not an app password: Google shows 16 letters, e.g. "abcd efgh ijkl mnop". Nothing was changed.');
  process.exit(1);
}
putSecureString(name, password, 'Our Little Universe: app password of the Gmail account that sends the reveal code');
console.log(`Saved to ${name} in ${awsRegion()}. The next code email uses it.`);
