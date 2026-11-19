import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { MessageStar } from '@olu/shared';
import { layoutConstellation } from './layout';

interface ConstellationProps {
  stars: readonly MessageStar[];
  width: number;
  height: number;
  className?: string;
}

/** Each baby message becomes a glowing star, linked to its nearest neighbour. */
export function Constellation({ stars, width, height, className }: ConstellationProps) {
  const reduce = useReducedMotion();
  const placed = useMemo(() => layoutConstellation(stars, width, height), [stars, width, height]);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden>
      <defs>
        <radialGradient id="star-halo">
          <stop offset="0%" stopColor="#F3E6CB" stopOpacity="0.85" />
          <stop offset="35%" stopColor="#D8BD8B" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#D8BD8B" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g stroke="#E9D8B6" strokeWidth={1} strokeLinecap="round">
        {placed.map((star) => {
          const target = star.linkTo >= 0 ? placed[star.linkTo] : undefined;
          if (!target) return null;
          return (
            <motion.line
              key={`line-${star.id}`}
              x1={target.x}
              y1={target.y}
              x2={star.x}
              y2={star.y}
              initial={{ pathLength: reduce ? 1 : 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.22 }}
              transition={{ duration: 1.6, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          );
        })}
      </g>

      {placed.map((star) => (
        <motion.g
          key={star.id}
          initial={reduce ? false : { opacity: 0, scale: 0.2 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: `${star.x}px ${star.y}px`, transformBox: 'view-box' }}
        >
          <circle cx={star.x} cy={star.y} r={star.size * 7} fill="url(#star-halo)" />
          <circle cx={star.x} cy={star.y} r={star.size * 0.55} fill="#FAF7F0" />
          {!reduce && (
            <motion.circle
              cx={star.x}
              cy={star.y}
              r={star.size * 2.4}
              fill="none"
              stroke="#E9D8B6"
              strokeWidth={0.6}
              initial={{ opacity: 0.7, scale: 0.4 }}
              animate={{ opacity: 0, scale: 2.2 }}
              transition={{ duration: 2.2, ease: 'easeOut' }}
              style={{ transformOrigin: `${star.x}px ${star.y}px`, transformBox: 'view-box' }}
            />
          )}
        </motion.g>
      ))}
    </svg>
  );
}
