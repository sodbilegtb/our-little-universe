import { z } from 'zod';

/**
 * Server configuration, read once from environment variables and validated.
 * Test and live data are separated by ENVIRONMENT, TABLE_NAME and EVENT_ID,
 * all set server-side. A client can never choose them.
 */
const schema = z
  .object({
    ENVIRONMENT: z.enum(['local', 'dev', 'prod']).default('local'),
    EVENT_ID: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,39}$/, 'EVENT_ID: 3-40 lowercase letters, digits or dashes')
      .default('local-preview'),
    EVENT_NAME: z.string().min(1).max(60).default('Our Little Universe'),
    REPOSITORY: z.enum(['memory', 'dynamodb']).default('dynamodb'),
    TABLE_NAME: z.string().min(3).optional(),
    DYNAMODB_ENDPOINT: z.url().optional(),
    AWS_REGION: z.string().default('eu-central-1'),
    /** scrypt hash from `npm run hash-password`. Never the plain password. Local use. */
    ADMIN_PASSWORD_HASH: z.string().startsWith('scrypt$').optional(),
    /** Deployed: name of the SSM SecureString holding the hash, read at cold start. */
    ADMIN_PASSWORD_HASH_PARAMETER: z.string().regex(/^\/[A-Za-z0-9_./-]+$/).optional(),
    ADMIN_SESSION_HOURS: z.coerce.number().min(1).max(48).default(12),
    /** Public URL of the web app, used for the TV's QR code. */
    PUBLIC_APP_URL: z.url().optional(),
    /** Local development only: reset and simulate endpoints. */
    DEV_ROUTES: z.enum(['true', 'false']).default('false'),
    /**
     * TEST everywhere except prod. Prod defaults to LIVE and can only be set to
     * TEST explicitly (a rehearsal); dev and local can never be LIVE.
     */
    REVEAL_MODE: z.enum(['TEST', 'LIVE']).optional(),
    /** Separate table for sealed answers, codes and doctor links. */
    SECRETS_TABLE_NAME: z.string().min(3).optional(),
    /** Customer managed KMS key; the API may only encrypt with it. */
    KMS_KEY_ARN: z.string().startsWith('arn:aws:kms:').optional(),
    /** The Lambda that emails the reveal code (invoked asynchronously). */
    MAILER_FUNCTION_NAME: z.string().min(1).optional(),
    DOCTOR_LINK_HOURS: z.coerce.number().min(1).max(168).default(48),
    /** From the host entering the code to the moment the result may be shown. */
    REVEAL_DELAY_SECONDS: z.coerce.number().min(5).max(120).default(30),
    /** Mailer only. */
    EMAIL_SENDER: z.email().optional(),
    EMAIL_RECIPIENTS: z.string().optional(),
    /** Mailer only: Amazon SES, or a Gmail account with an app password (SMTP). */
    EMAIL_TRANSPORT: z.enum(['ses', 'gmail']).default('ses'),
    /** Mailer only, with gmail: name of the SSM SecureString holding the app password. */
    GMAIL_APP_PASSWORD_PARAMETER: z.string().regex(/^\/[A-Za-z0-9_./-]+$/).optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.REPOSITORY === 'dynamodb' && !env.TABLE_NAME) {
      ctx.addIssue({ code: 'custom', message: 'TABLE_NAME is required when REPOSITORY=dynamodb', path: ['TABLE_NAME'] });
    }
    if (env.ENVIRONMENT !== 'local' && env.DEV_ROUTES === 'true') {
      ctx.addIssue({ code: 'custom', message: 'DEV_ROUTES may only be enabled locally', path: ['DEV_ROUTES'] });
    }
    if (env.ENVIRONMENT !== 'local' && env.REPOSITORY === 'memory') {
      ctx.addIssue({ code: 'custom', message: 'Deployed environments must use DynamoDB', path: ['REPOSITORY'] });
    }
    if (env.ENVIRONMENT !== 'prod' && env.REVEAL_MODE === 'LIVE') {
      ctx.addIssue({ code: 'custom', message: 'Only prod can run a live reveal', path: ['REVEAL_MODE'] });
    }
    if (env.ENVIRONMENT !== 'local' && (!env.SECRETS_TABLE_NAME || !env.KMS_KEY_ARN || !env.MAILER_FUNCTION_NAME)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Deployed environments need SECRETS_TABLE_NAME, KMS_KEY_ARN and MAILER_FUNCTION_NAME',
        path: ['SECRETS_TABLE_NAME'],
      });
    }
    if (env.EMAIL_TRANSPORT === 'gmail' && env.ENVIRONMENT !== 'local' && !env.GMAIL_APP_PASSWORD_PARAMETER) {
      ctx.addIssue({ code: 'custom', message: 'EMAIL_TRANSPORT=gmail needs GMAIL_APP_PASSWORD_PARAMETER', path: ['GMAIL_APP_PASSWORD_PARAMETER'] });
    }
    const recipients = (env.EMAIL_RECIPIENTS ?? '').split(',').map((r) => r.trim()).filter(Boolean);
    for (const recipient of recipients) {
      if (!z.email().safeParse(recipient).success) {
        ctx.addIssue({ code: 'custom', message: `Not an email address: ${recipient}`, path: ['EMAIL_RECIPIENTS'] });
      }
    }
  });

export type RawConfig = z.infer<typeof schema>;

export interface AppConfig {
  environment: RawConfig['ENVIRONMENT'];
  eventId: string;
  eventName: string;
  repository: RawConfig['REPOSITORY'];
  tableName: string | undefined;
  dynamoEndpoint: string | undefined;
  region: string;
  adminPasswordHash: string | undefined;
  adminPasswordHashParameter: string | undefined;
  adminSessionMs: number;
  joinUrl: string;
  devRoutes: boolean;
  logLevel: RawConfig['LOG_LEVEL'];
  /** Base URL of the web app (doctor links are built from it). */
  appUrl: string;
  revealMode: 'TEST' | 'LIVE';
  secretsTableName: string | undefined;
  kmsKeyArn: string | undefined;
  mailerFunctionName: string | undefined;
  doctorLinkMs: number;
  revealDelayMs: number;
  emailSender: string | undefined;
  emailRecipients: string[];
  emailTransport: RawConfig['EMAIL_TRANSPORT'];
  gmailAppPasswordParameter: string | undefined;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const c = parsed.data;
  return {
    environment: c.ENVIRONMENT,
    eventId: c.EVENT_ID,
    eventName: c.EVENT_NAME,
    repository: c.REPOSITORY,
    tableName: c.TABLE_NAME,
    dynamoEndpoint: c.DYNAMODB_ENDPOINT,
    region: c.AWS_REGION,
    adminPasswordHash: c.ADMIN_PASSWORD_HASH,
    adminPasswordHashParameter: c.ADMIN_PASSWORD_HASH_PARAMETER,
    adminSessionMs: c.ADMIN_SESSION_HOURS * 60 * 60 * 1000,
    joinUrl: c.PUBLIC_APP_URL ? `${c.PUBLIC_APP_URL.replace(/\/$/, '')}/party` : '',
    devRoutes: c.DEV_ROUTES === 'true',
    logLevel: c.LOG_LEVEL,
    appUrl: c.PUBLIC_APP_URL ? c.PUBLIC_APP_URL.replace(/\/$/, '') : '',
    revealMode: c.REVEAL_MODE ?? (c.ENVIRONMENT === 'prod' ? 'LIVE' : 'TEST'),
    secretsTableName: c.SECRETS_TABLE_NAME,
    kmsKeyArn: c.KMS_KEY_ARN,
    mailerFunctionName: c.MAILER_FUNCTION_NAME,
    doctorLinkMs: c.DOCTOR_LINK_HOURS * 60 * 60 * 1000,
    revealDelayMs: c.REVEAL_DELAY_SECONDS * 1000,
    emailSender: c.EMAIL_SENDER,
    emailRecipients: (c.EMAIL_RECIPIENTS ?? '').split(',').map((r) => r.trim()).filter(Boolean),
    emailTransport: c.EMAIL_TRANSPORT,
    gmailAppPasswordParameter: c.GMAIL_APP_PASSWORD_PARAMETER,
  };
}
