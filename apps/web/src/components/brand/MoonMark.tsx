import { cn } from '@/lib/cn';

interface MoonMarkProps {
  className?: string;
  /** Adds a slow breathing halo behind the moon. */
  halo?: boolean;
}

/** The project mark: a crescent cradling one small star. */
export function MoonMark({ className, halo = false }: MoonMarkProps) {
  return (
    <span className={cn('relative inline-block', className)} aria-hidden>
      {halo && (
        <span
          className="absolute inset-[-55%] rounded-full animate-breathe"
          style={{ background: 'radial-gradient(closest-side, rgba(216,189,139,0.35), rgba(216,189,139,0))' }}
        />
      )}
      <svg viewBox="0 0 48 48" className="relative h-full w-full" fill="none">
        <defs>
          <linearGradient id="moon-fill" x1="10" y1="6" x2="34" y2="44" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F3E6CB" />
            <stop offset="1" stopColor="#C9AA72" />
          </linearGradient>
        </defs>
        <path d="M30.5 7.2A18 18 0 1 0 41 37.6 15 15 0 1 1 30.5 7.2Z" fill="url(#moon-fill)" />
        <path
          d="M34 13.5l1.05 2.45 2.45 1.05-2.45 1.05L34 20.5l-1.05-2.45L30.5 17l2.45-1.05L34 13.5Z"
          fill="#FAF7F0"
        />
      </svg>
    </span>
  );
}
