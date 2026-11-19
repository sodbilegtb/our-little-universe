import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A quiet section on the host desk: a heading, a hairline, then content. */
export function Panel({ title, aside, children, className }: PanelProps) {
  return (
    <section className={cn('rounded-[1.5rem] border border-ivory/[0.08] bg-night-deep/40 p-6', className)}>
      {(title || aside) && (
        <header className="mb-5 flex items-center justify-between gap-4">
          {title && <h2 className="text-[1.05rem] font-semibold text-ivory">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
