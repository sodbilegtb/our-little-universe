import { KMSClient } from '@aws-sdk/client-kms';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SSMClient } from '@aws-sdk/client-ssm';
import { createLogger } from '../app/logger';
import { loadConfig } from '../config/config';
import { deliverRevealCode, type MailerDeps } from '../mail/deliverCode';
import { GmailTransport, ssmAppPassword } from '../mail/gmail';
import { SesTransport, type MailTransport } from '../mail/transport';
import type { MailRequest } from '../mail/trigger';
import { createDocumentClient } from '../repositories/dynamo/DynamoEventRepository';
import { DynamoSecretStore } from '../secret/DynamoSecretStore';
import { KmsOpener } from '../secret/vault';

/*
 * The mailer Lambda, invoked asynchronously by the API with ids only. Its role
 * may open sealed codes (never the doctor's answer), read and update the email
 * fields of a sealed answer, and send through SES or, with EMAIL_TRANSPORT=gmail,
 * through a Gmail account. A thrown error makes Lambda retry, and every retry
 * sends the same code.
 */

function transportFor(config: ReturnType<typeof loadConfig>): MailTransport {
  if (config.emailTransport === 'gmail') {
    if (!config.gmailAppPasswordParameter) throw new Error('GMAIL_APP_PASSWORD_PARAMETER is required');
    return new GmailTransport(ssmAppPassword(config.gmailAppPasswordParameter, new SSMClient({ region: config.region })));
  }
  return new SesTransport(new SESv2Client({ region: config.region }));
}

let deps: MailerDeps | undefined;

function init(): MailerDeps {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { environment: config.environment, eventId: config.eventId, fn: 'mailer' });
  if (!config.secretsTableName || !config.kmsKeyArn) throw new Error('SECRETS_TABLE_NAME and KMS_KEY_ARN are required');
  return {
    store: new DynamoSecretStore(createDocumentClient({ region: config.region }), config.secretsTableName),
    opener: new KmsOpener(new KMSClient({ region: config.region }), config.kmsKeyArn),
    transport: transportFor(config),
    logger,
    now: Date.now,
    config: {
      environment: config.environment,
      eventId: config.eventId,
      eventName: config.eventName,
      appUrl: config.appUrl,
      mode: config.revealMode,
      sender: config.emailSender,
      recipients: config.emailRecipients,
    },
  };
}

export async function handler(event: Partial<MailRequest>): Promise<{ outcome: string }> {
  deps ??= init();
  if (typeof event.eventId !== 'string' || typeof event.selectionId !== 'string') {
    deps.logger.warn('mailer called without ids');
    return { outcome: 'IGNORED' };
  }
  return { outcome: await deliverRevealCode(deps, { eventId: event.eventId, selectionId: event.selectionId }) };
}
