import { describe, expect, it, vi } from 'vitest';
import { buildCodeEmail } from './codeEmail';
import { GmailTransport, ssmAppPassword, type SmtpFactory } from './gmail';

const APP_PASSWORD = 'abcd efgh ijkl mnop'; // how Google shows it
const email = { ...buildCodeEmail({ code: 'R7KM-92PX-L4QT', mode: 'TEST', eventName: 'Test', appUrl: 'https://x.example' }) };
const message = { ...email, from: 'sender@gmail.com', to: ['parent@gmail.com'] };

function ssm(value: string | undefined) {
  return { send: vi.fn(async () => ({ Parameter: { Value: value } })) };
}

describe('Gmail transport', () => {
  it('signs in to smtp.gmail.com as the sender and sends the code email', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<abc@gmail.com>' }));
    const factory = vi.fn<SmtpFactory>(() => ({ sendMail }));
    const reader = ssm(APP_PASSWORD);
    const transport = new GmailTransport(ssmAppPassword('/olu/dev/gmail-app-password', reader), factory);

    expect(await transport.send(message)).toEqual({ messageId: '<abc@gmail.com>' });
    await transport.send(message);

    expect(factory).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'sender@gmail.com', pass: 'abcdefghijklmnop' },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'sender@gmail.com',
      to: ['parent@gmail.com'],
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    expect(reader.send).toHaveBeenCalledTimes(2); // read for each email: a new password applies at once
  });

  it('refuses a parameter that is not an app password, before connecting', async () => {
    const factory = vi.fn<SmtpFactory>();
    const transport = new GmailTransport(ssmAppPassword('/p', ssm('my-normal-password-123')), factory);
    await expect(transport.send(message)).rejects.toMatchObject({ name: 'GmailAppPasswordInvalid' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('reports a refusal by its SMTP code only, never the server reply or the password', async () => {
    const refusal = Object.assign(new Error('535-5.7.8 Username and Password not accepted abcdefghijklmnop'), { code: 'EAUTH' });
    const transport = new GmailTransport(ssmAppPassword('/p', ssm(APP_PASSWORD)), () => ({
      sendMail: async () => {
        throw refusal;
      },
    }));
    const error = await transport.send(message).catch((e: Error) => e);
    expect(error).toMatchObject({ name: 'SmtpEAUTH' });
    expect(String((error as Error).message)).not.toMatch(/abcdefghijklmnop|535/);
  });
});
