import type { MessageStar } from '@olu/shared';
import { hashString, mulberry32 } from '@/lib/random';

export interface PlacedStar extends MessageStar {
  x: number;
  y: number;
  size: number;
  /** Index of the earlier star this one is linked to, or -1. */
  linkTo: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Places message stars on a widening golden-angle spiral, jittered by the
 * message id. The result is deterministic, so every screen draws the same
 * constellation, and it grows outward as messages arrive.
 */
export function layoutConstellation(
  stars: readonly MessageStar[],
  width: number,
  height: number,
  padding = 80,
): PlacedStar[] {
  const sorted = [...stars].sort((a, b) => a.order - b.order);
  const cx = width / 2;
  const cy = height / 2;
  const maxRx = width / 2 - padding;
  const maxRy = height / 2 - padding;
  const capacity = Math.max(24, sorted.length);

  const placed: PlacedStar[] = [];
  sorted.forEach((star, i) => {
    const rand = mulberry32(hashString(star.id));
    const t = Math.sqrt((i + 0.6) / capacity);
    const angle = i * GOLDEN_ANGLE + (rand() - 0.5) * 0.5;
    const radius = 0.18 + 0.82 * t;
    const x = cx + Math.cos(angle) * maxRx * radius + (rand() - 0.5) * 40;
    const y = cy + Math.sin(angle) * maxRy * radius + (rand() - 0.5) * 30;

    let linkTo = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < placed.length; j += 1) {
      const other = placed[j];
      if (!other) continue;
      const d = (other.x - x) ** 2 + (other.y - y) ** 2;
      if (d < best) {
        best = d;
        linkTo = j;
      }
    }

    placed.push({ ...star, x, y, size: 3 + rand() * 3, linkTo });
  });
  return placed;
}
