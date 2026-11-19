import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import type { Logger } from '../app/logger';
import { deliverRevealCode, type MailerDeps } from './deliverCode';

export interface MailRequest {
  eventId: string;
  selectionId: string;
}

/** How the API asks for the code email. It passes ids only, never the code. */
export interface MailerTrigger {
  trigger(request: MailRequest): Promise<void>;
}

/** AWS: invokes the mailer Lambda asynchronously; Lambda retries failed sends itself. */
export class LambdaMailerTrigger implements MailerTrigger {
  constructor(
    private readonly client: Pick<LambdaClient, 'send'>,
    private readonly functionName: string,
  ) {}

  async trigger(request: MailRequest): Promise<void> {
    await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(request)),
      }),
    );
  }
}

/**
 * Local server and tests: runs the mailer in-process with the same retry
 * policy as Lambda's asynchronous invocation (one attempt plus two retries).
 */
export class InlineMailerTrigger implements MailerTrigger {
  constructor(
    private readonly deps: MailerDeps,
    private readonly logger: Logger,
    private readonly attempts = 3,
  ) {}

  async trigger(request: MailRequest): Promise<void> {
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        await deliverRevealCode(this.deps, request);
        return;
      } catch {
        if (attempt === this.attempts) this.logger.error('reveal code email gave up', { selectionId: request.selectionId });
      }
    }
  }
}
