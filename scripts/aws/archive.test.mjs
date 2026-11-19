import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { archiveFiles, manifestFor, MANIFEST, parseCsv, toCsv, verifyArchive } from './archive.mjs';

const data = {
  format: 'our-little-universe/event-export',
  version: 1,
  eventId: 'baby-reveal',
  eventName: 'Our Little Universe',
  exportedAt: '2026-12-12T22:30:00.000Z',
  phase: 'FINISHED',
  guests: [
    { guestId: 'g1', displayName: 'Mia', joinedAt: '2026-12-12T18:00:00.000Z' },
    { guestId: 'g2', displayName: '=HYPERLINK("x")', joinedAt: '2026-12-12T18:01:00.000Z' },
  ],
  voting: {
    tally: { boy: 1, girl: 1, total: 2 },
    votes: [
      { guestId: 'g1', displayName: 'Mia', choice: 'GIRL', castAt: '2026-12-12T18:10:00.000Z' },
      { guestId: 'g2', displayName: '=HYPERLINK("x")', choice: 'BOY', castAt: '2026-12-12T18:11:00.000Z' },
    ],
  },
  quiz: {
    questions: [
      {
        number: 1,
        text: 'Who cooks better?',
        options: ['Mom', 'Dad', 'Both', 'Neither'],
        correctIndex: 0,
        timeLimitSeconds: 20,
        scored: true,
        answers: [{ guestId: 'g1', displayName: 'Mia', optionIndex: 0, correct: true, answeredAt: '2026-12-12T18:20:00.000Z' }],
      },
    ],
    leaderboard: [
      { rank: 1, guestId: 'g1', displayName: 'Mia', score: 100, correctCount: 1 },
      { rank: 2, guestId: 'g2', displayName: '=HYPERLINK("x")', score: 0, correctCount: 0 },
    ],
  },
  messages: [
    { id: 'm1', order: 0, guestId: 'g1', displayName: 'Mia', submittedAt: '2026-12-12T19:00:00.000Z', approved: true, hidden: false, removed: false, text: 'Welcome, little one!\nWe "love" you, already.' },
    { id: 'm2', order: 1, guestId: 'g2', displayName: 'Ben', submittedAt: '2026-12-12T19:01:00.000Z', approved: false, hidden: false, removed: true, text: 'not for the book' },
    { id: 'm3', order: 2, guestId: 'g2', displayName: 'Ben', submittedAt: '2026-12-12T19:02:00.000Z', approved: false, hidden: true, removed: false, text: '<script>alert(1)</script> 🌙' },
  ],
};

function writeArchive(reveal) {
  const dir = mkdtempSync(join(tmpdir(), 'olu-archive-'));
  const files = archiveFiles(data, reveal);
  for (const f of files) writeFileSync(join(dir, f.name), f.content);
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifestFor(data, files, 'prod')));
  return dir;
}

test('CSV keeps commas, quotes, line breaks and emoji, and defuses spreadsheet formulas', () => {
  const csv = toCsv(['a', 'b'], [['x, "y"\nz', '🌙'], ['=1+1', '-5']]);
  assert.deepEqual(parseCsv(csv), [['a', 'b'], ['x, "y"\nz', '🌙'], ["'=1+1", "'-5"]]);
});

test('an archive checks out whole, and any change or loss is reported', () => {
  const dir = writeArchive({ result: 'GIRL', revealAt: '2026-12-12T21:00:00.000Z' });
  try {
    assert.deepEqual(verifyArchive(dir), []);
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
    assert.deepEqual(manifest.counts, { guests: 2, votes: 2, quizAnswers: 1, messages: 3 });
    assert.equal(manifest.files.find((f) => f.name === 'messages.csv').rows, 3);

    writeFileSync(join(dir, 'votes.csv'), readFileSync(join(dir, 'votes.csv'), 'utf8').replace('Mia', 'Mio'));
    unlinkSync(join(dir, 'quiz-scores.csv'));
    assert.deepEqual(verifyArchive(dir), ['votes.csv: changed since the export (checksum differs)', 'quiz-scores.csv: missing']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the archive keeps everything, the result included once revealed', () => {
  const [json] = archiveFiles(data, { result: 'GIRL', revealAt: '2026-12-12T21:00:00.000Z' });
  const archived = JSON.parse(json.content);
  assert.equal(archived.messages.length, 3); // removed and hidden ones too, flagged
  assert.deepEqual(archived.reveal, { result: 'GIRL', revealAt: '2026-12-12T21:00:00.000Z' });
  assert.equal(JSON.parse(archiveFiles(data, null)[0].content).reveal, null);
});

test('the memory book holds every message but the removed ones, as text, never as HTML', () => {
  const book = archiveFiles(data, { result: 'GIRL', revealAt: '2026-12-12T21:00:00.000Z' }).find((f) => f.name === 'memory-book.html');
  assert.equal(book.rows, 2);
  assert.match(book.content, /Welcome, little one!\nWe &quot;love&quot; you, already\./);
  assert.match(book.content, /&lt;script&gt;alert\(1\)&lt;\/script&gt; 🌙/);
  assert.doesNotMatch(book.content, /<script>/);
  assert.doesNotMatch(book.content, /not for the book/);
  assert.match(book.content, /It’s a girl/);
  assert.match(book.content, /2 little stars/);
  const before = archiveFiles(data, null).find((f) => f.name === 'memory-book.html');
  assert.doesNotMatch(before.content, /It’s a (boy|girl)/);
});
