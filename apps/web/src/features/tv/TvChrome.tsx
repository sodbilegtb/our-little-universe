import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Wordmark } from '@/components/brand/Wordmark';
import { JoinQr, prettyUrl, resolveJoinUrl } from '@/components/ui/JoinQr';
import { cn } from '@/lib/cn';
import { sceneVariants } from '@/lib/motion';

/** A TV scene filling the 1920×1080 stage, with consistent safe margins. */
export function TvScene({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.section
      variants={sceneVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn('absolute inset-0 px-[120px] py-[96px]', className)}
    >
      {children}
    </motion.section>
  );
}

export function TvWordmark({ className }: { className?: string }) {
  return <Wordmark className={cn('text-[30px] text-ivory/85', className)} />;
}

/** Small QR for late arrivals, tucked in the corner during activities. */
export function JoinCorner({ url: fromServer, side = 'right' }: { url: string; side?: 'left' | 'right' }) {
  const url = resolveJoinUrl(fromServer);
  return (
    <div
      className={cn(
        'absolute bottom-[72px] flex items-center gap-6',
        side === 'right' ? 'right-[96px]' : 'left-[120px] flex-row-reverse',
      )}
    >
      <div className={cn('text-[24px] leading-snug text-ivory-dim', side === 'right' ? 'text-right' : 'text-left')}>
        <p>Just arrived?</p>
        <p className="text-ivory/50">{prettyUrl(url)}</p>
      </div>
      <JoinQr url={url} size={132} className="rounded-[1.4rem]" />
    </div>
  );
}
