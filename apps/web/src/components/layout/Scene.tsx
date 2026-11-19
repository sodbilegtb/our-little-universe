import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { riseIn, sceneVariants } from '@/lib/motion';

/** A full guest scene. Children with `riseIn` variants enter in a gentle stagger. */
export function Scene({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.section
      variants={sceneVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn('flex flex-1 flex-col', className)}
    >
      {children}
    </motion.section>
  );
}

export function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={riseIn} className={className}>
      {children}
    </motion.div>
  );
}

interface GuestTitleProps {
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
  align?: 'center' | 'left';
}

export function GuestTitle({ title, lead, className, align = 'center' }: GuestTitleProps) {
  return (
    <Rise className={cn(align === 'center' ? 'text-center' : 'text-left', className)}>
      <h1 className="type-display text-[2.6rem] text-ivory">{title}</h1>
      {lead && <p className="mx-auto mt-4 max-w-[30ch] text-[1.08rem] text-ivory-dim">{lead}</p>}
    </Rise>
  );
}
