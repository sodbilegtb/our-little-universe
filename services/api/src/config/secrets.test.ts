import { describe, expect, it } from 'vitest';
import { ParameterNotFound } from '@aws-sdk/client-ssm';
import { silentLogger } from '../app/logger';
import { loadConfig } from './config';
import { createPasswordHashProvider, type ParameterReader } from './secrets';

const HASH = 'scrypt$16384$8$1$c2FsdA==$aGFzaA==';
const deployed = () =>
  loadConfig({ REPOSITORY: 'dynamodb', TABLE_NAME: 'olu-dev-events', ADMIN_PASSWORD_HASH_PARAMETER: '/olu/dev/admin-password-hash' });

function stubReader(respond: () => Promise<{ Parameter?: { Value?: string } }>) {
  const calls: unknown[] = [];
  const reader: ParameterReader = {
    send: async (command) => {
      calls.push(command.input);
      return respond();
    },
  };
  return { reader, calls };
}

describe('host password hash from SSM', () => {
  it('reads the hash with decryption and caches it', async () => {
    const { reader, calls } = stubReader(async () => ({ Parameter: { Value: HASH } }));
    const clock = { now: 0 };
    const provider = createPasswordHashProvider(deployed(), silentLogger, reader, () => clock.now);
    expect(await provider()).toBe(HASH);
    expect(await provider()).toBe(HASH);
    expect(calls).toEqual([{ Name: '/olu/dev/admin-password-hash', WithDecryption: true }]);
    clock.now += 5 * 60 * 1000 + 1; // picks up a changed password without a redeploy
    await provider();
    expect(calls).toHaveLength(2);
  });

  it('keeps the API running when the parameter is missing, and retries soon', async () => {
    let exists = false;
    const { reader } = stubReader(async () => {
      if (!exists) throw new ParameterNotFound({ message: 'not found', $metadata: {} });
      return { Parameter: { Value: HASH } };
    });
    const clock = { now: 0 };
    const provider = createPasswordHashProvider(deployed(), silentLogger, reader, () => clock.now);
    expect(await provider()).toBeUndefined();
    exists = true;
    expect(await provider()).toBeUndefined(); // still cached
    clock.now += 31_000;
    expect(await provider()).toBe(HASH);
  });

  it('rejects a value that is not an scrypt hash', async () => {
    const { reader } = stubReader(async () => ({ Parameter: { Value: 'a plain password' } }));
    expect(await createPasswordHashProvider(deployed(), silentLogger, reader)()).toBeUndefined();
  });

  it('uses a locally configured hash without calling SSM', async () => {
    const { reader, calls } = stubReader(async () => ({}));
    const provider = createPasswordHashProvider(loadConfig({ REPOSITORY: 'memory', ADMIN_PASSWORD_HASH: HASH }), silentLogger, reader);
    expect(await provider()).toBe(HASH);
    expect(calls).toHaveLength(0);
  });
});
