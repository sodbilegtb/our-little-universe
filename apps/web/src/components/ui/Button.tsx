import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

type Variant = 'primary' | 'quiet' | 'ghost' | 'ghostDanger' | 'danger' | 'ink' | 'paperGhost';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
  align?: 'center' | 'start';
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-champagne text-night shadow-[0_0_0_1px_rgba(255,255,255,0.18)_inset,0_10px_40px_-12px_rgba(216,189,139,0.65)] hover:bg-champagne-soft',
  quiet: 'border border-ivory/20 text-ivory hover:border-ivory/40 hover:bg-ivory/[0.04]',
  ghost: 'text-ivory/80 hover:text-ivory hover:bg-ivory/[0.05]',
  ghostDanger: 'text-danger/80 hover:text-danger hover:bg-danger/10',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  ink: 'bg-ink text-paper hover:bg-plum shadow-[0_10px_30px_-14px_rgba(42,37,49,0.8)]',
  paperGhost: 'text-ink/75 hover:text-ink hover:bg-ink/[0.05]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[0.95rem] gap-2',
  lg: 'h-14 px-7 text-[1.05rem] gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, block, align = 'center', className, children, disabled, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      ref={ref}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={spring.press}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex select-none items-center rounded-full font-medium tracking-[0.01em]',
        align === 'center' ? 'justify-center' : 'justify-start',
        'transition-[background-color,border-color,color,opacity] duration-300 disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="h-[1.1em] w-[1.1em] animate-spin" aria-hidden /> : icon}
      {children}
    </motion.button>
  );
});
