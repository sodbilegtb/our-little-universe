import { motion } from 'motion/react';
import { MonitorPlay, Smartphone, SlidersHorizontal, Stethoscope, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { SkyBackdrop } from '@/components/sky/SkyBackdrop';
import { MoonMark } from '@/components/brand/MoonMark';
import { riseIn, sceneVariants } from '@/lib/motion';

interface Surface {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}

const SURFACES: Surface[] = [
  { href: '/tv', title: 'TV', description: 'The big screen. Open it fullscreen on a 16:9 display.', icon: <MonitorPlay /> },
  { href: '/admin', title: 'Host desk', description: 'Run the evening. Any password works in the preview.', icon: <SlidersHorizontal /> },
  { href: '/party', title: 'Guest phone', description: 'What guests see after scanning the QR code.', icon: <Smartphone /> },
  { href: '/party?slot=2', title: 'Second guest', description: 'Another guest in the same browser, for testing.', icon: <UserPlus /> },
  { href: '/admin', title: 'Doctor', description: 'Create a test doctor link on the host desk (The secret).', icon: <Stethoscope /> },
];

/** Local-only start page linking every surface. Production builds redirect "/" to the guest app. */
export function DevLauncher() {
  return (
    <div className="min-h-dvh">
      <SkyBackdrop variant="guest" />
      <motion.main
        variants={sceneVariants}
        initial="initial"
        animate="animate"
        className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16"
      >
        <motion.div variants={riseIn} className="flex items-center gap-4">
          <MoonMark className="h-12 w-12" halo />
          <h1 className="type-display text-[2.8rem]">Our Little Universe</h1>
        </motion.div>
        <motion.p variants={riseIn} className="mt-5 max-w-[56ch] text-ivory-dim">
          Local preview with mock data. Open the TV, the host desk and a guest phone side by side. They stay in sync
          across tabs, so you can walk through the whole evening from the host desk.
        </motion.p>
        <motion.ul variants={riseIn} className="mt-10 grid gap-3 sm:grid-cols-2">
          {SURFACES.map((surface) => (
            <li key={surface.href}>
              <a
                href={surface.href}
                target="_blank"
                rel="noreferrer"
                className="group flex h-full gap-4 rounded-[1.5rem] border border-ivory/10 bg-night-deep/40 p-5 transition-colors hover:border-champagne/40"
              >
                <span className="mt-0.5 text-champagne [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
                  {surface.icon}
                </span>
                <span>
                  <span className="block font-medium text-ivory">{surface.title}</span>
                  <span className="mt-1 block text-sm text-mist">{surface.description}</span>
                </span>
              </a>
            </li>
          ))}
        </motion.ul>
      </motion.main>
    </div>
  );
}
