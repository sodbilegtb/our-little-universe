/**
 * Tracks the difference between this device's clock and the server's, so
 * countdowns end at the same moment on every phone and the TV even when a
 * device clock is a few seconds off.
 */
let offsetMs = 0;
let samples = 0;

/** Feed in a server timestamp received just now. Smooths out network jitter. */
export function recordServerTime(serverTimeIso: string, receivedAt = Date.now()): void {
  const serverMs = Date.parse(serverTimeIso);
  if (Number.isNaN(serverMs)) return;
  const sample = serverMs - receivedAt;
  samples += 1;
  // Fast convergence for the first few samples, then a gentle moving average.
  const weight = samples < 4 ? 1 / samples : 0.2;
  offsetMs = offsetMs + (sample - offsetMs) * weight;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function resetServerClock(): void {
  offsetMs = 0;
  samples = 0;
}
