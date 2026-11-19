import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { mulberry32 } from '@/lib/random';

interface RisingParticlesProps {
  /** Change this to fire a new burst. */
  burstKey: string | number;
  count?: number;
  /** Height the particles travel, in px. */
  rise?: number;
  className?: string;
}

/** A short burst of light motes drifting upward, used to confirm an action. */
export function RisingParticles({ burstKey, count = 18, rise = 220, className }: RisingParticlesProps) {
  const reduce = useReducedMotion();
  const particles = useMemo(() => {
    const rand = mulberry32(typeof burstKey === 'number' ? burstKey : burstKey.length * 97 + 13);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: (rand() - 0.5) * 160,
      drift: (rand() - 0.5) * 60,
      size: 2 + rand() * 4,
      delay: rand() * 0.35,
      duration: 1.4 + rand() * 1.2,
      champagne: rand() > 0.4,
    }));
  }, [burstKey, count]);

  if (reduce) return null;

  return (
    <div aria-hidden className={className ?? 'pointer-events-none absolute inset-0 overflow-visible'}>
      {particles.map((p) => (
        <motion.span
          key={`${burstKey}-${p.id}`}
          className="absolute bottom-1/3 left-1/2 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            background: p.champagne ? '#E9D8B6' : '#FAF7F0',
            boxShadow: `0 0 ${p.size * 3}px ${p.champagne ? 'rgba(216,189,139,0.9)' : 'rgba(250,247,240,0.8)'}`,
          }}
          initial={{ x: p.x, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: p.x + p.drift, y: -rise, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
          transition={{ duration: p.duration, delay: p.delay, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}
