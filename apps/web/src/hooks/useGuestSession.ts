import { useCallback, useState } from 'react';
import type { GuestSession } from '@olu/shared';

/**
 * Remembers the guest on this device so a refresh drops them straight back in.
 * `?slot=2` keeps a separate session, which lets one browser play several guests
 * during local testing. In production the token becomes an HttpOnly cookie.
 */
function storageKey(): string {
  const slot = new URLSearchParams(window.location.search).get('slot');
  return slot ? `olu.guest.session.${slot}` : 'olu.guest.session';
}

function read(): GuestSession | null {
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? (JSON.parse(raw) as GuestSession) : null;
  } catch {
    return null;
  }
}

export function useGuestSession() {
  const [session, setSession] = useState<GuestSession | null>(read);

  const save = useCallback((next: GuestSession) => {
    localStorage.setItem(storageKey(), JSON.stringify(next));
    setSession(next);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(storageKey());
    setSession(null);
  }, []);

  return { session, save, clear };
}
