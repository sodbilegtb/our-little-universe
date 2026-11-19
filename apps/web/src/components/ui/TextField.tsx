import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface FieldChromeProps {
  label: string;
  hint?: string;
  error?: string | null;
  /** Shows "used / max" in the corner. */
  count?: { used: number; max: number };
  labelHidden?: boolean;
}

function FieldFooter({ id, hint, error, count }: { id: string } & Pick<FieldChromeProps, 'hint' | 'error' | 'count'>) {
  if (!hint && !error && !count) return null;
  return (
    <div className="mt-2 flex min-h-5 items-start justify-between gap-4 text-sm">
      <p id={`${id}-desc`} className={cn(error ? 'text-danger' : 'text-mist')} role={error ? 'alert' : undefined}>
        {error ?? hint}
      </p>
      {count && (
        <span
          className={cn('shrink-0 tabular-nums', count.used > count.max ? 'text-danger' : 'text-mist/80')}
          aria-hidden
        >
          {count.used}/{count.max}
        </span>
      )}
    </div>
  );
}

const fieldBase =
  'w-full rounded-[1.25rem] border bg-night-deep/45 px-5 text-ivory placeholder:text-mist/60 outline-none ' +
  'transition-[border-color,box-shadow,background-color] duration-300 ' +
  'focus:border-champagne/70 focus:bg-night-deep/60 focus:shadow-[0_0_0_4px_rgba(216,189,139,0.12)]';

export const TextField = forwardRef<
  HTMLInputElement,
  FieldChromeProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>
>(function TextField({ label, hint, error, count, labelHidden, className, ...rest }, ref) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={cn('mb-2.5 block text-[0.95rem] text-ivory-dim', labelHidden && 'sr-only')}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-desc` : undefined}
        className={cn(fieldBase, 'h-15 text-[1.2rem]', error ? 'border-danger/60' : 'border-ivory/15')}
        {...rest}
      />
      <FieldFooter id={id} hint={hint} error={error} count={count} />
    </div>
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  FieldChromeProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>
>(function TextArea({ label, hint, error, count, labelHidden, className, ...rest }, ref) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={cn('mb-2.5 block text-[0.95rem] text-ivory-dim', labelHidden && 'sr-only')}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-desc` : undefined}
        className={cn(
          fieldBase,
          'min-h-48 resize-none py-4 font-display text-[1.15rem] leading-[1.6] [font-variation-settings:"SOFT"_100,"opsz"_18]',
          error ? 'border-danger/60' : 'border-ivory/15',
        )}
        {...rest}
      />
      <FieldFooter id={id} hint={hint} error={error} count={count} />
    </div>
  );
});
