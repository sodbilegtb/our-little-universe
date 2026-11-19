import { useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { AdminView } from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Pill } from '@/components/ui/Pill';
import { api, errorMessage } from '@/services/api';
import { useAdminSession } from './adminSession';
import { Panel } from './Panel';

/**
 * Test mode only: try the whole evening again, reveal included, without a new
 * event id. The server keeps what the current run collected; it only stops
 * showing it. Never rendered (and refused by the server) in live mode.
 */
export function RehearsalCard({ view, onChanged }: { view: AdminView; onChanged: () => void }) {
  const admin = useAdminSession();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (view.mode !== 'TEST') return null;

  return (
    <Panel title="Rehearsal" aside={<Pill tone="lavender">Test mode</Pill>}>
      <p className="text-sm text-ivory-dim">Run the evening again from the lobby, reveal included.</p>
      <Button
        className="mt-4"
        variant="quiet"
        size="sm"
        align="start"
        icon={<RefreshCcw className="h-4 w-4" aria-hidden />}
        onClick={() => {
          setError(null);
          setConfirm(true);
        }}
      >
        Start a new rehearsal
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-ivory-dim">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirm}
        title="Start a new rehearsal?"
        confirmLabel="Start a new rehearsal"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.startNewRehearsal(admin);
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setBusy(false);
            setConfirm(false);
            onChanged();
          }
        }}
      >
        <p>
          Everyone goes back to the lobby. Guests enter their names again, and votes, quiz answers, messages and the
          doctor&rsquo;s answer start empty. The quiz questions stay as they are.
        </p>
        <p className="mt-3">
          This run stays stored but is no longer shown, and its reveal code stops working. To keep a copy, use
          &ldquo;Keep the evening&rdquo; first.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}
