import type { RevealMode } from '@olu/shared';
import type { Logger } from '../app/logger';
import type { MailerSecretStore } from '../secret/SecretStore';
import type { Opener } from '../secret/vault';
import { buildCodeEmail } from './codeEmail';
import type { MailTransport } from './transport';

export interface MailerDeps {
  store: MailerSecretStore;
  opener: Opener;
  transport: MailTransport;
  logger: Logger;
  now: () => number;
  config: {
    environment: string;
    eventId: string;
    eventName: string;
    appUrl: string;
    mode: RevealMode;
    sender: string | undefined;
    recipients: string[];
  };
}

export type DeliveryOutcome = 'SENT' | 'SKIPPED';

/**
 * Emails the reveal code for one sealed answer. It always sends the code that
 * was sealed with the answer, so a retry (Lambda's automatic retries, or the
 * host's "Send the code again") can only ever repeat the same code.
 *
 * Throws when sending fails, so the caller can retry.
 */
export async function deliverRevealCode(deps: MailerDeps, request: { eventId: string; selectionId: string }): Promise<DeliveryOutcome> {
  const { store, opener, transport, logger, config } = deps;
  const log = { selectionId: request.selectionId };
  if (request.eventId !== config.eventId) {
    logger.warn('reveal code email for another event ignored', log);
    return 'SKIPPED';
  }
  const sealed = await store.getSealedCode(request.eventId, request.selectionId);
  if (!sealed || sealed.status !== 'ACTIVE') {
    logger.warn('reveal code email skipped: answer not active', log);
    return 'SKIPPED';
  }
  if (!config.sender || config.recipients.length === 0) {
    await store.recordEmail(request.eventId, request.selectionId, { status: 'SKIPPED', at: deps.now() });
    logger.warn('reveal code email skipped: no sender or recipients configured', log);
    return 'SKIPPED';
  }

  const code = await opener.open('reveal-code', sealed.codeCiphertext, {
    environment: config.environment,
    eventId: request.eventId,
    selectionId: request.selectionId,
  });
  const message = buildCodeEmail({ code, mode: config.mode, eventName: config.eventName, appUrl: config.appUrl });
  try {
    const { messageId } = await transport.send({ ...message, from: config.sender, to: config.recipients });
    await store.recordEmail(request.eventId, request.selectionId, { status: 'SENT', at: deps.now(), messageId });
    logger.info('reveal code email sent', { ...log, recipients: config.recipients.length, messageId });
    return 'SENT';
  } catch (error) {
    const name = (error as Error).name || 'Error';
    await store.recordEmail(request.eventId, request.selectionId, { status: 'FAILED', at: deps.now(), error: name });
    logger.error('reveal code email failed', { ...log, error: name });
    throw error;
  }
}
