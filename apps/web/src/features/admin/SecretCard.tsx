import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Link2, Mail, RotateCcw, Stethoscope, X } from 'lucide-react';
import type { AdminView, CodeEmailStatus, DoctorLinkResult, DoctorStatus, RevealStatus } from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Pill } from '@/components/ui/Pill';
import { api, errorMessage } from '@/services/api';
import { useAdminSession } from './adminSession';
import { Panel } from './Panel';

const DOCTOR_TEXT: Record<DoctorStatus, { label: string; tone: 'neutral' | 'champagne' | 'sage' }> = {
  NOT_STARTED: { label: 'No link yet', tone: 'neutral' },
  LINK_ISSUED: { label: 'Waiting for the doctor', tone: 'champagne' },
  SUBMITTED: { label: 'Answer sealed', tone: 'sage' },
  CODE_SENT: { label: 'Sealed, code emailed', tone: 'sage' },
};

const EMAIL_TEXT: Record<CodeEmailStatus, string> = {
  NONE: 'Not yet',
  PENDING: 'Sending…',
  SENT: 'Sent',
  FAILED: 'Failed. Send it again.',
  SKIPPED: 'No recipients configured',
};

const REVEAL_TEXT: Record<RevealStatus, string> = {
  LOCKED: 'Locked',
  AWAITING_CODE: 'Waiting for the code',
  REVEALING: 'Revealing',
  REVEALED: 'Revealed',
};

const timeFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable on plain http; the link is still visible.
    }
  };
  return { copied, copy };
}

/**
 * The doctor workflow, without ever showing the answer: a one-time doctor
 * link, the state of the sealed answer and the code email, resending the same
 * code, and a deliberate reset. In TEST mode a rehearsal can simulate the doctor.
 */
export function SecretCard({ view, onChanged }: { view: AdminView; onChanged: () => void }) {
  const admin = useAdminSession();
  const [link, setLink] = useState<DoctorLinkResult | null>(null);
  const [testCode, setTestCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetWord, setResetWord] = useState('');
  const { copied, copy } = useCopy();

  const { doctor, reveal, mode } = view;
  const doctorText = DOCTOR_TEXT[doctor.status];
  const sealed = doctor.status === 'SUBMITTED' || doctor.status === 'CODE_SENT';
  const revealStarted = reveal.status === 'REVEALING' || reveal.status === 'REVEALED';

  // The mailer updates the email status outside the event's revision, so look again while it's sending.
  useEffect(() => {
    if (doctor.email.status !== 'PENDING' || !sealed) return;
    const timer = window.setInterval(onChanged, 4000);
    return () => window.clearInterval(timer);
  }, [doctor.email.status, sealed, onChanged]);

  // A link is shown once; hide it as soon as the doctor has used it.
  useEffect(() => {
    if (sealed) setLink(null);
  }, [sealed]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setNotice(null);
    try {
      await action();
      onChanged();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="The secret"
      aside={mode === 'TEST' ? <Pill tone="lavender">Test mode</Pill> : <Pill tone="champagne">Live</Pill>}
    >
      <dl className="grid gap-3 text-[0.95rem]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-mist">Doctor</dt>
          <dd>
            <Pill tone={doctorText.tone}>{doctorText.label}</Pill>
          </dd>
        </div>
        {sealed && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-mist">Code email</dt>
            <dd className={doctor.email.status === 'FAILED' ? 'text-champagne' : 'text-ivory-dim'}>
              {/* Once the reveal has started the code is spent, so there is nothing left to resend. */}
              {doctor.email.status === 'FAILED' && revealStarted ? 'Failed' : EMAIL_TEXT[doctor.email.status]}
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-mist">Reveal</dt>
          <dd className="text-ivory-dim">{REVEAL_TEXT[reveal.status]}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-mist">
        The answer is never shown here. Only the code from the email unlocks it, on the TV.
      </p>

      {link && (
        <div className="mt-5 rounded-2xl border border-champagne/30 bg-night/50 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-ivory-dim">
              Send this link to the doctor only. It works once, until {timeFormat.format(new Date(link.expiresAt))}, and is
              shown only now.
            </p>
            <button
              type="button"
              aria-label="Hide the doctor link"
              onClick={() => setLink(null)}
              className="rounded-full p-1 text-mist hover:text-ivory focus-visible:outline-2 focus-visible:outline-champagne"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-4 flex justify-center rounded-xl bg-paper p-3" role="img" aria-label="QR code of the doctor link">
            <QRCodeSVG value={link.url} size={168} level="M" marginSize={0} fgColor="#2A2531" bgColor="#FAF7F0" />
          </div>
          <p className="mt-3 break-all font-mono text-xs text-mist" data-testid="doctor-link">
            {link.url}
          </p>
          <Button
            className="mt-3"
            variant="quiet"
            size="sm"
            block
            icon={<Copy className="h-4 w-4" aria-hidden />}
            onClick={() => copy(link.url)}
          >
            {copied ? 'Copied' : 'Copy doctor link'}
          </Button>
        </div>
      )}

      {testCode && (
        <div className="mt-5 rounded-2xl border border-lavender/30 bg-night/50 p-4">
          <p className="text-sm text-ivory-dim">Test code from the simulated doctor. It works only in this rehearsal.</p>
          <p className="mt-2 text-center font-mono text-lg tracking-[0.18em] text-ivory" data-testid="test-code">
            {testCode}
          </p>
        </div>
      )}

      <div className="mt-5 grid gap-2">
        {!sealed && !revealStarted && (
          <Button
            variant="quiet"
            size="sm"
            align="start"
            loading={busy === 'link'}
            icon={<Link2 className="h-4 w-4" aria-hidden />}
            onClick={() =>
              run('link', async () => {
                setTestCode(null);
                setLink(await api.createDoctorLink(admin));
              })
            }
          >
            {doctor.status === 'LINK_ISSUED' ? 'Create a new doctor link' : 'Create doctor link'}
          </Button>
        )}
        {sealed && !revealStarted && (
          <Button
            variant="quiet"
            size="sm"
            align="start"
            loading={busy === 'resend'}
            icon={<Mail className="h-4 w-4" aria-hidden />}
            onClick={() =>
              run('resend', async () => {
                await api.resendRevealCode(admin);
                setNotice('The same code is on its way again.');
              })
            }
          >
            Send the code again
          </Button>
        )}
        {mode === 'TEST' && !revealStarted && (
          <Button
            variant="quiet"
            size="sm"
            align="start"
            loading={busy === 'simulate'}
            icon={<Stethoscope className="h-4 w-4" aria-hidden />}
            onClick={() =>
              run('simulate', async () => {
                setLink(null);
                setTestCode((await api.simulateDoctor(admin)).code);
              })
            }
          >
            Simulate the doctor (test)
          </Button>
        )}
        {doctor.status !== 'NOT_STARTED' && !revealStarted && (
          <Button
            variant="ghostDanger"
            size="sm"
            align="start"
            disabled={busy !== null}
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            onClick={() => {
              setResetWord('');
              setConfirmReset(true);
            }}
          >
            Reset the secret
          </Button>
        )}
      </div>
      {notice && (
        <p role="status" className="mt-3 text-sm text-ivory-dim">
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={confirmReset}
        tone="danger"
        title="Reset the secret?"
        confirmLabel="Reset the secret"
        confirmDisabled={resetWord !== 'RESET'}
        busy={busy === 'reset'}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          if (resetWord !== 'RESET') return;
          await run('reset', async () => {
            await api.resetSecret(admin);
            setLink(null);
            setTestCode(null);
          });
          setConfirmReset(false);
        }}
      >
        <p>
          This throws away the sealed answer and its code. The emailed code stops working, and the doctor needs a new
          link to answer again. Nothing is revealed.
        </p>
        <label className="mt-4 block text-sm text-mist" htmlFor="reset-word">
          Type RESET to confirm
        </label>
        <input
          id="reset-word"
          value={resetWord}
          onChange={(event) => setResetWord(event.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="mt-2 h-11 w-full rounded-xl border border-ivory/15 bg-night-deep/60 px-4 font-mono tracking-[0.2em] text-ivory outline-none focus:border-champagne/70"
        />
      </ConfirmDialog>
    </Panel>
  );
}
