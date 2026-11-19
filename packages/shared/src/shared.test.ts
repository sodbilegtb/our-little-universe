import { describe, expect, it } from 'vitest';
import {
  canTransition,
  displayNameSchema,
  babyMessageSchema,
  rankLeaderboard,
  revealCodeSchema,
  nextPhase,
} from './index';

describe('phase transitions', () => {
  it('only moves forward one step', () => {
    expect(canTransition('LOBBY', 'VOTING')).toBe(true);
    expect(canTransition('LOBBY', 'QUIZ')).toBe(false);
    expect(canTransition('QUIZ', 'VOTING')).toBe(false);
    expect(canTransition('FINISHED', 'LOBBY')).toBe(false);
    expect(nextPhase('FINISHED')).toBeNull();
  });
});

describe('display names', () => {
  it('normalizes whitespace', () => {
    expect(displayNameSchema.parse('  Aunt   Mia ')).toBe('Aunt Mia');
  });
  it('rejects empty and overly long names', () => {
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
    expect(displayNameSchema.safeParse('x'.repeat(33)).success).toBe(false);
  });
});

describe('baby messages', () => {
  it('requires content', () => {
    const clientMessageId = 'client-0001';
    expect(babyMessageSchema.safeParse({ clientMessageId, text: '  ' }).success).toBe(false);
    expect(babyMessageSchema.parse({ clientMessageId, text: ' Hello little one ' }).text).toBe('Hello little one');
    expect(babyMessageSchema.safeParse({ text: 'No id' }).success).toBe(false);
  });
});

describe('reveal code format', () => {
  it('normalizes user input into the grouped format', () => {
    expect(revealCodeSchema.parse('r7km 92px l4qt')).toBe('R7KM-92PX-L4QT');
    expect(revealCodeSchema.safeParse('R7KM-92PX').success).toBe(false);
  });
});

describe('leaderboard', () => {
  const base = { correctCount: 0, correctResponseMs: 0 };
  it('orders by score, then speed, then join time, with unique ranks', () => {
    const ranked = rankLeaderboard([
      { ...base, guestId: 'c', displayName: 'C', joinedAt: 3, score: 200, correctResponseMs: 9000 },
      { ...base, guestId: 'a', displayName: 'A', joinedAt: 1, score: 300, correctResponseMs: 20000 },
      { ...base, guestId: 'b', displayName: 'B', joinedAt: 2, score: 200, correctResponseMs: 8000 },
      { ...base, guestId: 'd', displayName: 'D', joinedAt: 0, score: 200, correctResponseMs: 8000 },
    ]);
    expect(ranked.map((e) => e.guestId)).toEqual(['a', 'd', 'b', 'c']);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });
});
