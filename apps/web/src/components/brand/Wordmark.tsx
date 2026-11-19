import { cn } from '@/lib/cn';
import { MoonMark } from './MoonMark';

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-ivory', className)}>
      <MoonMark className="h-[1.35em] w-[1.35em]" />
      <span className="type-display-italic text-[1.05em] tracking-[0.005em]">Our Little Universe</span>
    </span>
  );
}
