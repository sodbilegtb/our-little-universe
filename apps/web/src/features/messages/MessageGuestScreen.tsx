import { useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PenLine } from 'lucide-react';
import { MESSAGE_MAX, babyMessageSchema, type GuestSession, type GuestView } from '@olu/shared';
import { GuestTitle, Rise, Scene } from '@/components/layout/Scene';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextField';
import { RisingParticles } from '@/components/celebration/RisingParticles';
import { WaitingScreen } from '@/features/registration/WaitingScreen';
import { api } from '@/services/api';
import { withRetry } from '@/services/sync/retry';
import { actionErrorMessage } from '@/lib/actionError';
import { cn } from '@/lib/cn';
import { ease } from '@/lib/motion';

interface MessageGuestScreenProps {
  view: GuestView;
  session: GuestSession;
  onChanged: () => void;
}

type Stage = 'writing' | 'sending' | 'saved';

const newClientId = () => crypto.randomUUID();

export function MessageGuestScreen({ view, session, onChanged }: MessageGuestScreenProps) {
  const { open, myCount, limit } = view.messages;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(myCount > 0 ? 'saved' : 'writing');
  // One id per draft: resending the same draft after a dropped connection can't duplicate it.
  const clientMessageId = useRef(newClientId());
  const reduce = useReducedMotion();

  if (stage === 'writing' && !open) {
    return (
      <WaitingScreen
        title="Messages have closed"
        lead={myCount > 0 ? 'Thank you. Your stars are safe for the little one.' : 'Thank you. Every star is safe for the little one.'}
      />
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = babyMessageSchema.safeParse({ text, clientMessageId: clientMessageId.current });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Write a few words first.');
      return;
    }
    setStage('sending');
    setError(null);
    try {
      await withRetry(() => api.submitMessage(session, parsed.data));
      setStage('saved');
      onChanged();
    } catch (reason) {
      setError(actionErrorMessage(reason));
      setStage('writing');
    }
  };

  const writeAnother = () => {
    clientMessageId.current = newClientId();
    setText('');
    setError(null);
    setStage('writing');
  };

  const canWriteAnother = open && myCount < limit;

  return (
    <Scene className="py-6">
      <AnimatePresence mode="wait" initial={false}>
        {stage !== 'saved' ? (
          <motion.form
            key={`form-${clientMessageId.current}`}
            onSubmit={submit}
            noValidate
            className="flex flex-1 flex-col"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: ease.drift } }}
            exit={{
              opacity: 0,
              scale: 0.86,
              filter: 'blur(10px)',
              transition: { duration: 0.5, ease: ease.inOut },
            }}
          >
            <GuestTitle title="A Message for Our Little One" lead="Leave a little love for the future." />
            <Rise className="mt-8 flex-1">
              <div
                className={cn(
                  'rounded-[1.25rem] transition-shadow duration-700',
                  stage === 'sending' && 'shadow-[0_0_60px_-8px_rgba(216,189,139,0.7)]',
                )}
              >
                <TextArea
                  label={`From ${view.me?.displayName ?? 'you'}`}
                  placeholder="Dear little one…"
                  value={text}
                  disabled={stage === 'sending'}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (error) setError(null);
                  }}
                  count={{ used: text.trim().length, max: MESSAGE_MAX }}
                  error={error}
                />
              </div>
            </Rise>
            <Rise className="mt-6">
              <Button type="submit" size="lg" block loading={stage === 'sending'}>
                Send my star
              </Button>
            </Rise>
          </motion.form>
        ) : (
          <motion.div key="saved" className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="relative mb-14 grid h-40 w-40 place-items-center">
              <motion.div
                animate={reduce ? undefined : { y: [0, -12, 0] }}
                transition={{ duration: 4, delay: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <motion.div
                  className="h-4 w-4 rounded-full bg-ivory shadow-[0_0_30px_10px_rgba(216,189,139,0.6),0_0_80px_30px_rgba(216,189,139,0.25)]"
                  initial={reduce ? false : { y: 240, scale: 2.4, opacity: 0 }}
                  animate={{ y: 0, scale: 1, opacity: 1 }}
                  transition={{ duration: 1.3, ease: ease.settle, opacity: { duration: 0.4 } }}
                />
              </motion.div>
              <RisingParticles burstKey={`message-${myCount}`} count={16} rise={160} />
            </div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.8, duration: 0.8, ease: ease.drift } }}
            >
              <h1 className="type-display text-[2.4rem]">Your little star has been saved.</h1>
              <p className="mx-auto mt-4 max-w-[28ch] text-ivory-dim">
                Look at the big screen. It is shining in the sky right now.
              </p>
            </motion.div>
            {canWriteAnother && (
              <motion.div
                className="mt-12"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 1.6, duration: 0.6 } }}
              >
                <Button variant="quiet" onClick={writeAnother} icon={<PenLine className="h-4 w-4" aria-hidden />}>
                  Write another
                </Button>
                <p className="mt-3 text-sm text-mist">
                  {limit - myCount} more {limit - myCount === 1 ? 'star' : 'stars'} to give
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Scene>
  );
}
