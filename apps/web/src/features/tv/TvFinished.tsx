import { motion } from 'motion/react';
import type { TvView } from '@olu/shared';
import { MoonMark } from '@/components/brand/MoonMark';
import { REVEAL_PALETTES } from '@/features/reveal/palette';
import { useRevealResult } from '@/features/reveal/useReveal';
import { ease, riseIn } from '@/lib/motion';
import { TvScene } from './TvChrome';

export function TvFinished({ view }: { view: TvView }) {
  // The secret is out by now; the result is asked for only if the reveal really happened.
  const revealAt = view.reveal.status === 'REVEALED' && view.reveal.revealAt ? Date.parse(view.reveal.revealAt) : null;
  const result = useRevealResult(revealAt);
  const palette = result ? REVEAL_PALETTES[result.result] : null;

  return (
    <TvScene className="flex flex-col items-center justify-center text-center">
      {palette && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(70% 60% at 50% 30%, ${palette.wash}, transparent 70%)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.8, transition: { duration: 2, ease: ease.drift } }}
        />
      )}
      <motion.div variants={riseIn} className="relative">
        <MoonMark className="h-[120px] w-[120px]" halo />
      </motion.div>
      {palette && (
        <motion.p
          className="type-display-italic relative mt-12 text-[72px]"
          style={{ color: palette.accent, textShadow: `0 0 40px ${palette.glow}` }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 1.2, ease: ease.drift } }}
          data-testid="finished-result"
        >
          {palette.short}
        </motion.p>
      )}
      <motion.h1 variants={riseIn} className="type-display relative mt-12 max-w-[16ch] text-[112px] text-glow">
        Thank you for being part of our little universe
      </motion.h1>
      <motion.p variants={riseIn} className="relative mt-12 text-[34px] text-ivory-dim">
        {view.guestCount} guests and {view.messages.stars.length} stars made tonight shine.
      </motion.p>
    </TvScene>
  );
}
