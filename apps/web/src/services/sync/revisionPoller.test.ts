import { describe, expect, it, vi } from 'vitest';
import { createRevisionPoller, type ConnectionStatus, type PollerEnvironment } from './revisionPoller';

function fakeEnvironment() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  let hidden = false;
  let visibilityHandler: () => void = () => {};
  let onlineHandler: () => void = () => {};
  const env: PollerEnvironment = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
    isHidden: () => hidden,
    isOnline: () => true,
    onVisibilityChange: (fn) => {
      visibilityHandler = fn;
      return () => {};
    },
    onOnline: (fn) => {
      onlineHandler = fn;
      return () => {};
    },
    random: () => 0.5, // no jitter
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    env,
    /** Advances fake time, running due timers and letting their promises settle. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.fn();
        await flush();
      }
      now = target;
    },
    pending: () => timers.map((t) => t.at - now),
    setHidden(value: boolean) {
      hidden = value;
      visibilityHandler();
    },
    goOnline: () => onlineHandler(),
    flush,
  };
}

describe('revision poller', () => {
  it('reports changes only when the revision moves', async () => {
    const fake = fakeEnvironment();
    let revision = 1;
    const onChange = vi.fn();
    const poller = createRevisionPoller({ fetchRevision: async () => revision, onChange, environment: fake.env });
    await fake.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    await fake.advance(1500);
    expect(onChange).toHaveBeenCalledTimes(1);
    revision = 2;
    await fake.advance(1500);
    expect(onChange).toHaveBeenLastCalledWith(2);
    poller.stop();
  });

  it('backs off on failures and recovers', async () => {
    const fake = fakeEnvironment();
    let failing = true;
    const statuses: ConnectionStatus[] = [];
    const poller = createRevisionPoller({
      fetchRevision: async () => {
        if (failing) throw new Error('down');
        return 1;
      },
      onChange: () => {},
      onStatus: (s) => statuses.push(s),
      environment: fake.env,
    });
    await fake.flush();
    expect(fake.pending()).toEqual([3000]); // 1500 * 2^1
    await fake.advance(3000);
    expect(fake.pending()).toEqual([6000]);
    await fake.advance(6000);
    expect(fake.pending()).toEqual([12000]);
    await fake.advance(12000);
    expect(fake.pending()).toEqual([15000]); // capped
    failing = false;
    fake.goOnline(); // the browser says we're back: retry at once
    await fake.flush();
    expect(statuses).toEqual(['reconnecting', 'live']);
    expect(fake.pending()).toEqual([1500]);
    poller.stop();
  });

  it('pauses while hidden and polls on return', async () => {
    const fake = fakeEnvironment();
    const fetchRevision = vi.fn(async () => 1);
    const poller = createRevisionPoller({ fetchRevision, onChange: () => {}, environment: fake.env });
    await fake.flush();
    fake.setHidden(true);
    expect(fake.pending()).toEqual([]);
    await fake.advance(60_000);
    expect(fetchRevision).toHaveBeenCalledTimes(1);
    fake.setHidden(false);
    await fake.flush();
    expect(fetchRevision).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('never runs two requests at once', async () => {
    const fake = fakeEnvironment();
    let resolve: (value: number) => void = () => {};
    const fetchRevision = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const poller = createRevisionPoller({ fetchRevision, onChange: () => {}, environment: fake.env });
    poller.poke();
    poller.poke();
    expect(fetchRevision).toHaveBeenCalledTimes(1);
    resolve(1);
    await fake.flush();
    expect(fetchRevision).toHaveBeenCalledTimes(2); // the queued poke runs afterwards
    poller.stop();
  });
});
