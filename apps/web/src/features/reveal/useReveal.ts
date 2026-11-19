import { useEffect, useState } from 'react';
import type { RevealResult } from '@olu/shared';
import { api } from '@/services/api';
import { serverNow } from '@/services/sync/serverClock';
import { revealStage, type StageInfo } from './timeline';

/**
 * Fetches the result once the reveal moment has come, never before: until
 * `revealAt` (server clock) this hook doesn't touch the network. A "not yet"
 * from the server (clocks a little apart) or a network hiccup is retried.
 */
export function useRevealResult(revealAt: number | null): RevealResult | null {
  const [result, setResult] = useState<RevealResult | null>(null);

  useEffect(() => {
    if (revealAt === null) return;
    let stopped = false;
    let timer: number | undefined;

    const attempt = async () => {
      if (stopped) return;
      const wait = revealAt - serverNow();
      if (wait > 0) {
        timer = window.setTimeout(() => void attempt(), wait);
        return;
      }
      try {
        const next = await api.getRevealResult();
        if (stopped) return;
        if (next) setResult(next);
        else timer = window.setTimeout(() => void attempt(), 400);
      } catch {
        if (!stopped) timer = window.setTimeout(() => void attempt(), 1000);
      }
    };
    void attempt();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [revealAt]);

  return result;
}

/** The current stage of the sequence. Re-renders only when the stage (or the countdown digit) changes. */
export function useRevealStage(revealAt: number, hasResult: boolean): StageInfo {
  const [info, setInfo] = useState(() => revealStage(serverNow(), revealAt, hasResult));

  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      const next = revealStage(serverNow(), revealAt, hasResult);
      setInfo((previous) => (previous.stage === next.stage && previous.digit === next.digit ? previous : next));
      if (next.nextChangeAt !== null) {
        // A few ms late rather than early, so the next check lands inside the next stage.
        timer = window.setTimeout(update, Math.max(16, next.nextChangeAt - serverNow() + 8));
      }
    };
    update();
    return () => window.clearTimeout(timer);
  }, [revealAt, hasResult]);

  return info;
}
