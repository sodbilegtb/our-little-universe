import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../security/password';

/**
 * Prints an scrypt hash for the host password. Put the hash (never the
 * password) into ADMIN_PASSWORD_HASH. The password is read from stdin so it
 * never lands in shell history.
 */
const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = (await rl.question('Host password (at least 10 characters): ')).trim();
rl.close();
console.log(await hashPassword(password));
