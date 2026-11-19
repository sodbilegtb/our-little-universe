import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

/** Format: scrypt$N$r$p$<salt base64>$<hash base64>. Safe to store in config; useless without the password. */
export async function hashPassword(password: string, options: { minLength?: number } = {}): Promise<string> {
  const minLength = options.minLength ?? 10;
  if (password.length < minLength) throw new Error(`Use at least ${minLength} characters for the host password.`);
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
