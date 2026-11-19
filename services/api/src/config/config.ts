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
  };
}
