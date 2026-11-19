import { motion, useReducedMotion } from 'motion/react';

/** A champagne wax seal pressed onto the letter when the answer is confirmed. */
export function WaxSeal({ pressed }: { pressed: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="relative h-36 w-36"
      initial={reduce ? false : { scale: 1.9, opacity: 0, rotate: -18 }}
      animate={pressed ? { scale: 1, opacity: 1, rotate: -6 } : undefined}
      transition={{ type: 'spring', stiffness: 260, damping: 18, mass: 1.1 }}
      aria-hidden
    >
      <svg viewBox="0 0 120 120" className="h-full w-full drop-shadow-[0_10px_18px_rgba(120,90,40,0.35)]">
        <defs>
          <radialGradient id="wax" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#E9D3A6" />
            <stop offset="55%" stopColor="#C9A86E" />
            <stop offset="100%" stopColor="#9C7D45" />
          </radialGradient>
        </defs>
        <path
          d="M60 4c7 0 9 6 15 8s12-2 16 4 1 12 4 17 10 7 10 14-6 9-7 15 3 12-2 17-11 2-16 5-7 10-14 10-9-6-15-8-12 2-16-4-1-12-4-17-10-7-10-14 6-9 7-15-3-12 2-17 11-2 16-5S53 4 60 4Z"
          fill="url(#wax)"
        />
        <circle cx="60" cy="60" r="34" fill="none" stroke="#F3E6CB" strokeOpacity="0.45" strokeWidth="1.5" />
        <path d="M66.5 41.2A20 20 0 1 0 78 74.8 16.5 16.5 0 1 1 66.5 41.2Z" fill="#F3E6CB" fillOpacity="0.75" />
        <path d="M70 47l1.2 2.8 2.8 1.2-2.8 1.2L70 55l-1.2-2.8L66 51l2.8-1.2L70 47Z" fill="#FAF7F0" />
      </svg>
      {pressed && !reduce && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-champagne-deep/40"
          initial={{ scale: 0.9, opacity: 0.8 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.9, delay: 0.15, ease: 'easeOut' }}
        />
      )}
    </motion.div>
  );
}
