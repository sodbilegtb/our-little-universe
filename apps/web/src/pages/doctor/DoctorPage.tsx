import { useEffect } from 'react';
import { useParams } from 'react-router';
import { DoctorFlow } from '@/features/doctor/DoctorFlow';

/** The doctor's surface is deliberately light: ivory paper, like a sealed letter. */
export function DoctorPage() {
  const { token = '' } = useParams();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', '#FAF7F0');
    return () => {
      if (previous) meta?.setAttribute('content', previous);
    };
  }, []);

  return (
    <div
      className="theme-paper min-h-dvh bg-paper text-ink [color-scheme:light]"
      style={{
        backgroundImage:
          'radial-gradient(120% 70% at 50% 0%, #fffdf8 0%, #faf7f0 45%, #f1ebdf 100%)',
      }}
    >
      <div className="pointer-events-none fixed inset-3 rounded-[1.75rem] border border-champagne-deep/25" aria-hidden />
      <DoctorFlow token={token} />
    </div>
  );
}
