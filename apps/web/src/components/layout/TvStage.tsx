import { useLayoutEffect, useState, type ReactNode } from 'react';

export const TV_WIDTH = 1920;
export const TV_HEIGHT = 1080;

export function computeStageScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(viewportWidth / TV_WIDTH, viewportHeight / TV_HEIGHT);
}

/**
 * A fixed 1920×1080 composition scaled to fit any screen. Layouts are designed
 * once in stage pixels, so the TV always shows exactly the intended 16:9 frame.
 * The sky behind it fills any letterbox area.
 */
export function TvStage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(() => computeStageScale(window.innerWidth, window.innerHeight));

  useLayoutEffect(() => {
    const update = () => setScale(computeStageScale(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: TV_WIDTH,
          height: TV_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
