import type { ReactNode } from 'react';
import { SkyBackdrop } from '@/components/sky/SkyBackdrop';
import { Wordmark } from '@/components/brand/Wordmark';
import { ConnectionNotice } from '@/components/ui/ConnectionNotice';
import type { ConnectionStatus } from '@/services/sync/revisionPoller';

interface GuestShellProps {
  children: ReactNode;
  /** Shown at the top right once the guest has joined. */
  guestName?: string | null;
  dim?: number;
  status?: ConnectionStatus;
}

/**
 * Mobile-first frame for the guest experience: a single centred column,
 * safe-area aware, with actions pinned within thumb reach.
 */
export function GuestShell({ children, guestName, dim, status = 'live' }: GuestShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <SkyBackdrop variant="guest" dim={dim} />
      <ConnectionNotice status={status} />
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-6 pt-[max(1.25rem,env(safe-area-inset-top))] text-[0.95rem]">
        <Wordmark />
        {guestName && (
          <span className="max-w-[9rem] truncate rounded-full border border-ivory/12 px-3 py-1 text-sm text-ivory-dim">
            {guestName}
          </span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
