import { motion } from 'motion/react';
import type { TvView } from '@olu/shared';
import { MoonMark } from '@/components/brand/MoonMark';
import { riseIn } from '@/lib/motion';
import { TvScene } from './TvChrome';

export function TvFinished({ view }: { view: TvView }) {
  return (
    <TvScene className="flex flex-col items-center justify-center text-center">
      <motion.div variants={riseIn}>
        <MoonMark className="h-[120px] w-[120px]" halo />
      </motion.div>
      <motion.h1 variants={riseIn} className="type-display mt-16 max-w-[16ch] text-[124px] text-glow">
        Thank you for being part of our little universe
      </motion.h1>
      <motion.p variants={riseIn} className="mt-12 text-[34px] text-ivory-dim">
        {view.guestCount} guests and {view.messages.stars.length} stars made tonight shine.
      </motion.p>
    </TvScene>
  );
}
