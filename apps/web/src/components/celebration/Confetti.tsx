import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { mulberry32 } from '@/lib/random';

/** Neutral by default. Pink and blue are passed in only after the reveal. */
const NEUTRAL = ['#D8BD8B', '#E9D8B6', '#FAF7F0', '#A9B7A0', '#B9B1C8'];

interface ConfettiProps {
  count?: number;
  /** Height of the fall in px. */
  fall?: number;
  seed?: number;
  colors?: readonly string[];
  /** Seconds over which the pieces start falling. */
  spread?: number;
}

/** Subtle falling paper flakes (the quiz winner, the reveal). Plays once. */
export function Confetti({ count = 70, fall = 1100, seed = 3, colors = NEUTRAL, spread = 1.8 }: ConfettiProps) {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => {
    const rand = mulberry32(seed);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rand() * 100,
      width: 6 + rand() * 6,
      height: 10 + rand() * 8,
      color: colors[Math.floor(rand() * colors.length)] ?? '#D8BD8B',
      delay: rand() * spread,
      duration: 4 + rand() * 3,
      sway: (rand() - 0.5) * 160,
      spin: (rand() - 0.5) * 720,
    }));
  }, [count, seed, colors, spread]);

  if (reduce) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0 rounded-[2px]"
          style={{ left: `${p.left}%`, width: p.width, height: p.height, background: p.color, opacity: 0.85 }}
          initial={{ y: -40, x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: fall, x: p.sway, rotate: p.spin, opacity: [0, 0.9, 0.9, 0] }}
          transition={{ duration: p.duration, delay: p.delay, ease: [0.25, 0.1, 0.35, 1] }}
        />
      ))}
    </div>
  );
}
