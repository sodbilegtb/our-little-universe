import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { CodeEmail } from './codeEmail';

export interface MailTransport {
  send(message: CodeEmail & { from: string; to: string[] }): Promise<{ messageId: string }>;
}

/** Amazon SES. No tags, no custom headers: nothing beyond the message itself. */
export class SesTransport implements MailTransport {
  constructor(private readonly client: Pick<SESv2Client, 'send'>) {}

  async send(message: CodeEmail & { from: string; to: string[] }): Promise<{ messageId: string }> {
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: message.from,
        Destination: { ToAddresses: message.to },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: message.text, Charset: 'UTF-8' }, Html: { Data: message.html, Charset: 'UTF-8' } },
          },
        },
      }),
    );
    return { messageId: result.MessageId ?? '' };
  }
}

/** Local server and tests: keeps messages in memory instead of sending them. */
export class OutboxTransport implements MailTransport {
  readonly sent: (CodeEmail & { from: string; to: string[]; messageId: string })[] = [];
  /** Tests: make the next n sends fail, to exercise retries. */
  failNext = 0;

  async send(message: CodeEmail & { from: string; to: string[] }): Promise<{ messageId: string }> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      const error = new Error('Simulated delivery failure');
      error.name = 'MessageRejected';
      throw error;
    }
    const messageId = `local-${this.sent.length + 1}`;
    this.sent.push({ ...message, messageId });
    return { messageId };
  }
}
