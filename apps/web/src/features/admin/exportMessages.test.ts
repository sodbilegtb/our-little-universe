import { describe, expect, it } from 'vitest';
import { toCsv } from './exportMessages';

describe('CSV export', () => {
  it('quotes what needs quoting and defuses spreadsheet formulas in guest text', () => {
    const csv = toCsv(['name', 'text'], [['=HYPERLINK("x")', 'Hi, "little" one\nxx'], ['@SUM(A1)', 3]]);
    expect(csv).toBe('\uFEFFname,text\r\n"\'=HYPERLINK(""x"")","Hi, ""little"" one\nxx"\r\n\'@SUM(A1),3');
  });
});
