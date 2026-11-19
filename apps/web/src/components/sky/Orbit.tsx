import { motion, useReducedMotion } from 'motion/react';
import { MoonMark } from '@/components/brand/MoonMark';
import { cn } from '@/lib/cn';

/** The moon at rest, with two faint orbits and a travelling star. Used while guests wait. */
export function Orbit({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn('relative aspect-square', className)} aria-hidden>
      <div className="absolute inset-0 rounded-full border border-ivory/[0.07]" />
      <div className="absolute inset-[16%] rounded-full border border-ivory/[0.1]" />
      <motion.div
        className="absolute inset-0"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 38, repeat: Infinity, ease: 'linear' }}
      >
        <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-champagne-soft shadow-[0_0_14px_4px_rgba(216,189,139,0.55)]" />
      </motion.div>
      <motion.div
        className="absolute inset-[16%]"
        animate={reduce ? undefined : { rotate: -360 }}
        transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
      >
        <span className="absolute bottom-[6%] right-[14%] h-1 w-1 rounded-full bg-lavender shadow-[0_0_10px_3px_rgba(185,177,200,0.5)]" />
      </motion.div>
      <div className="absolute inset-[34%]">
        <MoonMark className="h-full w-full" halo />
      </div>
    </div>
  );
}
