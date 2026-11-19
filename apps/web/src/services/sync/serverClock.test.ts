import { beforeEach, describe, expect, it } from 'vitest';
import { recordServerTime, resetServerClock, serverNow } from './serverClock';

describe('server clock', () => {
  beforeEach(resetServerClock);

  it('corrects for a device clock that runs behind', () => {
    const deviceNow = Date.now();
    recordServerTime(new Date(deviceNow + 5000).toISOString(), deviceNow);
    expect(serverNow() - Date.now()).toBeGreaterThan(4900);
    expect(serverNow() - Date.now()).toBeLessThan(5100);
  });

  it('ignores invalid timestamps', () => {
    recordServerTime('not a date');
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(5);
  });
});
