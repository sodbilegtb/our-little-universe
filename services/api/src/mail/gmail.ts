import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import nodemailer from 'nodemailer';
import type { ParameterReader } from '../config/secrets';
import type { CodeEmail } from './codeEmail';
import type { MailTransport } from './transport';

/*
 * Sends through a Gmail account with an app password (SMTP, smtp.gmail.com).
 * Gmail to Gmail lands in the inbox without any domain or DNS setup.
 *
 * The app password lives in SSM Parameter Store as a SecureString. It is read
 * for each email (there are only a few), so a replaced password applies at
 * once, and it is never logged: failures surface as an error name such as
 * SmtpEAUTH.
 */

export type AppPasswordProvider = () => Promise<string>;

/** Reads the app password from SSM. Google shows it in groups of four; the spaces don't matter. */
export function ssmAppPassword(name: string, reader: ParameterReader = new SSMClient({})): AppPasswordProvider {
  return async () => {
    const result = await reader.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    const value = result.Parameter?.Value?.replace(/\s+/g, '') ?? '';
    if (!/^[a-z]{16}$/i.test(value)) {
      const error = new Error('The Gmail app password parameter is not a 16-letter app password');
      error.name = 'GmailAppPasswordInvalid';
      throw error;
    }
    return value;
  };
}

/** What the transport needs from nodemailer; tests pass a stub. */
export type SmtpFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => { sendMail(mail: { from: string; to: string[]; subject: string; text: string; html: string }): Promise<{ messageId?: string }> };

const defaultFactory: SmtpFactory = (options) => nodemailer.createTransport(options);

export class GmailTransport implements MailTransport {
  constructor(
    private readonly password: AppPasswordProvider,
    private readonly createSmtp: SmtpFactory = defaultFactory,
  ) {}

  async send(message: CodeEmail & { from: string; to: string[] }): Promise<{ messageId: string }> {
    const pass = await this.password();
    const smtp = this.createSmtp({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: message.from, pass } });
    try {
      const result = await smtp.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { messageId: result.messageId ?? '' };
    } catch (error) {
      // nodemailer puts the SMTP reply in the message; keep only a code for the logs.
      const code = (error as { code?: string }).code;
      const failure = new Error('Gmail refused the email');
      failure.name = code ? `Smtp${code}` : 'SmtpError';
      throw failure;
    }
  }
}
