import { motion } from 'motion/react';
import type { TvView } from '@olu/shared';
import { JoinQr, prettyUrl, resolveJoinUrl } from '@/components/ui/JoinQr';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { MoonMark } from '@/components/brand/MoonMark';
import { riseIn } from '@/lib/motion';
import { TvScene } from './TvChrome';

export function TvLobby({ view }: { view: TvView }) {
  const joinUrl = resolveJoinUrl(view.joinUrl);
  return (
    <TvScene className="grid grid-cols-[1fr_auto] items-center gap-[120px]">
      <div>
        <motion.div variants={riseIn} className="mb-14 flex items-center gap-5">
          <MoonMark className="h-[64px] w-[64px]" halo />
          <span className="type-display-italic text-[44px] text-champagne-soft">Our Little Universe</span>
        </motion.div>
        <motion.h1 variants={riseIn} className="type-display max-w-[11ch] text-[164px] text-ivory text-glow">
          Welcome to Our Baby Reveal
        </motion.h1>
        <motion.p variants={riseIn} className="mt-16 flex items-center gap-4 text-[30px] text-ivory-dim">
          <span className="h-2.5 w-2.5 animate-twinkle rounded-full bg-champagne" aria-hidden />
          <span>
            <AnimatedNumber value={view.guestCount} className="tabular-nums text-ivory" />{' '}
            {view.guestCount === 1 ? 'guest has' : 'guests have'} joined
          </span>
        </motion.p>
      </div>

      <motion.div variants={riseIn} className="flex flex-col items-center">
        <JoinQr url={joinUrl} size={440} />
        <p className="type-display mt-12 text-[46px] text-ivory">Scan to join our celebration</p>
        <p className="mt-3 text-[26px] text-ivory/50">{prettyUrl(joinUrl)}</p>
      </motion.div>
    </TvScene>
  );
}
