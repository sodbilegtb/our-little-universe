import type { RevealMode } from '@olu/shared';

/*
 * The reveal code email. It carries the code and nothing else about the
 * secret: no hint of the result in the subject, body, headers or tags. The
 * mailer that sends it can't read the doctor's answer at all (IAM and KMS).
 */

export const LIVE_SUBJECT = 'OFFICIAL BABY REVEAL CODE';

export interface CodeEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export function buildCodeEmail(input: { code: string; mode: RevealMode; eventName: string; appUrl: string }): CodeEmail {
  const test = input.mode === 'TEST';
  const subject = test ? `[TEST] ${LIVE_SUBJECT}` : LIVE_SUBJECT;
  const hostDesk = input.appUrl ? `${input.appUrl}/admin` : '';
  const testLine = 'TEST: this code belongs to a rehearsal and can never unlock the real reveal.';

  const text = [
    ...(test ? [testLine, ''] : []),
    'Your official Baby Reveal secret code is ready.',
    '',
    `    ${input.code}`,
    '',
    'Keep this email to yourself and don’t open the code before the party.',
    `When the reveal begins, enter the code on the host desk${hostDesk ? ` (${hostDesk})` : ''}.`,
    '',
    input.eventName,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:32px 16px;background:#302B3A;font-family:Georgia,'Times New Roman',serif;color:#FAF7F0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1C1922;border:1px solid #D8BD8B;border-radius:20px;">
<tr><td style="padding:36px 32px;text-align:center;">
${test ? `<p style="margin:0 0 20px;padding:8px 12px;border-radius:8px;background:#D8BD8B;color:#302B3A;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;">${escapeHtml(testLine)}</p>` : ''}
<p style="margin:0;font-size:15px;letter-spacing:1px;color:#D8BD8B;">${escapeHtml(input.eventName)}</p>
<h1 style="margin:16px 0 8px;font-size:24px;font-weight:normal;">Your official Baby Reveal secret code is ready.</h1>
<p style="margin:28px 0;font-family:'Courier New',monospace;font-size:30px;letter-spacing:6px;color:#FAF7F0;">${escapeHtml(input.code)}</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#B9B1C8;">Keep this email to yourself and don’t open the code before the party.<br>When the reveal begins, enter the code on the host desk${hostDesk ? `:<br><a href="${escapeHtml(hostDesk)}" style="color:#D8BD8B;">${escapeHtml(hostDesk)}</a>` : '.'}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
