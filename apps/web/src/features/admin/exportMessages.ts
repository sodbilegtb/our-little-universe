import type { AdminMessage } from '@olu/shared';

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a byte-order mark, so Excel opens UTF-8 names and emoji correctly. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | boolean)[])[]): string {
  return `﻿${[header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n')}`;
}

export function messagesToCsv(messages: readonly AdminMessage[]): string {
  return toCsv(
    ['id', 'guestId', 'displayName', 'submittedAt', 'approved', 'hidden', 'text'],
    messages.map((m) => [m.id, m.guestId, m.displayName, m.submittedAt, m.approved, m.hidden, m.text]),
  );
}

export function messagesToJson(messages: readonly AdminMessage[], eventId: string): string {
  return JSON.stringify({ eventId, exportedAt: new Date().toISOString(), count: messages.length, messages }, null, 2);
}

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
