import { useState } from 'react';
import { useEffect } from 'react';
import { Archive, Copy, Download, ExternalLink, RotateCcw, Sparkles, WifiOff } from 'lucide-react';
import type { AdminView, DoctorStatus, RevealStatus } from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Pill } from '@/components/ui/Pill';
import { api, ApiError, isMockApi } from '@/services/api';
import { MOCK_DOCTOR_TOKEN } from '@/services/api/mock/constants';
import { useAdminSession } from './adminSession';
import { exportFiles, type ExportFile } from './exportEvent';
import { downloadFile } from './exportMessages';
import { Panel } from './Panel';

const DOCTOR_TEXT: Record<DoctorStatus, { label: string; tone: 'neutral' | 'champagne' | 'sage' }> = {
  NOT_STARTED: { label: 'No link yet', tone: 'neutral' },
  LINK_ISSUED: { label: 'Waiting for the doctor', tone: 'champagne' },
  SUBMITTED: { label: 'Answer sealed', tone: 'sage' },
  CODE_SENT: { label: 'Sealed, code emailed', tone: 'sage' },
};

const REVEAL_TEXT: Record<RevealStatus, string> = {
  LOCKED: 'Locked',
  AWAITING_CODE: 'Waiting for the code',
  REVEALING: 'Revealing',
  REVEALED: 'Revealed',
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard can be unavailable on plain http; the link is still visible.
    }
  };
  return { copied, copy };
}

export function SecretCard({ view }: { view: AdminView }) {
  const doctor = DOCTOR_TEXT[view.doctor.status];
  const { copied, copy } = useCopy();
  const doctorUrl = `${window.location.origin}/doctor/${MOCK_DOCTOR_TOKEN}`;
  return (
    <Panel title="The secret">
      <dl className="grid gap-4 text-[0.95rem]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-mist">Doctor</dt>
          <dd>
            <Pill tone={doctor.tone}>{doctor.label}</Pill>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-mist">Reveal</dt>
          <dd className="text-ivory-dim">{REVEAL_TEXT[view.reveal.status]}</dd>
        </div>
      </dl>
      <p className="mt-5 text-sm leading-relaxed text-mist">
        The answer is never shown here. Only the official code unlocks it, on the TV.
      </p>
      {isMockApi && view.doctor.status === 'LINK_ISSUED' && (
        <Button
          variant="quiet"
          size="sm" block className="mt-4"
          icon={<Copy className="h-4 w-4" aria-hidden />}
          onClick={() => copy('doctor', doctorUrl)}
        >
          {copied === 'doctor' ? 'Copied' : 'Copy test doctor link'}
        </Button>
      )}
    </Panel>
  );
}

export function ShareCard({ view }: { view: AdminView }) {
  const { copied, copy } = useCopy();
  return (
    <Panel title="Screens">
      <div className="grid gap-2">
        <Button
          variant="quiet"
          size="sm" align="start"
          icon={<ExternalLink className="h-4 w-4" aria-hidden />}
          onClick={() => window.open('/tv', 'olu-tv')}
        >
          Open TV screen
        </Button>
        <Button
          variant="quiet"
          size="sm" align="start"
          icon={<Copy className="h-4 w-4" aria-hidden />}
          onClick={() => copy('guest', view.joinUrl)}
        >
          {copied === 'guest' ? 'Copied' : 'Copy guest link'}
        </Button>
      </div>
    </Panel>
  );
}

/**
 * Downloads everything worth keeping. Fetching first and then offering one
 * button per file keeps each download tied to a click, which browsers require.
 */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function KeepsakeCard() {
  const admin = useAdminSession();
  const [files, setFiles] = useState<ExportFile[] | null>(null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.exportEvent(admin);
      const answers = data.quiz.questions.reduce((sum, q) => sum + q.answers.length, 0);
      const messages = data.messages.filter((m) => !m.removed).length;
      setSummary(
        `${count(data.guests.length, 'guest')}, ${count(data.voting.votes.length, 'vote')}, ` +
          `${count(answers, 'quiz answer')} and ${count(messages, 'message')}.`,
      );
      setFiles(exportFiles(data, new Date().toISOString().slice(0, 10)));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The export could not be prepared. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Keep the evening">
      {files === null ? (
        <>
          <p className="text-sm text-ivory-dim">Votes, quiz answers, scores and every message, ready to save.</p>
          <Button
            className="mt-4"
            variant="quiet"
            size="sm"
            align="start"
            loading={busy}
            icon={<Archive className="h-4 w-4" aria-hidden />}
            onClick={() => void prepare()}
          >
            Prepare downloads
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-ivory-dim" role="status">
            {summary}
          </p>
          <div className="mt-4 grid gap-2">
            {files.map((file) => (
              <Button
                key={file.name}
                variant="quiet"
                size="sm"
                align="start"
                icon={<Download className="h-4 w-4" aria-hidden />}
                onClick={() => downloadFile(file.name, file.content, file.type)}
              >
                {file.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" align="start" loading={busy} onClick={() => void prepare()}>
              Refresh
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-ivory-dim">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** Local development aids. Shown only when the API offers them (the mock or a local server). */
export function PreviewToolsCard({ onChanged }: { onChanged: () => void }) {
  const admin = useAdminSession();
  const dev = api.dev;
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outageLeft, setOutageLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!dev?.outageEndsAt) return;
    const tick = () => {
      const until = dev.outageEndsAt?.() ?? null;
      setOutageLeft(until ? Math.ceil((until - Date.now()) / 1000) : null);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [dev]);

  if (!dev) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Panel title="Preview tools" aside={<Pill tone="lavender">{isMockApi ? 'Mock' : 'Local server'}</Pill>}>
      <div className="grid gap-2">
        <Button
          variant="quiet"
          size="sm"
          align="start"
          disabled={busy}
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          onClick={() => run(() => dev.simulateActivity(admin))}
        >
          Simulate guest activity
        </Button>
        {dev.simulateOutage && (
          <Button
            variant="quiet"
            size="sm"
            align="start"
            disabled={outageLeft !== null}
            icon={<WifiOff className="h-4 w-4" aria-hidden />}
            onClick={() => dev.simulateOutage?.(10_000)}
          >
            {outageLeft !== null ? `Phones and TV offline for ${outageLeft}s` : 'Simulate connection drop'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          align="start"
          icon={<RotateCcw className="h-4 w-4" aria-hidden />}
          onClick={() => setConfirmReset(true)}
        >
          Reset the preview
        </Button>
      </div>
      <ConfirmDialog
        open={confirmReset}
        tone="danger"
        title="Reset the preview?"
        confirmLabel="Reset"
        busy={busy}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await run(() => dev.reset(admin));
          setConfirmReset(false);
        }}
      >
        {isMockApi
          ? 'This clears all guests, votes, answers and messages in this browser.'
          : 'This clears all guests, votes, answers and messages on the local server. Phones will need to join again.'}
      </ConfirmDialog>
    </Panel>
  );
}
