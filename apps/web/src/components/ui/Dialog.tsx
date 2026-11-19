import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ease } from '@/lib/motion';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for sensitive host actions. Escape and the backdrop cancel. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default bg-night-deep/70 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="veil relative w-full max-w-md rounded-[1.75rem] p-7 shadow-2xl"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.35, ease: ease.drift }}
          >
            <h2 id={titleId} className="type-display text-[1.75rem]">
              {title}
            </h2>
            {children && <div className="mt-3 text-[0.98rem] text-ivory-dim">{children}</div>}
            <div className="mt-7 flex justify-end gap-3">
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                {cancelLabel}
              </Button>
              <Button
                ref={confirmRef}
                variant={tone === 'danger' ? 'danger' : 'primary'}
                loading={busy}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
