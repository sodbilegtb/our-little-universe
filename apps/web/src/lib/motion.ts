import type { Transition, Variants } from 'motion/react';

/** Shared motion vocabulary so every surface moves with the same personality. */
export const ease = {
  drift: [0.22, 1, 0.36, 1] as const,
  settle: [0.16, 1, 0.3, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
};

export const spring = {
  gentle: { type: 'spring', stiffness: 140, damping: 22, mass: 1 } satisfies Transition,
  press: { type: 'spring', stiffness: 520, damping: 32 } satisfies Transition,
};

/** Scene change between phases: a soft dissolve with a breath of blur. */
export const sceneVariants: Variants = {
  initial: { opacity: 0, y: 14, filter: 'blur(8px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.9, ease: ease.drift, staggerChildren: 0.08, delayChildren: 0.1 },
  },
  exit: {
    opacity: 0,
    y: -10,
    filter: 'blur(6px)',
    transition: { duration: 0.45, ease: ease.inOut },
  },
};

export const riseIn: Variants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.8, ease: ease.drift } },
  exit: { opacity: 0, transition: { duration: 0.3 } },
};

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.8, ease: ease.drift } },
  exit: { opacity: 0, transition: { duration: 0.3 } },
};
