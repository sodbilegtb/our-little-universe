import type { AppConfig } from '../config/config';
import { createRouter } from '../http/router';
import { DynamoEventRepository, createDocumentClient } from '../repositories/dynamo/DynamoEventRepository';
import type { EventRepository } from '../repositories/EventRepository';
import { MemoryEventRepository } from '../repositories/memory/MemoryEventRepository';
import { serverIds } from '../security/tokens';
import { awsSecrets } from './awsSecrets';
import { EventService, type SecretDeps } from './EventService';
import { createLogger, type Logger } from './logger';
import { createPasswordHashProvider } from '../config/secrets';

export interface App {
  service: EventService;
  route: ReturnType<typeof createRouter>;
  logger: Logger;
}

export function createRepository(config: AppConfig, memoryFile?: string): EventRepository {
  if (config.repository === 'memory') return new MemoryEventRepository(memoryFile);
  return new DynamoEventRepository(
    createDocumentClient({ region: config.region, endpoint: config.dynamoEndpoint }),
    config.tableName as string,
  );
}

/** Wires the service and router. Called once per Lambda container or local server. */
export function createApp(
  config: AppConfig,
  repository: EventRepository = createRepository(config),
  options: { secrets?: SecretDeps } = {},
): App {
  const logger = createLogger(config.logLevel, { environment: config.environment, eventId: config.eventId });
  const passwordHash = createPasswordHashProvider(config, logger);
  // Deployed: KMS, the secrets table and the mailer Lambda. Locally: in-memory (see localSecrets).
  const secrets = options.secrets ?? (config.environment === 'local' ? undefined : awsSecrets(config));
  const service = new EventService({ config, repository, ids: serverIds, logger, passwordHash, secrets });
  return { service, route: createRouter(service, logger), logger };
}
