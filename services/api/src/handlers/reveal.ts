import { KMSClient } from '@aws-sdk/client-kms';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createLogger, type Logger } from '../app/logger';
import { loadConfig } from '../config/config';
import { createDocumentClient } from '../repositories/dynamo/DynamoEventRepository';
import { dynamoRevealControl, readRevealResult, type RevealDeps } from '../reveal/revealResult';
import { DynamoSecretStore } from '../secret/DynamoSecretStore';
import { KmsOpener } from '../secret/vault';

/*
 * The reveal Lambda: GET /v1/reveal/result, and nothing else. Its role may read
 * the event's STATE item and the sealed answer, and open only the answer.
 * It never writes anything. Until the reveal moment it answers the same
 * neutral 409 whatever the reason.
 */

let deps: (RevealDeps & { logger: Logger }) | undefined;

function init() {
  const config = loadConfig();
  if (!config.secretsTableName || !config.kmsKeyArn || !config.tableName) {
    throw new Error('TABLE_NAME, SECRETS_TABLE_NAME and KMS_KEY_ARN are required');
  }
  const doc = createDocumentClient({ region: config.region });
  return {
    loadControl: dynamoRevealControl(doc, config.tableName, config.eventId),
    store: new DynamoSecretStore(doc, config.secretsTableName),
    opener: new KmsOpener(new KMSClient({ region: config.region }), config.kmsKeyArn),
    environment: config.environment,
    eventId: config.eventId,
    now: Date.now,
    logger: createLogger(config.logLevel, { environment: config.environment, eventId: config.eventId, fn: 'reveal' }),
  };
}

export const NOT_YET = { error: { code: 'WRONG_PHASE', message: 'The secret is still sealed.' } };

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    body: JSON.stringify(body),
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  deps ??= init();
  if (event.requestContext?.http?.method !== 'GET') return json(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  try {
    const result = await readRevealResult(deps);
    if (!result) return json(409, NOT_YET);
    deps.logger.info('reveal result served'); // never the result itself
    return json(200, result);
  } catch (error) {
    deps.logger.error('reveal result failed', { error: (error as Error).name });
    return json(500, { error: { code: 'NOT_AVAILABLE', message: 'Something went wrong on our side. Please try again.' } });
  }
}
