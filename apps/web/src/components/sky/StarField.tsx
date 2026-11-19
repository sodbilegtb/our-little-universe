import { useEffect, useRef } from 'react';
import { mulberry32 } from '@/lib/random';

interface Star {
  x: number; // 0..1
  y: number; // 0..1
  radius: number;
  alpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  depth: number; // 0 far .. 1 near; controls drift speed
  tint: 0 | 1 | 2; // ivory, champagne, lavender
}

export interface StarFieldProps {
  /** Stars per 10,000 CSS px². Around 1.6 reads as a calm sky. */
  density?: number;
  /** Horizontal drift in CSS px per second for the nearest layer. */
  drift?: number;
  seed?: number;
  className?: string;
}

const TINTS = ['250, 247, 240', '233, 216, 182', '205, 198, 220'] as const;

function createStars(count: number, seed: number): Star[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const depth = rand() ** 2.2; // most stars far away
    const tintRoll = rand();
    return {
      x: rand(),
      y: rand(),
      radius: 0.35 + depth * 1.25 + (rand() < 0.04 ? 0.8 : 0),
      alpha: 0.25 + depth * 0.6 + rand() * 0.15,
      twinkleSpeed: 0.4 + rand() * 1.4,
      twinklePhase: rand() * Math.PI * 2,
      depth,
      tint: tintRoll < 0.78 ? 0 : tintRoll < 0.92 ? 1 : 2,
    };
  });
}

/** Pre-rendered soft glow so bright stars cost one drawImage call each. */
function createGlowSprite(): HTMLCanvasElement {
  const size = 64;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(250, 240, 220, 0.9)');
    gradient.addColorStop(0.18, 'rgba(240, 222, 186, 0.35)');
    gradient.addColorStop(1, 'rgba(216, 189, 139, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return sprite;
}

/**
 * A slowly drifting, twinkling star field drawn on a single canvas.
 * Runs entirely outside React's render cycle, pauses when the tab is hidden,
 * and renders a still sky when the user prefers reduced motion.
 */
export function StarField({ density = 1.6, drift = 4, seed = 7, className }: StarFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const glow = createGlowSprite();
    let stars: Star[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = performance.now();
    let offset = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(900, Math.round(((width * height) / 10_000) * density));
      stars = createStars(count, seed);
    };

    const draw = (time: number) => {
      const dt = Math.min(64, time - lastTime) / 1000;
      lastTime = time;
      const animate = !reducedMotion.matches;
      if (animate) offset += dt * drift;

      ctx.clearRect(0, 0, width, height);
      const t = time / 1000;

      for (const star of stars) {
        const shift = animate ? (offset * (0.15 + star.depth * 0.85)) % width : 0;
        let x = star.x * width - shift;
        if (x < -4) x += width + 8;
        const y = star.y * height;
        const twinkle = animate ? 0.72 + 0.28 * Math.sin(t * star.twinkleSpeed + star.twinklePhase) : 0.9;
        const alpha = star.alpha * twinkle;

        if (star.radius > 1.25) {
          const glowSize = star.radius * 9;
          ctx.globalAlpha = alpha * 0.55;
          ctx.drawImage(glow, x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${TINTS[star.tint]})`;
        ctx.beginPath();
        ctx.arc(x, y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (time: number) => {
      draw(time);
      if (!reducedMotion.matches) frame = requestAnimationFrame(loop);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      lastTime = performance.now();
      frame = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else start();
    };

    resize();
    start();

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion.matches) draw(performance.now());
    });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion.addEventListener('change', start);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', start);
    };
  }, [density, drift, seed]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
