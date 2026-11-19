import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { DoctorChoice } from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { MoonMark } from '@/components/brand/MoonMark';
import { api, ApiError, errorMessage } from '@/services/api';
import { cn } from '@/lib/cn';
import { ease } from '@/lib/motion';
import { WaxSeal } from './WaxSeal';

type Step =
  | { name: 'checking' }
  | { name: 'invalid'; message: string }
  | { name: 'choose' }
  | { name: 'confirm' }
  | { name: 'sealing' }
  | { name: 'sealed'; already?: boolean };

const OPTIONS: { choice: DoctorChoice; label: string }[] = [
  { choice: 'BOY', label: 'Boy' },
  { choice: 'GIRL', label: 'Girl' },
];

const stepMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: ease.drift } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.25 } },
};

/**
 * The doctor's private flow. The choice lives only in this component's memory
 * until it is sealed, and it is never displayed again afterwards.
 * Opening or refreshing the page never creates a code.
 */
export function DoctorFlow({ token }: { token: string }) {
  const [step, setStep] = useState<Step>({ name: 'checking' });
  const [mode, setMode] = useState<'TEST' | 'LIVE' | null>(null);
  const [choice, setChoice] = useState<DoctorChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** One id per confirmation: retrying the same confirmation can never seal a second answer. */
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!token) {
      setStep({ name: 'invalid', message: 'This page needs the link the parents sent you.' });
      return;
    }
    api
      .verifyDoctorLink(token)
      .then((result) => {
        if (!active) return;
        setMode(result.mode);
        setStep(result.status === 'SEALED' ? { name: 'sealed', already: true } : { name: 'choose' });
      })
      .catch((reason: unknown) => {
        if (active) setStep({ name: 'invalid', message: errorMessage(reason, 'This link isn’t valid.') });
      });
    return () => {
      active = false;
    };
  }, [token]);

  const seal = async () => {
    if (!choice || !submissionId || step.name === 'sealing') return;
    setStep({ name: 'sealing' });
    setError(null);
    try {
      await api.submitDoctorSelection(token, choice, submissionId);
      setChoice(null); // forget it as soon as the server has it
      setStep({ name: 'sealed' });
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'ALREADY_SUBMITTED') {
        setChoice(null);
        setStep({ name: 'sealed', already: true });
        return;
      }
      setError(errorMessage(reason));
      setStep({ name: 'confirm' });
    }
  };

  const confirmChoice = () => {
    setSubmissionId(crypto.randomUUID());
    setError(null);
    setStep({ name: 'confirm' });
  };

  const chosenLabel = OPTIONS.find((o) => o.choice === choice)?.label;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-ink/80">
          <MoonMark className="h-6 w-6" />
          <span className="type-display-italic text-[1.05rem]">Our Little Universe</span>
        </span>
        {mode === 'TEST' && (
          <span className="rounded-full border border-champagne-deep/50 bg-champagne/25 px-3 py-1 text-xs font-semibold text-ink">
            Test link
          </span>
        )}
      </header>

      <AnimatePresence mode="wait">
        {step.name === 'checking' && (
          <motion.div key="checking" {...stepMotion} className="flex flex-1 items-center justify-center">
            <span className="h-2 w-2 animate-twinkle rounded-full bg-champagne-deep" aria-label="Checking your link" />
          </motion.div>
        )}

        {step.name === 'invalid' && (
          <motion.div key="invalid" {...stepMotion} className="flex flex-1 flex-col justify-center text-center">
            <h1 className="type-display text-[2.3rem] text-ink">This link can’t be used</h1>
            <p className="mt-4 text-ink/70">{step.message}</p>
          </motion.div>
        )}

        {step.name === 'choose' && (
          <motion.div key="choose" {...stepMotion} className="flex flex-1 flex-col">
            <div className="flex-1 pt-14">
              <h1 className="type-display text-[2.5rem] text-ink">What is the baby's gender?</h1>
              <p className="mt-4 flex gap-2.5 text-ink/70">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-champagne-deep" aria-hidden />
                <span>Only you will see this. Please make sure nobody else can see your screen.</span>
              </p>
              <div className="mt-10 grid gap-3" role="radiogroup" aria-label="Baby's gender">
                {OPTIONS.map((option) => {
                  const selected = choice === option.choice;
                  return (
                    <motion.button
                      key={option.choice}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      whileTap={{ scale: 0.985 }}
                      onClick={() => setChoice(option.choice)}
                      className={cn(
                        'flex h-24 items-center justify-between rounded-[1.5rem] border px-7 text-left transition-[border-color,background-color,box-shadow] duration-300',
                        selected
                          ? 'border-ink bg-paper-shade shadow-[0_12px_30px_-18px_rgba(42,37,49,0.7)]'
                          : 'border-ink/15 bg-white/50 hover:border-ink/35',
                      )}
                    >
                      <span className="type-display text-[2.2rem] text-ink">{option.label}</span>
                      <span
                        className={cn(
                          'grid h-7 w-7 place-items-center rounded-full border-2 transition-colors',
                          selected ? 'border-ink' : 'border-ink/25',
                        )}
                      >
                        {selected && <span className="h-3 w-3 rounded-full bg-ink" />}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
            <Button variant="ink" size="lg" block disabled={!choice} onClick={confirmChoice}>
              Continue
            </Button>
          </motion.div>
        )}

        {(step.name === 'confirm' || step.name === 'sealing') && (
          <motion.div key="confirm" {...stepMotion} className="flex flex-1 flex-col">
            <div className="flex-1 pt-14">
              <h1 className="type-display text-[2.5rem] text-ink">Please confirm</h1>
              <p className="mt-6 text-[1.15rem] text-ink/80">You selected</p>
              <p className="type-display mt-1 text-[3.6rem] text-ink">{chosenLabel}</p>
              <p className="mt-8 rounded-2xl border border-ink/10 bg-white/50 p-4 text-[0.98rem] leading-relaxed text-ink/75">
                Once sealed, the answer can’t be changed or viewed on this page again. The parents receive a reveal code
                by email that doesn’t give the answer away.
              </p>
              {error && (
                <p role="alert" className="mt-4 text-[#9a4b40]">
                  {error}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Button variant="ink" size="lg" block loading={step.name === 'sealing'} onClick={seal}>
                Seal my answer
              </Button>
              <Button
                variant="paperGhost"
                size="lg"
                block
                disabled={step.name === 'sealing'}
                icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
                onClick={() => setStep({ name: 'choose' })}
              >
                Go back
              </Button>
            </div>
          </motion.div>
        )}

        {step.name === 'sealed' && (
          <motion.div key="sealed" {...stepMotion} className="flex flex-1 flex-col items-center justify-center text-center">
            <WaxSeal pressed />
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.6, duration: 0.7, ease: ease.drift } }}
            >
              <h1 className="type-display mt-10 text-[2.6rem] text-ink">
                {step.already ? 'Already sealed' : 'Sealed. Thank you.'}
              </h1>
              <p className="mx-auto mt-4 max-w-[30ch] text-ink/70">
                {step.already
                  ? 'An answer has already been sealed with this link, and it can’t be changed here. If something went wrong, please tell the parents.'
                  : 'The parents will receive their official reveal code by email. You can close this page now.'}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
