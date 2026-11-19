import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'champagne' | 'sage' | 'lavender' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'border-ivory/15 text-ivory-dim',
  champagne: 'border-champagne/40 text-champagne-soft bg-champagne/10',
  sage: 'border-sage/40 text-sage bg-sage/10',
  lavender: 'border-lavender/40 text-lavender bg-lavender/10',
  danger: 'border-danger/40 text-danger bg-danger/10',
};

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.8rem] font-medium leading-none',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
