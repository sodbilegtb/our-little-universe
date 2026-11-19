import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';
import type { Logger } from '../app/logger';
import type { AppConfig } from './config';

/** The subset of the SSM client used here, so tests can inject a stub. */
export interface ParameterReader {
  send(command: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }>;
}

export type PasswordHashProvider = () => Promise<string | undefined>;

const REFRESH_AFTER_MS = 5 * 60 * 1000;
const RETRY_MISSING_AFTER_MS = 30 * 1000;

/**
 * Supplies the host password hash. Locally it comes straight from config.
 * Deployed, it lives in SSM Parameter Store (SecureString), so it never
 * appears in Terraform state or the Lambda configuration.
 *
 * The value is cached per Lambda container and refreshed every 5 minutes, so
 * a changed password applies without a redeploy. A missing or malformed
 * parameter doesn't take the API down: guests can still play, host sign-in
 * answers "not configured", and it is retried after 30 seconds.
 */
export function createPasswordHashProvider(
  config: AppConfig,
  logger: Logger,
  reader: ParameterReader = new SSMClient({ region: config.region }),
  now: () => number = Date.now,
): PasswordHashProvider {
  if (config.adminPasswordHash || !config.adminPasswordHashParameter) {
    const fixed = config.adminPasswordHash;
    return async () => fixed;
  }
  const name = config.adminPasswordHashParameter;
  let cached: { value: string | undefined; expiresAt: number } | null = null;

  return async () => {
    if (cached && cached.expiresAt > now()) return cached.value;
    let value: string | undefined;
    try {
      const result = await reader.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      value = result.Parameter?.Value;
      if (!value?.startsWith('scrypt$')) {
        logger.error('host password parameter is not an scrypt hash', { parameter: name });
        value = undefined;
      }
    } catch (error) {
      const missing = error instanceof ParameterNotFound || (error as { name?: string }).name === 'ParameterNotFound';
      logger.error(missing ? 'host password parameter not found' : 'could not read host password parameter', {
        parameter: name,
        ...(missing ? {} : { error: (error as Error).name }),
      });
    }
    cached = { value, expiresAt: now() + (value ? REFRESH_AFTER_MS : RETRY_MISSING_AFTER_MS) };
    return value;
  };
}
