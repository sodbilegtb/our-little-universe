import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { REVEAL_CODE_ALPHABET } from '@olu/shared';
import { ease } from '@/lib/motion';
import { serverNow } from '@/services/sync/serverClock';

/*
 * The first seconds after the host's code is accepted: the code from the email
 * decodes on the TV. Every character scrambles through letters and little stars,
 * then locks in, left to right; the finished code glows, and its characters rise
 * and dissolve into the stars that gather into the heart next.
 *
 * Timed from the server's startedAt over the length of the build-up (hush), so a
 * refreshed TV shows the same moment. The code is spent once accepted and says
 * nothing about the result.
 */

const STARS = '✦✧⋆✶·';
const POOL = REVEAL_CODE_ALPHABET + STARS;

/** Fractions of the hush: when the first character locks, the spacing, when the code dissolves. */
const FIRST_LOCK = 0.12;
const LOCK_STEP = 0.035;
const DISSOLVE_AT = 0.68;

const randomGlyph = () => POOL[Math.floor(Math.random() * POOL.length)] ?? '✦';

export function CodeDecode({ code, startedAt, hushEndsAt, reduce }: { code: string; startedAt: number; hushEndsAt: number; reduce: boolean }) {
  const chars = useMemo(() => code.replace(/-/g, '').split(''), [code]);
  const length = Math.max(1000, hushEndsAt - startedAt);
  const lockAt = (i: number) => startedAt + length * (FIRST_LOCK + i * LOCK_STEP);
  const dissolveAt = startedAt + length * DISSOLVE_AT;

  const [locked, setLocked] = useState(() => (reduce ? chars.length : chars.filter((_, i) => serverNow() >= lockAt(i)).length));
  const [dissolving, setDissolving] = useState(() => serverNow() >= dissolveAt);
  const slots = useRef<(HTMLSpanElement | null)[]>([]);

  // Lock the characters one by one, then dissolve: a timer per step, no per-frame re-renders.
  useEffect(() => {
    const timers: number[] = [];
    if (!reduce) {
      chars.forEach((_, i) => {
        const wait = lockAt(i) - serverNow();
        if (wait > 0) timers.push(window.setTimeout(() => setLocked((n) => Math.max(n, i + 1)), wait));
      });
    }
    const untilDissolve = dissolveAt - serverNow();
    if (untilDissolve > 0) timers.push(window.setTimeout(() => setDissolving(true), untilDissolve));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [code, startedAt, hushEndsAt, reduce]);

  // The scramble writes straight into the DOM, about 14 times a second.
  useEffect(() => {
    if (reduce || locked >= chars.length) return;
    const timer = window.setInterval(() => {
      slots.current.forEach((slot, i) => {
        if (slot && i >= locked) slot.textContent = randomGlyph();
      });
    }, 70);
    return () => window.clearInterval(timer);
  }, [locked, chars.length, reduce]);

  const complete = locked >= chars.length;

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.8, ease: ease.drift } }}
      exit={{ opacity: 0, transition: { duration: 0.6 } }}
    >
      <motion.h1
        className="type-display text-[92px] tracking-[0.08em] text-ivory text-glow"
        animate={dissolving ? { opacity: 0, y: -24, filter: 'blur(8px)' } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 1.4, ease: ease.inOut }}
      >
        THE FINAL SECRET
      </motion.h1>

      <motion.div
        className="mt-20 flex items-end"
        data-testid="reveal-code"
        aria-label={`Code ${code}`}
        animate={complete && !dissolving && !reduce ? { scale: [1, 1.04, 1] } : { scale: 1 }}
        transition={{ duration: 1.2, ease: ease.inOut }}
      >
        {chars.map((char, i) => {
          const isLocked = i < locked;
          return (
            <span key={i} className="flex items-end">
              {i > 0 && i % 4 === 0 && (
                <motion.span
                  aria-hidden
                  className="mx-6 mb-9 text-[44px] text-champagne"
                  animate={dissolving ? { opacity: 0, y: -80 } : { opacity: complete ? 1 : 0.5 }}
                  transition={{ duration: 1.2, delay: dissolving ? i * 0.04 : 0 }}
                >
                  ✦
                </motion.span>
              )}
              <motion.span
                className="relative flex w-[104px] flex-col items-center"
                animate={dissolving ? { opacity: 0, y: -120, filter: 'blur(10px)', scale: 0.6 } : { opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
                transition={{ duration: 1.5, delay: dissolving ? i * 0.05 : 0, ease: ease.inOut }}
              >
                {isLocked ? (
                  <span
                    className="type-numeral text-[132px] leading-none text-champagne"
                    style={{ textShadow: '0 0 36px rgba(216,189,139,0.75)' }}
                  >
                    {char}
                  </span>
                ) : (
                  // React renders this empty and never touches its text: the scramble owns it.
                  <span
                    ref={(el) => {
                      slots.current[i] = el;
                      if (el && !el.textContent) el.textContent = randomGlyph();
                    }}
                    aria-hidden
                    className="type-numeral text-[132px] leading-none text-ivory-dim/60"
                  />
                )}
                <span
                  aria-hidden
                  className={`mt-4 h-[3px] w-[64px] rounded-full transition-colors duration-300 ${isLocked ? 'bg-champagne' : 'bg-ivory/15'}`}
                  style={{ boxShadow: isLocked ? '0 0 14px rgba(216,189,139,0.8)' : 'none' }}
                />
              </motion.span>
            </span>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
