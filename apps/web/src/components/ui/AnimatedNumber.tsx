import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (value: number) => string;
  className?: string;
}

/** Counts toward a new value by writing to the DOM directly, without React re-renders. */
export function AnimatedNumber({ value, duration = 1.1, format = (v) => String(Math.round(v)), className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const reduce = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = previous.current;
    previous.current = value;
    if (reduce || from === value) {
      node.textContent = format(value);
      return;
    }
    const controls = animate(from, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
    });
    return () => controls.stop();
  }, [value, duration, format, reduce]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
