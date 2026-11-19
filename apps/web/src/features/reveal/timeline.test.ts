import { describe, expect, it } from 'vitest';
import { revealStage } from './timeline';

const R = 1_000_000;
const at = (offset: number, hasResult = false) => revealStage(R + offset, R, hasResult);

describe('reveal timeline', () => {
  it('builds up in order towards the reveal moment', () => {
    expect(at(-26_000).stage).toBe('hush');
    expect(at(-21_000).stage).toBe('gather');
    expect(at(-11_001).stage).toBe('gather');
    expect(at(-11_000).stage).toBe('tension');
    expect(at(-5_001).stage).toBe('tension');
  });

  it('counts 5 to 1, one second each, ending exactly at the reveal moment', () => {
    const digits = [-5_000, -4_001, -4_000, -1_000, -1].map((t) => at(t).digit);
    expect(digits).toEqual([5, 5, 4, 1, 1]);
    expect(at(-5_000).nextChangeAt).toBe(R - 4_000);
    expect(at(-1).nextChangeAt).toBe(R);
  });

  it('waits in darkness until the result has arrived, however long', () => {
    expect(at(0)).toEqual({ stage: 'pause', digit: null, nextChangeAt: null });
    expect(at(60_000).stage).toBe('pause');
    expect(at(500, true).stage).toBe('pause');
    expect(at(1_200, true).stage).toBe('burst');
    expect(at(9_000, true)).toEqual({ stage: 'celebrate', digit: null, nextChangeAt: null });
  });

  it('never reaches the burst before the reveal moment, result or not', () => {
    for (let t = -30_000; t < 0; t += 250) {
      expect(['burst', 'celebrate']).not.toContain(at(t, true).stage);
    }
  });
});
