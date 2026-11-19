import { REVEAL_CODE_ALPHABET, type DoctorChoice } from '@olu/shared';

/*
 * The browser preview's stand-in for the secrets table, KMS and the mailer.
 * Always TEST mode: in the preview you choose the "doctor's" answer yourself.
 * It's kept apart from the event state (its own storage key), so the views
 * built from the state stay independent of the answer, as on the server.
 */

const SECRET_KEY = 'olu.mock.secret.v1';

export interface MockSelection {
  linkId: string;
  submissionId: string;
  choice: DoctorChoice;
  code: string;
  status: 'ACTIVE' | 'RETIRED';
}

export interface MockEmail {
  selectionId: string;
  subject: string;
  text: string;
}

interface MockSecret {
  /** token → link id. A real server stores only a hash; the preview has nothing to protect. */
  links: Record<string, { linkId: string; expiresAt: number }>;
  selections: Record<string, MockSelection>;
  outbox: MockEmail[];
}

export function loadSecret(): MockSecret {
  try {
    const raw = localStorage.getItem(SECRET_KEY);
    if (raw) return JSON.parse(raw) as MockSecret;
  } catch {
    // start fresh
  }
  return { links: {}, selections: {}, outbox: [] };
}

export function saveSecret(secret: MockSecret): void {
  localStorage.setItem(SECRET_KEY, JSON.stringify(secret));
}

export function clearSecret(): void {
  localStorage.removeItem(SECRET_KEY);
}

function randomIndex(max: number): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]! % max;
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomCode(): string {
  let raw = '';
  for (let i = 0; i < 12; i += 1) raw += REVEAL_CODE_ALPHABET[randomIndex(REVEAL_CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function randomChoice(): DoctorChoice {
  return randomIndex(2) === 0 ? 'BOY' : 'GIRL';
}

export function selectionIdFor(linkId: string): string {
  return `sel_${linkId}`;
}

/** Same wording as the server's email (services/api/src/mail/codeEmail.ts), always TEST. */
export function testEmail(selectionId: string, code: string): MockEmail {
  return {
    selectionId,
    subject: '[TEST] OFFICIAL BABY REVEAL CODE',
    text: [
      'TEST: this code belongs to a rehearsal and can never unlock the real reveal.',
      '',
      'Your official Baby Reveal secret code is ready.',
      '',
      `    ${code}`,
      '',
      'When the reveal begins, enter the code on the host desk.',
    ].join('\n'),
  };
}
