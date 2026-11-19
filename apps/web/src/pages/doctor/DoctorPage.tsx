import { useEffect, useState } from 'react';
import { DoctorFlow } from '@/features/doctor/DoctorFlow';

const TOKEN_KEY = 'olu.doctor.token';

/**
 * The token arrives in the URL fragment (/doctor#…), which browsers never send
 * to a server. It's moved into this tab's session storage and removed from the
 * address bar, so it doesn't linger in history or on screen.
 */
function takeToken(): string {
  const fromLink = window.location.hash.slice(1);
  try {
    if (fromLink) {
      sessionStorage.setItem(TOKEN_KEY, fromLink);
      window.history.replaceState(null, '', window.location.pathname);
      return fromLink;
    }
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return fromLink;
  }
}

/** The doctor's surface is deliberately light: ivory paper, like a sealed letter. */
export function DoctorPage() {
  const [token] = useState(takeToken);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', '#FAF7F0');
    return () => {
      if (previous) meta?.setAttribute('content', previous);
    };
  }, []);

  return (
    <div
      className="theme-paper min-h-dvh bg-paper text-ink [color-scheme:light]"
      style={{
        backgroundImage:
          'radial-gradient(120% 70% at 50% 0%, #fffdf8 0%, #faf7f0 45%, #f1ebdf 100%)',
      }}
    >
      <div className="pointer-events-none fixed inset-3 rounded-[1.75rem] border border-champagne-deep/25" aria-hidden />
      <DoctorFlow token={token} />
    </div>
  );
}
