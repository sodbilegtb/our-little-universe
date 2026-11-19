import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import { parseBearer, parseGuestCredential, randomToken, serverIds } from './tokens';

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password 1')).not.toBe(await hashPassword('same password 1'));
  });

  it('requires a reasonable length', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });
});

describe('tokens and ids', () => {
  it('generates 256-bit url-safe tokens', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('derives the same message id for a resent draft only', () => {
    expect(serverIds.messageId('gst_a', 'draft-1')).toBe(serverIds.messageId('gst_a', 'draft-1'));
    expect(serverIds.messageId('gst_a', 'draft-1')).not.toBe(serverIds.messageId('gst_b', 'draft-1'));
    expect(serverIds.messageId('gst_a', 'draft-1')).not.toBe(serverIds.messageId('gst_a', 'draft-2'));
  });

  it('parses guest and host credentials strictly', () => {
    const guestId = serverIds.guestId();
    const token = serverIds.sessionToken();
    expect(parseGuestCredential(`Bearer ${guestId}.${token}`)).toEqual({ guestId, sessionToken: token });
    expect(parseGuestCredential(`Bearer ${guestId}`)).toBeNull();
    expect(parseGuestCredential(`Basic ${guestId}.${token}`)).toBeNull();
    expect(parseGuestCredential(undefined)).toBeNull();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer('Bearer short')).toBeNull();
  });
});
