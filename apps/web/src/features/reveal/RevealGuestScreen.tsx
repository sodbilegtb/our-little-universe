import { motion, useReducedMotion } from 'motion/react';
import { GuestTitle, Rise, Scene } from '@/components/layout/Scene';

/** Phones never show the result. They point everyone at the TV. */
export function RevealGuestScreen() {
  const reduce = useReducedMotion();
  return (
    <Scene className="justify-center py-10">
      <Rise className="mx-auto mb-12 flex h-40 w-40 items-center justify-center">
        <motion.div
          className="relative h-full w-full rounded-full border border-champagne/30"
          animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <span className="absolute inset-[30%] rounded-full bg-champagne/20 blur-xl" />
          <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ivory shadow-[0_0_24px_8px_rgba(216,189,139,0.55)]" />
        </motion.div>
      </Rise>
      <GuestTitle title="The moment we've all been waiting for..." lead="Look at the big screen!" />
    </Scene>
  );
}
