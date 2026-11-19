import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition, type Transition } from 'motion/react';
import type { RevealView } from '@olu/shared';
import { Confetti } from '@/components/celebration/Confetti';
import { ease } from '@/lib/motion';
import { mulberry32 } from '@/lib/random';
import { emitTvCue } from '@/lib/tvCues';
import { serverNow } from '@/services/sync/serverClock';
import { REVEAL_PALETTES, type RevealPalette } from '@/features/reveal/palette';
import { remainingMs, STAGE_STARTS, type RevealStage } from '@/features/reveal/timeline';
import { useRevealResult, useRevealStage } from '@/features/reveal/useReveal';

/* ---------- geometry (stage pixels, origin at the centre of the 1920×1080 frame) ---------- */

const HEART_SCALE = 17;
const HEART_LIFT = 30;

/** The classic parametric heart, upright, centred on the frame. */
function heartPoint(t: number): { x: number; y: number } {
  const x = 16 * Math.sin(t) ** 3;
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x: x * HEART_SCALE, y: -y * HEART_SCALE - HEART_LIFT };
}

const HEART_PATH = (() => {
  const steps = 160;
  const points = Array.from({ length: steps + 1 }, (_, i) => heartPoint((i / steps) * Math.PI * 2));
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x + 960).toFixed(1)} ${(p.y + 540).toFixed(1)}`).join(' ') + 'Z';
})();

interface Mote {
  id: number;
  home: { x: number; y: number };
  heart: { x: number; y: number };
  flight: { x: number; y: number };
  size: number;
  delay: number;
}

function useMotes(count: number): Mote[] {
  return useMemo(() => {
    const rand = mulberry32(2026);
    return Array.from({ length: count }, (_, i) => {
      const angle = rand() * Math.PI * 2;
      const radius = 420 + rand() * 560;
      const out = 900 + rand() * 700;
      const heading = rand() * Math.PI * 2;
      return {
        id: i,
        home: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.62 },
        heart: heartPoint((i / count) * Math.PI * 2),
        flight: { x: Math.cos(heading) * out, y: Math.sin(heading) * out * 0.7 },
        size: 3.5 + rand() * 4,
        delay: rand(),
      };
    });
  }, [count]);
}

/* ---------- per-stage targets ---------- */

/** How dark the room is, on top of the sky. */
const DARKNESS: Record<RevealStage, number> = {
  hush: 0.55,
  gather: 0.68,
  tension: 0.8,
  countdown: 0.9,
  pause: 0.97,
  burst: 0.25,
  celebrate: 0.3,
};

const STAGE_END: Record<RevealStage, number> = {
  hush: STAGE_STARTS.gather,
  gather: STAGE_STARTS.tension,
  tension: STAGE_STARTS.countdown,
  countdown: STAGE_STARTS.pause,
  pause: STAGE_STARTS.burst,
  burst: STAGE_STARTS.celebrate,
  celebrate: STAGE_STARTS.celebrate + 6_000,
};

const CUE: Record<RevealStage, Parameters<typeof emitTvCue>[0]> = {
  hush: 'reveal-build',
  gather: 'reveal-build',
  tension: 'reveal-build',
  countdown: 'reveal-countdown',
  pause: 'reveal-countdown',
  burst: 'reveal-burst',
  celebrate: 'reveal-celebration',
};

/**
 * The cinematic reveal on the TV, from the moment the host's code is accepted.
 * It follows the server clock (see timeline.ts), asks for the result only at
 * the reveal moment, and picks up at the right point after a refresh.
 */
export function TvRevealSequence({ reveal }: { reveal: RevealView }) {
  const revealAt = Date.parse(reveal.revealAt ?? '');
  if (Number.isNaN(revealAt)) return null;
  return <Sequence revealAt={revealAt} />;
}

function Sequence({ revealAt }: { revealAt: number }) {
  const result = useRevealResult(revealAt);
  const { stage, digit } = useRevealStage(revealAt, result !== null);
  const reduce = useReducedMotion() ?? false;
  // A TV that comes back long after the burst shows the celebration without replaying it.
  const lateJoin = useMemo(() => serverNow() > revealAt + STAGE_STARTS.burst + 6_000, [revealAt]);
  // Seconds left in the current stage, read once when the stage begins.
  const left = useMemo(() => remainingMs(serverNow(), revealAt, STAGE_END[stage]) / 1000, [stage, revealAt]);
  const palette = result ? REVEAL_PALETTES[result.result] : null;

  useEffect(() => emitTvCue(CUE[stage]), [stage]);

  return (
    <div className="absolute inset-0" data-testid="reveal-sequence" data-stage={stage}>
      {/* The colour comes with the burst, not a moment earlier, even if the result is already here. */}
      <RoomLight stage={stage} palette={stage === 'burst' || stage === 'celebrate' ? palette : null} left={left} />
      {!reduce && stage !== 'celebrate' && <Motes stage={stage} left={left} />}
      <Heart stage={stage} left={left} reduce={reduce} />
      <Core stage={stage} left={left} palette={palette} />

      <AnimatePresence>
        {stage === 'hush' && (
          <motion.div
            key="secret"
            className="absolute inset-0 flex flex-col items-center justify-center text-center"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0, transition: { duration: Math.max(1, left - 1), ease: ease.inOut, delay: 0.6 } }}
            exit={{ opacity: 0 }}
          >
            <h1 className="type-display text-[150px] tracking-[0.06em] text-ivory text-glow">THE FINAL SECRET</h1>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {stage === 'countdown' && digit !== null && (
          <motion.p
            key={digit}
            aria-live="assertive"
            className="type-numeral absolute inset-0 flex items-center justify-center text-[420px] leading-none text-ivory"
            style={{ textShadow: '0 0 80px rgba(216,189,139,0.55)' }}
            initial={{ opacity: 0, scale: reduce ? 1 : 1.25, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.35, ease: ease.settle } }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.86, filter: 'blur(6px)', transition: { duration: 0.5, ease: ease.inOut } }}
          >
            {digit}
          </motion.p>
        )}
      </AnimatePresence>

      {palette && (stage === 'burst' || stage === 'celebrate') && (
        <Announcement palette={palette} burst={stage === 'burst' && !lateJoin} reduce={reduce} />
      )}
      {palette && (stage === 'burst' || stage === 'celebrate') && !lateJoin && !reduce && (
        <Confetti count={150} fall={1250} seed={7} colors={palette.confetti} spread={2.6} />
      )}
    </div>
  );
}

/* ---------- layers ---------- */

/** Darkness over the whole screen (letterbox included), and the colour wash after the reveal. */
function RoomLight({ stage, palette, left }: { stage: RevealStage; palette: RevealPalette | null; left: number }) {
  const duration = stage === 'burst' ? 1.6 : Math.min(left, 4);
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-[5]">
      <motion.div
        className="absolute inset-0 bg-night-deep"
        initial={{ opacity: 0.4 }}
        animate={{ opacity: DARKNESS[stage] }}
        transition={{ duration, ease: ease.inOut }}
      />
      {palette && (
        <motion.div
          className="absolute inset-0"
          style={{ background: `radial-gradient(90% 80% at 50% 45%, ${palette.wash}, transparent 70%)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 2.4, ease: ease.drift }}
        />
      )}
    </div>,
    document.body,
  );
}

/** Stars stirring in the dark, then drawing a heart, then folding into one point; at the burst they fly out. */
function Motes({ stage, left }: { stage: RevealStage; left: number }) {
  const motes = useMotes(84);
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {motes.map((m) => {
        let animate: TargetAndTransition;
        let transition: Transition;
        switch (stage) {
          case 'hush':
            // The stars come out one by one and drift a little closer.
            animate = { x: m.home.x * 0.85, y: m.home.y * 0.85, opacity: 0.85, scale: 1 };
            transition = { duration: Math.max(2, left), delay: m.delay * Math.min(2.5, left * 0.5), ease: ease.drift };
            break;
          case 'gather':
            animate = { x: m.heart.x, y: m.heart.y, opacity: 1, scale: 1.1 };
            transition = { duration: Math.max(1, left * 0.5), delay: m.delay * Math.min(1.5, left * 0.15), ease: ease.inOut };
            break;
          case 'tension':
            animate = { x: [m.heart.x, m.heart.x, 0], y: [m.heart.y, m.heart.y, 0], opacity: [0.95, 1, 0.9], scale: [1.2, 1.4, 0.6] };
            transition = { duration: left, times: [0, 0.55, 1], ease: ease.inOut };
            break;
          case 'countdown':
          case 'pause':
            animate = { x: 0, y: 0, opacity: 0, scale: 0.4 };
            transition = { duration: 0.6 };
            break;
          default:
            animate = { x: m.flight.x, y: m.flight.y, opacity: [1, 1, 0], scale: [1.6, 1, 0.5] };
            transition = { duration: 2.2 + m.delay, ease: [0.1, 0.8, 0.3, 1] };
        }
        return (
          <motion.span
            key={m.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-champagne-soft"
            style={{ width: m.size, height: m.size, boxShadow: `0 0 ${m.size * 5}px rgba(233,216,182,0.9)` }}
            initial={{ x: m.home.x * 1.25, y: m.home.y * 1.25, opacity: 0, scale: 1 }}
            animate={animate}
            transition={transition}
          />
        );
      })}
    </div>
  );
}

/** A heart of light, drawn while the stars gather, beating faster until it folds away. */
function Heart({ stage, left, reduce }: { stage: RevealStage; left: number; reduce: boolean }) {
  const visible = stage === 'gather' || stage === 'tension';
  const heartbeat =
    stage === 'tension' && !reduce
      ? {
          scale: [1, 1.06, 1, 1.08, 1, 1.1, 1, 1.12, 1, 0.2],
          opacity: [1, 1, 1, 1, 1, 1, 1, 1, 0.9, 0],
          transition: { duration: left, times: [0, 0.1, 0.2, 0.28, 0.36, 0.43, 0.5, 0.56, 0.62, 1], ease: 'easeInOut' as const },
        }
      : { scale: 1, opacity: visible ? 1 : 0, transition: { duration: 0.8 } };
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 1920 1080"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ transformOrigin: '960px 510px', overflow: 'visible' }}
      initial={{ opacity: 0 }}
      animate={heartbeat}
    >
      <defs>
        <filter id="heart-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="14" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="heart-fill" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#E9D8B6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#D8BD8B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.path
        d={HEART_PATH}
        fill="url(#heart-fill)"
        stroke="#E9D8B6"
        strokeWidth={3}
        strokeLinecap="round"
        filter="url(#heart-glow)"
        initial={{ pathLength: 0, fillOpacity: 0 }}
        animate={
          visible
            ? { pathLength: 1, fillOpacity: 1 }
            : { pathLength: 0, fillOpacity: 0 }
        }
        transition={
          stage === 'gather'
            ? { pathLength: { duration: Math.max(1, left * 0.55), delay: reduce ? 0 : Math.min(2.5, left * 0.22), ease: ease.inOut }, fillOpacity: { duration: 2, delay: Math.max(1, left * 0.8) } }
            : { duration: 0.6 }
        }
      />
    </motion.svg>
  );
}

/** The single point of light everything gathers into; it breathes through the countdown and bursts at the reveal. */
function Core({ stage, left, palette }: { stage: RevealStage; left: number; palette: RevealPalette | null }) {
  const size: Record<RevealStage, number> = { hush: 120, gather: 220, tension: 320, countdown: 560, pause: 70, burst: 2600, celebrate: 1500 };
  const opacity: Record<RevealStage, number> = { hush: 0.25, gather: 0.45, tension: 0.7, countdown: 0.55, pause: 0.9, burst: 0, celebrate: 0.5 };
  const color = palette && (stage === 'burst' || stage === 'celebrate') ? palette.glow : 'rgba(233,216,182,0.75)';
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
        style={{ background: `radial-gradient(closest-side, ${color}, transparent)`, x: '-50%', y: '-50%' }}
        initial={{ width: 80, height: 80, opacity: 0 }}
        animate={
          stage === 'pause'
            ? { width: [60, 90, 60], height: [60, 90, 60], opacity: [0.7, 1, 0.7], transition: { duration: 1.6, repeat: Infinity } }
            : { width: size[stage], height: size[stage], opacity: opacity[stage], transition: { duration: stage === 'burst' ? 1.8 : Math.min(left, 3), ease: ease.drift } }
        }
      />
      {stage === 'burst' && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[240px] w-[240px] rounded-full"
          style={{ background: 'radial-gradient(closest-side, #FFFDF8, rgba(250,247,240,0.85) 35%, rgba(233,216,182,0) 72%)', x: '-50%', y: '-50%' }}
          initial={{ scale: 0.2, opacity: 1 }}
          animate={{ scale: 14, opacity: 0 }}
          transition={{ duration: 1.5, ease: [0.1, 0.9, 0.2, 1] }}
        />
      )}
    </>
  );
}

/** The words. After a late refresh they simply appear, without the burst. */
function Announcement({ palette, burst, reduce }: { palette: RevealPalette; burst: boolean; reduce: boolean }) {
  const enter = burst && !reduce;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center" data-testid="reveal-result">
      <motion.h1
        className="type-display text-[230px] leading-none tracking-[0.02em] text-ivory"
        style={{ textShadow: `0 0 60px ${palette.glow}, 0 0 140px ${palette.glow}` }}
        initial={enter ? { opacity: 0, scale: 0.82, filter: 'blur(16px)' } : { opacity: 0 }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: enter ? 1.4 : 1.2, delay: enter ? 0.25 : 0, ease: ease.settle }}
      >
        {palette.title}
      </motion.h1>
      <motion.p
        className="type-display-italic mt-14 text-[56px]"
        style={{ color: palette.accent }}
        initial={{ opacity: 0, y: enter ? 16 : 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.6, delay: enter ? 2.2 : 0.4, ease: ease.drift }}
      >
        {palette.line}
      </motion.p>
    </div>
  );
}

