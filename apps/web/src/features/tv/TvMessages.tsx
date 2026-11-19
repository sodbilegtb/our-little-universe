import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { TvView } from '@olu/shared';
import { Constellation } from '@/components/constellation/Constellation';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { TV_HEIGHT, TV_WIDTH } from '@/components/layout/TvStage';
import { ease, riseIn } from '@/lib/motion';
import { JoinCorner, TvScene } from './TvChrome';

const FEATURE_INTERVAL_MS = 9000;

/** The growing constellation. Message text appears only once the host approves it. */
export function TvMessages({ view }: { view: TvView }) {
  const { stars, featured, open } = view.messages;
  const [featureIndex, setFeatureIndex] = useState(0);

  useEffect(() => {
    if (featured.length < 2) return;
    const timer = window.setInterval(() => setFeatureIndex((i) => i + 1), FEATURE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [featured.length]);

  const current = featured.length > 0 ? featured[featureIndex % featured.length] : undefined;

  return (
    <TvScene className="p-0">
      <div className="absolute inset-0">
        <Constellation stars={stars} width={TV_WIDTH} height={TV_HEIGHT} className="h-full w-full" />
      </div>

      <div className="absolute left-[120px] top-[96px] max-w-[760px]">
        <motion.h1 variants={riseIn} className="type-display text-[92px]">
          A Message for Our Little One
        </motion.h1>
        <motion.p variants={riseIn} className="mt-8 text-[32px] text-ivory-dim">
          {open ? 'Write yours on your phone. Every message becomes a star.' : 'Every message is now a star.'}
        </motion.p>
        <motion.p variants={riseIn} className="mt-10 text-[30px] text-ivory/60">
          <AnimatedNumber value={stars.length} className="type-numeral text-[80px] text-champagne-soft" />
          <span className="ml-4">{stars.length === 1 ? 'star' : 'stars'} in our sky</span>
        </motion.p>
      </div>

      <div className="absolute bottom-[96px] left-[120px] w-[1000px]">
        <AnimatePresence mode="wait">
          {current && (
            <motion.figure
              key={current.id}
              initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
              transition={{ duration: 1.1, ease: ease.drift }}
            >
              <blockquote className="type-display-italic line-clamp-3 text-[46px] leading-[1.3] text-ivory">
                “{current.text}”
              </blockquote>
              <figcaption className="mt-5 text-[28px] text-champagne-soft">{current.displayName}</figcaption>
            </motion.figure>
          )}
        </AnimatePresence>
      </div>

      {open && <JoinCorner url={view.joinUrl} />}
    </TvScene>
  );
}
