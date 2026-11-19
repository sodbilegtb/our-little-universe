import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { StarField } from './StarField';

export type SkyVariant = 'guest' | 'tv' | 'admin';

interface SkyBackdropProps {
  variant?: SkyVariant;
  /** 0 = normal sky, 1 = nearly dark. Used by the reveal build-up. */
  dim?: number;
  className?: string;
}

const SETTINGS: Record<SkyVariant, { density: number; drift: number; glow: number }> = {
  guest: { density: 2.2, drift: 3, glow: 1 },
  tv: { density: 1.5, drift: 5, glow: 1 },
  admin: { density: 0.7, drift: 1.5, glow: 0.45 },
};

/**
 * The shared night sky behind every surface. Layers, back to front:
 * plum gradient, two slow nebula glows, the star canvas, and a soft vignette.
 */
export function SkyBackdrop({ variant = 'guest', dim = 0, className }: SkyBackdropProps) {
  const settings = SETTINGS[variant];
  return (
    <div aria-hidden className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 0%, #3a3446 0%, #2a2532 38%, #1c1922 70%, #15131a 100%)',
        }}
      />
      <div
        className="absolute -top-[20%] left-[8%] h-[70vmax] w-[70vmax] rounded-full animate-breathe"
        style={{
          opacity: 0.5 * settings.glow,
          background: 'radial-gradient(closest-side, rgba(216,189,139,0.22), rgba(216,189,139,0) 70%)',
        }}
      />
      <div
        className="absolute -bottom-[30%] -right-[15%] h-[80vmax] w-[80vmax] rounded-full animate-breathe [animation-delay:-3s]"
        style={{
          opacity: 0.55 * settings.glow,
          background: 'radial-gradient(closest-side, rgba(185,177,200,0.2), rgba(185,177,200,0) 70%)',
        }}
      />
      <StarField className="absolute inset-0 h-full w-full" density={settings.density} drift={settings.drift} />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(130% 100% at 50% 40%, transparent 55%, rgba(12,10,16,0.55) 100%)' }}
      />
      <motion.div
        className="absolute inset-0 bg-night-deep"
        initial={false}
        animate={{ opacity: dim * 0.85 }}
        transition={{ duration: 2.4, ease: [0.65, 0, 0.35, 1] }}
      />
    </div>
  );
}
