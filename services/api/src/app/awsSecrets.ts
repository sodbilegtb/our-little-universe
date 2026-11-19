import { KMSClient } from '@aws-sdk/client-kms';
import { LambdaClient } from '@aws-sdk/client-lambda';
import type { AppConfig } from '../config/config';
import { LambdaMailerTrigger } from '../mail/trigger';
import { createDocumentClient } from '../repositories/dynamo/DynamoEventRepository';
import { DynamoSecretStore } from '../secret/DynamoSecretStore';
import { KmsSealer } from '../secret/vault';
import type { SecretDeps } from './EventService';

/** The API Lambda's view of the secret: it may seal with KMS, never open. */
export function awsSecrets(config: AppConfig): SecretDeps {
  const required = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`${name} is not configured`);
    return value;
  };
  return {
    store: new DynamoSecretStore(createDocumentClient({ region: config.region }), required(config.secretsTableName, 'SECRETS_TABLE_NAME')),
    sealer: new KmsSealer(new KMSClient({ region: config.region }), required(config.kmsKeyArn, 'KMS_KEY_ARN')),
    mailer: new LambdaMailerTrigger(new LambdaClient({ region: config.region }), required(config.mailerFunctionName, 'MAILER_FUNCTION_NAME')),
  };
}
