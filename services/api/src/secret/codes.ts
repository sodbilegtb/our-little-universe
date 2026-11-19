import { randomInt } from 'node:crypto';
import { REVEAL_CODE_ALPHABET } from '@olu/shared';
import { sha256 } from '../security/tokens';

/*
 * Reveal codes and doctor links. Only hashes are ever stored for lookup:
 * the plaintext code exists in memory while it is sealed and when the mailer
 * sends it, and the doctor token only in the link itself.
 */

const CODE_LENGTH = 12;

/** A random code like R7KM-92PX-L4QT: 12 characters from 31, about 59 bits. No meaning, no prefix. */
export function generateRevealCode(pick: (max: number) => number = randomInt): string {
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) raw += REVEAL_CODE_ALPHABET[pick(REVEAL_CODE_ALPHABET.length)];
  return group(raw);
}

/** Accepts any case, spaces and dashes; returns the canonical form, or null if it can't be a code. */
export function normalizeRevealCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const char of raw) if (!REVEAL_CODE_ALPHABET.includes(char)) return null;
  return group(raw);
}

function group(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/**
 * Lookup key for a code. Bound to the environment and event, so a code from a
 * test event or another environment can't even be found, let alone match.
 */
export function revealCodeHash(scope: { environment: string; eventId: string }, code: string): string {
  return sha256(`olu/reveal-code/v1|${scope.environment}|${scope.eventId}|${code}`);
}

export function doctorTokenHash(token: string): string {
  return sha256(`olu/doctor-link/v1|${token}`);
}

/** One sealed answer per link: the id is derived from the link, so retries land on the same record. */
export function selectionIdFor(linkId: string): string {
  return `sel_${sha256(`olu/selection/v1|${linkId}`).slice(0, 32)}`;
}
