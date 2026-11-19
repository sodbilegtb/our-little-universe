import { describe, expect, it } from 'vitest';
import type { EventExport } from '@olu/shared';
import { exportFiles } from './exportEvent';
import { messagesToCsv, messagesToJson } from './exportMessages';

const message = {
  id: 'msg_1',
  guestId: 'gst_1',
  displayName: 'Aunt "Mia"',
  text: 'Hello, little one,\nwe love you',
  submittedAt: '2026-11-18T20:00:00.000Z',
  approved: true,
  hidden: false,
  removed: false,
};

describe('message export', () => {
  it('escapes commas, quotes and line breaks in CSV', () => {
    const csv = messagesToCsv([message]);
    expect(csv.startsWith('﻿id,guestId')).toBe(true);
    expect(csv).toContain('"Aunt ""Mia"""');
    expect(csv).toContain('"Hello, little one,\nwe love you"');
  });

  it('round-trips through JSON', () => {
    const parsed = JSON.parse(messagesToJson([message], 'evt_1')) as { count: number; messages: unknown[] };
    expect(parsed.count).toBe(1);
    expect(parsed.messages[0]).toEqual(message);
  });
});

describe('event export files', () => {
  const data: EventExport = {
    format: 'our-little-universe/event-export',
    version: 1,
    eventId: 'evt_1',
    eventName: 'Our Little Universe',
    exportedAt: '2026-11-18T22:00:00.000Z',
    phase: 'FINISHED',
    guests: [{ guestId: 'gst_1', displayName: 'Mia', joinedAt: '2026-11-18T19:00:00.000Z' }],
    voting: {
      tally: { boy: 0, girl: 1, total: 1 },
      votes: [{ guestId: 'gst_1', displayName: 'Mia', choice: 'GIRL', castAt: '2026-11-18T19:30:00.000Z' }],
    },
    quiz: {
      questions: [
        {
          id: 'q1',
          number: 1,
          text: 'Who cooks, Mom or Dad?',
          options: ['Mom', 'Dad', 'Both', 'Takeaway'],
          correctOptionIndex: 3,
          timeLimitSec: 20,
          scored: true,
          answers: [
            { guestId: 'gst_1', displayName: 'Mia', optionIndex: 3, correct: true, answeredAt: '2026-11-18T20:00:05.000Z' },
          ],
        },
      ],
      leaderboard: [{ rank: 1, guestId: 'gst_1', displayName: 'Mia', score: 100, correctCount: 1 }],
    },
    messages: [{ ...message, order: 0 }],
  };

  it('produces the archive and one CSV per table', () => {
    const files = exportFiles(data, '2026-11-18');
    expect(files.map((f) => f.name)).toEqual([
      'our-little-universe-2026-11-18.json',
      'votes-2026-11-18.csv',
      'quiz-answers-2026-11-18.csv',
      'quiz-scores-2026-11-18.csv',
    ]);
    expect(JSON.parse(files[0]!.content)).toEqual(data);
    expect(files[1]!.content).toContain('Mia,Girl,');
    expect(files[2]!.content).toContain('1,"Who cooks, Mom or Dad?",Mia,D,Takeaway,yes,');
    expect(files[3]!.content).toContain('1,Mia,100,1');
  });
});
