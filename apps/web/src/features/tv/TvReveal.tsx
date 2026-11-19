import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { mulberry32 } from '@/lib/random';
import { ease, riseIn } from '@/lib/motion';
import { TvScene } from './TvChrome';

/**
 * The waiting moment before the host enters the code. Motes circle slowly
 * toward the centre. Once the code is accepted, TvRevealSequence takes over.
 */
export function TvRevealWaiting() {
  const reduce = useReducedMotion();
  const motes = useMemo(() => {
    const rand = mulberry32(42);
    return Array.from({ length: 46 }, (_, i) => ({
      id: i,
      radius: 260 + rand() * 520,
      angle: rand() * 360,
      size: 2 + rand() * 3.5,
      duration: 50 + rand() * 60,
      direction: rand() > 0.5 ? 1 : -1,
    }));
  }, []);

  return (
    <TvScene className="flex flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
        <div
          className="absolute h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full animate-breathe"
          style={{ background: 'radial-gradient(closest-side, rgba(216,189,139,0.16), rgba(216,189,139,0))' }}
        />
        {motes.map((m) => (
          <motion.div
            key={m.id}
            className="absolute left-0 top-0"
            initial={{ rotate: m.angle }}
            animate={reduce ? undefined : { rotate: m.angle + 360 * m.direction }}
            transition={{ duration: m.duration, repeat: Infinity, ease: 'linear' }}
          >
            <span
              className="absolute rounded-full bg-champagne-soft"
              style={{
                left: m.radius,
                width: m.size,
                height: m.size,
                boxShadow: `0 0 ${m.size * 4}px rgba(216,189,139,0.8)`,
                opacity: 0.35 + (1 - m.radius / 780) * 0.6,
              }}
            />
          </motion.div>
        ))}
      </div>

      <motion.h1
        variants={riseIn}
        className="type-display relative text-[150px] tracking-[0.06em] text-ivory text-glow"
      >
        THE FINAL SECRET
      </motion.h1>
      <motion.p
        className="type-display-italic relative mt-10 text-[54px] text-champagne-soft"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 1.4, duration: 1.6, ease: ease.drift } }}
      >
        One little secret changes everything.
      </motion.p>
    </TvScene>
  );
}
