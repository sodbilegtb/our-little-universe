import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WifiOff } from 'lucide-react';
import type { ConnectionStatus } from '@/services/sync/revisionPoller';
import { cn } from '@/lib/cn';

interface ConnectionNoticeProps {
  status: ConnectionStatus;
  variant?: 'guest' | 'tv' | 'admin';
}

const GRACE_MS = 1200;

/**
 * A quiet notice that appears only when the connection has been down for a
 * moment, so a single slow request never makes the screen flicker.
 */
export function ConnectionNotice({ status, variant = 'guest' }: ConnectionNoticeProps) {
  const troubled = status === 'reconnecting' || status === 'offline';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!troubled) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [troubled]);

  const text = status === 'offline' ? 'You’re offline. We’ll reconnect on our own.' : 'Reconnecting…';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: variant === 'tv' ? 12 : -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className={cn(
            'veil pointer-events-none z-40 flex items-center gap-2.5 rounded-full text-ivory-dim',
            variant === 'guest' && 'fixed left-1/2 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] -translate-x-1/2 px-4 py-2 text-sm',
            variant === 'tv' && 'absolute bottom-[40px] left-[120px] px-6 py-3 text-[22px]',
            variant === 'admin' && 'px-3 py-1.5 text-sm',
          )}
        >
          {status === 'offline' ? (
            <WifiOff className={variant === 'tv' ? 'h-6 w-6' : 'h-4 w-4'} aria-hidden />
          ) : (
            <span className="h-2 w-2 animate-twinkle rounded-full bg-champagne" aria-hidden />
          )}
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
