import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { serverNow } from '@/services/sync/serverClock';

/** Remaining whole seconds until an ISO deadline on the server clock, ticking a few times per second. */
export function useSecondsLeft(deadline: string | null): number | null {
  const compute = () => (deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - serverNow()) / 1000)) : null);
  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    setSeconds(compute());
    if (!deadline) return;
    const timer = window.setInterval(() => setSeconds(compute()), 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  return seconds;
}

interface CountdownLineProps {
  opensAt: string | null;
  closesAt: string | null;
  className?: string;
  tone?: 'champagne' | 'ivory';
}

/**
 * A single line that drains from full to empty. Animated once by the browser
 * from the true remaining time, so it never re-renders per frame.
 */
export function CountdownLine({ opensAt, closesAt, className, tone = 'champagne' }: CountdownLineProps) {
  const reduce = useReducedMotion();
  if (!opensAt || !closesAt) return null;
  const total = Date.parse(closesAt) - Date.parse(opensAt);
  const remaining = Math.max(0, Date.parse(closesAt) - serverNow());
  const startFraction = total > 0 ? remaining / total : 0;

  return (
    <div className={cn('h-[3px] w-full overflow-hidden rounded-full bg-ivory/10', className)} aria-hidden>
      <motion.div
        key={closesAt}
        className={cn('h-full origin-left rounded-full', tone === 'champagne' ? 'bg-champagne' : 'bg-ivory')}
        style={{ boxShadow: '0 0 12px rgba(216,189,139,0.7)' }}
        initial={{ scaleX: startFraction }}
        animate={{ scaleX: 0 }}
        transition={{ duration: reduce ? 0 : remaining / 1000, ease: 'linear' }}
      />
    </div>
  );
}
