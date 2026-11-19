export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface RevisionPollerOptions {
  fetchRevision: () => Promise<number>;
  /** Called when the revision differs from the last one seen (and on the first success). */
  onChange: (revision: number) => void;
  onStatus?: (status: ConnectionStatus) => void;
  /** Normal polling interval. The spec asks for roughly 1-2 seconds. */
  intervalMs?: number;
  /** Upper bound for the backoff after repeated failures. */
  maxIntervalMs?: number;
  /** ±fraction of random spread, so 40 phones don't poll in lockstep. */
  jitter?: number;
  /** Injected for tests. */
  environment?: PollerEnvironment;
}

export interface PollerEnvironment {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  isHidden: () => boolean;
  isOnline: () => boolean;
  onVisibilityChange: (fn: () => void) => () => void;
  onOnline: (fn: () => void) => () => void;
  random: () => number;
}

export const browserEnvironment = (): PollerEnvironment => ({
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  isHidden: () => document.hidden,
  isOnline: () => navigator.onLine,
  onVisibilityChange: (fn) => {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
  onOnline: (fn) => {
    window.addEventListener('online', fn);
    return () => window.removeEventListener('online', fn);
  },
  random: Math.random,
});

export interface RevisionPoller {
  /** Poll right now, e.g. after a push hint or a local action. */
  poke: () => void;
  stop: () => void;
}

/**
 * Polls a cheap revision endpoint and reports when the event changed.
 *
 * - Polls every `intervalMs` (± jitter) while the page is visible.
 * - Pauses while the tab is hidden and polls immediately when it returns.
 * - Backs off exponentially on failures, up to `maxIntervalMs`, and retries
 *   immediately when the browser reports it is back online.
 * - Only one request is ever in flight.
 */
export function createRevisionPoller(options: RevisionPollerOptions): RevisionPoller {
  const {
    fetchRevision,
    onChange,
    onStatus,
    intervalMs = 1500,
    maxIntervalMs = 15_000,
    jitter = 0.2,
    environment: env = browserEnvironment(),
  } = options;

  let lastRevision: number | null = null;
  let failures = 0;
  let timer: unknown = null;
  let inFlight = false;
  let pokeQueued = false;
  let stopped = false;
  let status: ConnectionStatus = 'connecting';

  const setStatus = (next: ConnectionStatus) => {
    if (next !== status) {
      status = next;
      onStatus?.(next);
    }
  };

  const delay = () => {
    const base = failures === 0 ? intervalMs : Math.min(maxIntervalMs, intervalMs * 2 ** failures);
    return base * (1 + (env.random() * 2 - 1) * jitter);
  };

  const schedule = () => {
    if (stopped || env.isHidden()) return;
    env.clearTimeout(timer);
    timer = env.setTimeout(tick, delay());
  };

  async function tick() {
    if (stopped) return;
    if (inFlight) {
      pokeQueued = true;
      return;
    }
    inFlight = true;
    try {
      const revision = await fetchRevision();
      if (stopped) return;
      failures = 0;
      setStatus('live');
      if (revision !== lastRevision) {
        lastRevision = revision;
        onChange(revision);
      }
    } catch {
      if (stopped) return;
      failures += 1;
      setStatus(env.isOnline() ? 'reconnecting' : 'offline');
    } finally {
      inFlight = false;
    }
    if (pokeQueued) {
      pokeQueued = false;
      void tick();
    } else {
      schedule();
    }
  }

  const poke = () => {
    if (stopped) return;
    env.clearTimeout(timer);
    void tick();
  };

  const offVisibility = env.onVisibilityChange(() => {
    if (env.isHidden()) env.clearTimeout(timer);
    else poke();
  });
  const offOnline = env.onOnline(poke);

  poke();

  return {
    poke,
    stop: () => {
      stopped = true;
      env.clearTimeout(timer);
      offVisibility();
      offOnline();
    },
  };
}
