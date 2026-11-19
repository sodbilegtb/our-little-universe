import { useCallback, useEffect, useRef, useState } from 'react';
import type { BaseEventView } from '@olu/shared';
import { api, type Audience } from '@/services/api';
import { createRevisionPoller, type ConnectionStatus, type RevisionPoller } from '@/services/sync/revisionPoller';
import { recordServerTime } from '@/services/sync/serverClock';

export interface LiveView<T> {
  data: T | null;
  error: unknown;
  status: ConnectionStatus;
  /** Fetch the view now, e.g. right after this device performed an action. */
  refresh: () => void;
}

/**
 * Keeps a role-specific view in sync with the event.
 *
 * A revision poller asks "has anything changed?" every ~1.5s (with backoff and
 * visibility pausing); only when the revision moves is the full view fetched.
 * Push hints from the API (instant in the mock, WebSockets later) just poll
 * sooner. Stale responses are dropped and older revisions never overwrite newer ones.
 */
export function useLiveView<T extends BaseEventView>(
  audience: Audience,
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): LiveView<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const request = useRef(0);
  const poller = useRef<RevisionPoller | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchView = useCallback(fetcher, deps);

  const refresh = useCallback(() => {
    const id = ++request.current;
    fetchView()
      .then((next) => {
        if (id !== request.current) return;
        recordServerTime(next.serverTime);
        setError(null);
        setData((previous) => (previous && previous.revision > next.revision ? previous : next));
      })
      .catch((reason: unknown) => {
        if (id !== request.current) return;
        setError(reason);
        poller.current?.poke(); // let the poller drive backoff and status
      });
  }, [fetchView]);

  useEffect(() => {
    refresh();
    const instance = createRevisionPoller({
      fetchRevision: () => api.getRevision(audience),
      onChange: refresh,
      onStatus: setStatus,
    });
    poller.current = instance;
    const unsubscribe = api.subscribe(() => instance.poke());
    return () => {
      unsubscribe();
      instance.stop();
      poller.current = null;
    };
  }, [audience, refresh]);

  return { data, error, status, refresh };
}
