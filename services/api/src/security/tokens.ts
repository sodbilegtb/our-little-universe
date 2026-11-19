import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Ids } from '@olu/event-core';

/** URL-safe random secret with `bytes` of entropy (32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Server-side identifiers. Message ids are derived, so a resent draft maps to the same key. */
export const serverIds: Ids = {
  guestId: () => `gst_${randomBytes(12).toString('hex')}`,
  sessionToken: () => randomToken(32),
  messageId: (guestId, clientMessageId) => `msg_${sha256(`${guestId}:${clientMessageId}`).slice(0, 32)}`,
};

/**
 * Guests send `Authorization: Bearer <guestId>.<sessionToken>`.
 * Returns null for anything malformed.
 */
export function parseGuestCredential(header: string | undefined): { guestId: string; sessionToken: string } | null {
  const match = /^Bearer (gst_[a-f0-9]{24})\.([A-Za-z0-9_-]{20,128})$/.exec(header ?? '');
  if (!match?.[1] || !match[2]) return null;
  return { guestId: match[1], sessionToken: match[2] };
}

export function parseBearer(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(header ?? '');
  return match?.[1] ?? null;
}
