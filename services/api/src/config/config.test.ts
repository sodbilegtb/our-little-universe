import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('configuration', () => {
  it('requires a table for DynamoDB', () => {
    expect(() => loadConfig({ REPOSITORY: 'dynamodb' })).toThrow(/TABLE_NAME/);
    expect(loadConfig({ REPOSITORY: 'dynamodb', TABLE_NAME: 'olu-dev' }).tableName).toBe('olu-dev');
  });

  it('never allows dev routes or memory storage in a deployed environment', () => {
    expect(() => loadConfig({ ENVIRONMENT: 'prod', TABLE_NAME: 't', DEV_ROUTES: 'true' })).toThrow(/DEV_ROUTES/);
    expect(() => loadConfig({ ENVIRONMENT: 'dev', REPOSITORY: 'memory' })).toThrow(/DynamoDB/);
  });

  it('validates the event id and derives the join URL', () => {
    expect(() => loadConfig({ REPOSITORY: 'memory', EVENT_ID: 'Bad Id!' })).toThrow(/EVENT_ID/);
    const config = loadConfig({ REPOSITORY: 'memory', PUBLIC_APP_URL: 'https://party.example.com/' });
    expect(config.joinUrl).toBe('https://party.example.com/party');
  });

  it('sends through SES unless Gmail is chosen, and Gmail needs its app password parameter', () => {
    const deployed = {
      ENVIRONMENT: 'dev',
      TABLE_NAME: 'olu-dev-events',
      SECRETS_TABLE_NAME: 'olu-dev-secrets',
      KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123456789012:key/k',
      MAILER_FUNCTION_NAME: 'olu-dev-mailer',
    };
    expect(loadConfig(deployed).emailTransport).toBe('ses');
    expect(() => loadConfig({ ...deployed, EMAIL_TRANSPORT: 'gmail' })).toThrow(/GMAIL_APP_PASSWORD_PARAMETER/);
    const gmail = loadConfig({ ...deployed, EMAIL_TRANSPORT: 'gmail', GMAIL_APP_PASSWORD_PARAMETER: '/olu/dev/gmail-app-password' });
    expect(gmail).toMatchObject({ emailTransport: 'gmail', gmailAppPasswordParameter: '/olu/dev/gmail-app-password' });
  });
});
