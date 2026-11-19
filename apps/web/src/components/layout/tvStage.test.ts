import { describe, expect, it } from 'vitest';
import { computeStageScale } from './TvStage';
import { layoutConstellation } from '../constellation/layout';

describe('TV stage', () => {
  it('fits 1920×1080 into any viewport without cropping', () => {
    expect(computeStageScale(1920, 1080)).toBe(1);
    expect(computeStageScale(3840, 2160)).toBe(2);
    expect(computeStageScale(1280, 1024)).toBeCloseTo(1280 / 1920);
  });
});

describe('constellation layout', () => {
  const stars = Array.from({ length: 12 }, (_, i) => ({ id: `msg_${i}`, order: i, approved: false }));

  it('is deterministic, so every screen draws the same sky', () => {
    expect(layoutConstellation(stars, 1920, 1080)).toEqual(layoutConstellation([...stars].reverse(), 1920, 1080));
  });

  it('keeps stars inside the frame', () => {
    for (const star of layoutConstellation(stars, 1920, 1080)) {
      expect(star.x).toBeGreaterThan(0);
      expect(star.x).toBeLessThan(1920);
      expect(star.y).toBeGreaterThan(0);
      expect(star.y).toBeLessThan(1080);
    }
  });
});
