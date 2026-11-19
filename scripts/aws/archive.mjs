import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The keepsake archive written by `npm run aws:export`: the server's export,
 * CSV files for spreadsheets, a printable memory book, and a manifest with a
 * SHA-256 checksum and the expected row count of every file, so the archive
 * can be checked again later (`--verify`), e.g. after copying it to a drive.
 */

export const MANIFEST = 'manifest.json';

const CHOICE = { BOY: 'Boy', GIRL: 'Girl' };
const LETTERS = ['A', 'B', 'C', 'D'];

/* ---------- CSV ---------- */

function cell(value) {
  let text = String(value ?? '');
  // A leading =, +, - or @ would make Excel run the cell as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a byte-order mark, so Excel opens UTF-8 names correctly. */
export function toCsv(header, rows) {
  return `﻿${[header.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n')}`;
}

/** Splits CSV produced by toCsv back into rows (quotes and line breaks inside cells included). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      i += 1;
    } else value += ch;
  }
  row.push(value);
  rows.push(row);
  return rows;
}

/* ---------- the files ---------- */

/**
 * @param data   the server's export (GET /v1/admin/export)
 * @param reveal the result, once revealed ({ result, revealAt }), or null
 * @returns [{ name, content, rows }] where rows is the number of data rows (CSV) or records (JSON)
 */
export function archiveFiles(data, reveal) {
  const archive = { ...data, reveal: reveal ?? null };
  const answers = data.quiz.questions.flatMap((q) =>
    q.answers.map((a) => [q.number, q.text, a.displayName, LETTERS[a.optionIndex] ?? '', q.options[a.optionIndex] ?? '', a.correct ? 'yes' : 'no', a.answeredAt]),
  );
  return [
    { name: 'event.json', content: JSON.stringify(archive, null, 2), rows: data.messages.length },
    {
      name: 'messages.csv',
      content: toCsv(
        ['order', 'guest', 'sentAt', 'shownOnTv', 'hidden', 'removed', 'text'],
        data.messages.map((m) => [m.order, m.displayName, m.submittedAt, m.approved, m.hidden, m.removed ?? false, m.text]),
      ),
      rows: data.messages.length,
    },
    {
      name: 'guests.csv',
      content: toCsv(['guest', 'joinedAt'], data.guests.map((g) => [g.displayName, g.joinedAt])),
      rows: data.guests.length,
    },
    {
      name: 'votes.csv',
      content: toCsv(['guest', 'guess', 'votedAt'], data.voting.votes.map((v) => [v.displayName, CHOICE[v.choice] ?? v.choice, v.castAt])),
      rows: data.voting.votes.length,
    },
    {
      name: 'quiz-answers.csv',
      content: toCsv(['question', 'questionText', 'guest', 'answer', 'answerText', 'correct', 'answeredAt'], answers),
      rows: answers.length,
    },
    {
      name: 'quiz-scores.csv',
      content: toCsv(['rank', 'guest', 'score', 'correctAnswers'], data.quiz.leaderboard.map((e) => [e.rank, e.displayName, e.score, e.correctCount])),
      rows: data.quiz.leaderboard.length,
    },
    { name: 'memory-book.html', content: memoryBook(data, reveal), rows: bookMessages(data).length },
  ];
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function manifestFor(data, files, env) {
  return {
    format: 'our-little-universe/archive',
    version: 1,
    environment: env,
    eventId: data.eventId,
    exportedAt: data.exportedAt,
    counts: {
      guests: data.guests.length,
      votes: data.voting.votes.length,
      quizAnswers: data.quiz.questions.reduce((sum, q) => sum + q.answers.length, 0),
      messages: data.messages.length,
    },
    files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.content), sha256: sha256(f.content), rows: f.rows })),
  };
}

/**
 * Reads an archive folder back and checks every file against the manifest:
 * present, same checksum, parses, and has the expected number of rows.
 * Returns a list of problems (empty when the archive is whole).
 */
export function verifyArchive(dir) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
  } catch {
    return [`${MANIFEST} is missing or not readable`];
  }
  for (const file of manifest.files) {
    let content;
    try {
      content = readFileSync(join(dir, file.name), 'utf8');
    } catch {
      problems.push(`${file.name}: missing`);
      continue;
    }
    if (sha256(content) !== file.sha256) problems.push(`${file.name}: changed since the export (checksum differs)`);
    try {
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(content);
        if (data.messages.length !== file.rows) problems.push(`${file.name}: ${data.messages.length} messages, expected ${file.rows}`);
        if (data.guests.length !== manifest.counts.guests) problems.push(`${file.name}: ${data.guests.length} guests, expected ${manifest.counts.guests}`);
      } else if (file.name.endsWith('.csv')) {
        const rows = parseCsv(content).length - 1;
        if (rows !== file.rows) problems.push(`${file.name}: ${rows} rows, expected ${file.rows}`);
      } else if (file.name.endsWith('.html')) {
        const found = (content.match(/<article class="message">/g) ?? []).length;
        if (found !== file.rows) problems.push(`${file.name}: ${found} messages, expected ${file.rows}`);
      }
    } catch {
      problems.push(`${file.name}: not readable`);
    }
  }
  return problems;
}

/* ---------- the memory book ---------- */

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Every message the guests left for the baby, except the ones the host removed. */
function bookMessages(data) {
  return data.messages.filter((m) => !m.removed).sort((a, b) => a.order - b.order);
}

const RESULT = {
  BOY: { line: 'It’s a boy', tint: '#A9C2DE' },
  GIRL: { line: 'It’s a girl', tint: '#E7B3C1' },
};

function memoryBook(data, reveal) {
  const date = new Date(data.messages[0]?.submittedAt ?? data.exportedAt);
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const result = reveal ? RESULT[reveal.result] : null;
  const winner = data.quiz.leaderboard.find((e) => e.rank === 1);
  const tally = data.voting.tally;
  const messages = bookMessages(data);
  const tint = result?.tint ?? '#D8BD8B';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(data.eventName)}: messages for our little one</title>
<style>
  :root { --ink: #302B3A; --soft: #6B6478; --gold: #B89A62; --tint: ${tint}; --paper: #FAF7F0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.65 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 4rem 1.5rem 5rem; }
  .cover { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; text-align: center; }
  .moon { width: 3rem; height: 3rem; margin: 0 auto 2rem; border-radius: 50%; box-shadow: inset -0.7rem 0.2rem 0 0 var(--gold); }
  h1 { font-weight: 400; font-size: clamp(2.4rem, 7vw, 3.6rem); line-height: 1.1; margin: 0; letter-spacing: 0.01em; }
  .sub { margin: 1rem 0 0; color: var(--soft); font-style: italic; }
  .result { margin: 2.5rem auto 0; font-size: 1.9rem; font-style: italic; color: var(--ink); }
  .result::after { content: ""; display: block; width: 4rem; height: 3px; margin: 0.8rem auto 0; background: var(--tint); border-radius: 2px; }
  .facts { margin-top: 2.5rem; color: var(--soft); font-size: 0.95rem; }
  h2 { font-weight: 400; font-size: 1.6rem; margin: 4rem 0 2rem; text-align: center; }
  .message { break-inside: avoid; margin: 0 0 2.25rem; padding: 0 0 2.25rem; border-bottom: 1px solid #E6DFD1; }
  .message:last-child { border-bottom: 0; }
  .message p { margin: 0; white-space: pre-wrap; font-size: 1.15rem; }
  .message footer { margin-top: 0.75rem; color: var(--soft); font-size: 0.95rem; }
  .message footer::before { content: "— "; color: var(--gold); }
  .empty { text-align: center; color: var(--soft); font-style: italic; }
  @media print {
    body { background: #fff; font-size: 12pt; }
    main { padding: 0; max-width: none; }
    .cover { min-height: 0; height: 100vh; break-after: page; }
    @page { margin: 2.2cm 2cm; }
  }
</style>
</head>
<body>
<main>
  <section class="cover">
    <div class="moon" aria-hidden="true"></div>
    <h1>${escape(data.eventName)}</h1>
    <p class="sub">Messages for our little one · ${escape(day)}</p>
    ${result ? `<p class="result">${result.line}</p>` : ''}
    <p class="facts">${data.guests.length} guests · ${tally.total} guesses (${tally.boy} boy, ${tally.girl} girl)${winner ? ` · quiz winner: ${escape(winner.displayName)}` : ''}</p>
  </section>
  <h2>${messages.length === 1 ? 'One little star' : `${messages.length} little stars`}</h2>
${
  messages.length
    ? messages
        .map(
          (m) => `  <article class="message">
    <p>${escape(m.text)}</p>
    <footer>${escape(m.displayName)}</footer>
  </article>`,
        )
        .join('\n')
    : '  <p class="empty">No messages were left this time.</p>'
}
</main>
</body>
</html>
`;
}
