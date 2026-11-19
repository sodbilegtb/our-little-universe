import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { mulberry32 } from '@/lib/random';

/** Neutral palette only. Pink and blue are reserved for after the reveal. */
const COLORS = ['#D8BD8B', '#E9D8B6', '#FAF7F0', '#A9B7A0', '#B9B1C8'];

interface ConfettiProps {
  count?: number;
  /** Height of the fall in px. */
  fall?: number;
  seed?: number;
}

/** Subtle falling paper flakes for the quiz winner. Plays once. */
export function Confetti({ count = 70, fall = 1100, seed = 3 }: ConfettiProps) {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => {
    const rand = mulberry32(seed);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rand() * 100,
      width: 6 + rand() * 6,
      height: 10 + rand() * 8,
      color: COLORS[Math.floor(rand() * COLORS.length)] ?? '#D8BD8B',
      delay: rand() * 1.8,
      duration: 4 + rand() * 3,
      sway: (rand() - 0.5) * 160,
      spin: (rand() - 0.5) * 720,
    }));
  }, [count, seed]);

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
