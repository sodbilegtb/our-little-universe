import { motion } from 'motion/react';
import type { TvView } from '@olu/shared';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { VOTE_OPTIONS } from '@/features/voting/VoteScreen';
import { riseIn } from '@/lib/motion';
import { JoinCorner, TvScene, TvWordmark } from './TvChrome';

const PILLAR_MAX = 560;

function percent(part: number, total: number) {
  return total === 0 ? 0 : (part / total) * 100;
}

/** Live guesses as two pillars of light. Both pillars look the same; only the labels differ. */
export function TvVoting({ view }: { view: TvView }) {
  const { tally, open } = view.voting;
  const values = { BOY: tally.boy, GIRL: tally.girl };

  return (
    <TvScene>
      <TvWordmark />
      <div className="mt-16 grid grid-cols-[760px_1fr] gap-[60px]">
        <div className="pt-6">
          <motion.h1 variants={riseIn} className="type-display text-[116px]">
            What's your guess?
          </motion.h1>
          <motion.p variants={riseIn} className="mt-10 text-[34px] text-ivory-dim">
            {open ? 'Vote on your phone. Results update live.' : 'Voting has closed.'}
          </motion.p>
          <motion.p variants={riseIn} className="mt-16 text-[30px] text-ivory/60">
            <AnimatedNumber value={tally.total} className="type-numeral text-[88px] text-ivory" />
            <span className="ml-4">{tally.total === 1 ? 'vote' : 'votes'} so far</span>
          </motion.p>
        </div>

        <motion.div variants={riseIn} className="flex items-end justify-center gap-[120px] pb-[40px]">
          {VOTE_OPTIONS.map(({ choice, label }) => {
            const share = percent(values[choice], tally.total);
            const height = 24 + (PILLAR_MAX - 24) * (share / 100);
            return (
              <div key={choice} className="flex w-[300px] flex-col items-center">
                <p className="type-numeral mb-6 text-[110px] leading-none text-ivory">
                  <AnimatedNumber value={share} format={(v) => `${Math.round(v)}`} />
                  <span className="text-[56px] text-ivory/60">%</span>
                </p>
                <div className="relative flex h-[560px] w-full items-end justify-center">
                  <div className="absolute inset-x-[30%] bottom-0 top-0 rounded-full bg-ivory/[0.04]" />
                  <motion.div
                    className="relative w-[40%] rounded-full"
                    style={{
                      background: 'linear-gradient(180deg, #F3E6CB 0%, rgba(216,189,139,0.75) 35%, rgba(216,189,139,0.08) 100%)',
                      boxShadow: '0 0 80px -6px rgba(216,189,139,0.6)',
                    }}
                    initial={{ height: 24 }}
                    animate={{ height }}
                    transition={{ type: 'spring', stiffness: 60, damping: 18 }}
                  >
                    <span className="absolute -top-3 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full bg-ivory shadow-[0_0_40px_14px_rgba(216,189,139,0.55)]" />
                  </motion.div>
                </div>
                <p className="type-display mt-8 text-[64px]">{label}</p>
              </div>
            );
          })}
        </motion.div>
      </div>
      {open && <JoinCorner url={view.joinUrl} side="left" />}
    </TvScene>
  );
}
