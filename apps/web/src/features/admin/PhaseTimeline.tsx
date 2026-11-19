import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { EVENT_PHASES, PHASE_LABELS, phaseIndex, type EventPhase } from '@olu/shared';
import { cn } from '@/lib/cn';

/** The evening as a sequence. Each phase is done, live, or still to come. */
export function PhaseTimeline({ phase }: { phase: EventPhase }) {
  const current = phaseIndex(phase);
  return (
    <ol className="relative flex flex-col gap-1" aria-label="Event phases">
      {EVENT_PHASES.map((item, index) => {
        const done = index < current;
        const live = index === current;
        return (
          <li key={item} className="relative flex items-center gap-4 rounded-2xl px-3 py-2.5" aria-current={live ? 'step' : undefined}>
            {live && (
              <motion.span
                layoutId="phase-live"
                className="absolute inset-0 rounded-2xl border border-champagne/30 bg-champagne/[0.08]"
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <span
              className={cn(
                'relative grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                done && 'border-sage/50 bg-sage/15 text-sage',
                live && 'border-champagne bg-champagne text-night',
                !done && !live && 'border-ivory/15 text-mist',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={cn('relative text-[0.98rem]', live ? 'text-ivory' : done ? 'text-ivory-dim' : 'text-mist')}>
              {PHASE_LABELS[item]}
            </span>
            {live && <span className="relative ml-auto h-2 w-2 animate-twinkle rounded-full bg-champagne" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
