import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptCommand, EncryptCommand, type KMSClient } from '@aws-sdk/client-kms';

/*
 * Sealing secrets. Every ciphertext is bound to a purpose and to the event and
 * selection it belongs to (KMS encryption context, or AES-GCM associated data
 * locally). IAM then decides who may open which purpose:
 *   - the API may seal both, open neither;
 *   - the mailer may open only 'reveal-code';
 *   - the reveal service may open only 'doctor-selection'.
 */

export type SecretPurpose = 'doctor-selection' | 'reveal-code';

export interface SealContext {
  environment: string;
  eventId: string;
  selectionId: string;
}

export interface Sealer {
  seal(purpose: SecretPurpose, plaintext: string, context: SealContext): Promise<string>;
}

export interface Opener {
  open(purpose: SecretPurpose, ciphertext: string, context: SealContext): Promise<string>;
}

function encryptionContext(purpose: SecretPurpose, context: SealContext): Record<string, string> {
  return { purpose, environment: context.environment, eventId: context.eventId, selectionId: context.selectionId };
}

export class KmsSealer implements Sealer {
  constructor(
    private readonly client: Pick<KMSClient, 'send'>,
    private readonly keyId: string,
  ) {}

  async seal(purpose: SecretPurpose, plaintext: string, context: SealContext): Promise<string> {
    const result = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: Buffer.from(plaintext, 'utf8'),
        EncryptionContext: encryptionContext(purpose, context),
      }),
    );
    if (!result.CiphertextBlob) throw new Error('KMS returned no ciphertext');
    return Buffer.from(result.CiphertextBlob).toString('base64');
  }
}

export class KmsOpener implements Opener {
  constructor(
    private readonly client: Pick<KMSClient, 'send'>,
    private readonly keyId: string,
  ) {}

  async open(purpose: SecretPurpose, ciphertext: string, context: SealContext): Promise<string> {
    const result = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyId, // refuse ciphertexts from any other key
        CiphertextBlob: Buffer.from(ciphertext, 'base64'),
        EncryptionContext: encryptionContext(purpose, context),
      }),
    );
    if (!result.Plaintext) throw new Error('KMS returned no plaintext');
    return Buffer.from(result.Plaintext).toString('utf8');
  }
}

/**
 * AES-256-GCM with the same context binding, for the local server and tests.
 * Never used in AWS (the config requires KMS there).
 */
export class LocalVault implements Sealer, Opener {
  private readonly key: Buffer;

  constructor(key: Buffer = randomBytes(32)) {
    if (key.length !== 32) throw new Error('LocalVault needs a 32-byte key');
    this.key = key;
  }

  async seal(purpose: SecretPurpose, plaintext: string, context: SealContext): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(encryptionContext(purpose, context))));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  async open(purpose: SecretPurpose, ciphertext: string, context: SealContext): Promise<string> {
    const data = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify(encryptionContext(purpose, context))));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
}
