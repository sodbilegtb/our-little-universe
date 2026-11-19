import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LogOut } from 'lucide-react';
import type { AdminView } from '@olu/shared';
import { SkyBackdrop } from '@/components/sky/SkyBackdrop';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ConnectionNotice } from '@/components/ui/ConnectionNotice';
import { AdminSignIn } from '@/features/admin/AdminSignIn';
import { NowPanel } from '@/features/admin/NowPanel';
import { PhaseTimeline } from '@/features/admin/PhaseTimeline';
import { GuestsPanel, MessagesPanel, QuizPanel, RevealPanel, VotingPanel } from '@/features/admin/DetailPanels';
import { QuizEditor } from '@/features/admin/QuizEditor';
import { KeepsakeCard, PreviewToolsCard, ShareCard } from '@/features/admin/SideCards';
import { SecretCard } from '@/features/admin/SecretCard';
import { AdminSessionProvider, adminSessionStore } from '@/features/admin/adminSession';
import { useLiveView } from '@/hooks/useLiveView';
import { ApiError, api, isMockApi, type AdminSession } from '@/services/api';
import { sceneVariants } from '@/lib/motion';

export function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(adminSessionStore.read);

  const signOut = useCallback(() => {
    adminSessionStore.clear();
    setSession(null);
  }, []);

  return (
    <div className="min-h-dvh">
      <SkyBackdrop variant="admin" />
      {session ? (
        <AdminSessionProvider session={session}>
          <AdminDashboard session={session} onSignOut={signOut} />
        </AdminSessionProvider>
      ) : (
        <AdminSignIn
          onSignedIn={(next) => {
            adminSessionStore.save(next);
            setSession(next);
          }}
        />
      )}
    </div>
  );
}

function AdminDashboard({ session, onSignOut }: { session: AdminSession; onSignOut: () => void }) {
  const { data: view, refresh, status, error } = useLiveView('admin', () => api.getAdminView(session), [session.token]);

  // The server no longer accepts this session: back to sign-in.
  useEffect(() => {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') onSignOut();
  }, [error, onSignOut]);

  if (!view) return null;

  return (
    <motion.div variants={sceneVariants} initial="initial" animate="animate" className="mx-auto max-w-[1440px] px-6 pb-16 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-4">
          <Wordmark className="text-[1.05rem]" />
          <span className="text-mist">Host desk</span>
          {isMockApi && <Pill tone="lavender">Local preview with mock data</Pill>}
          {!isMockApi && import.meta.env.DEV && <Pill tone="lavender">Local server</Pill>}
          {!isMockApi && !import.meta.env.DEV && view.mode === 'TEST' && <Pill tone="lavender">Test mode</Pill>}
        </div>
        <div className="flex items-center gap-3">
          <ConnectionNotice status={status} variant="admin" />
          <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" aria-hidden />} onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="grid content-start gap-6 lg:sticky lg:top-6">
          <section className="rounded-[1.5rem] border border-ivory/[0.08] bg-night-deep/40 p-3">
            <PhaseTimeline phase={view.phase} />
          </section>
          <SecretCard view={view} onChanged={refresh} />
          <ShareCard view={view} />
          <KeepsakeCard />
          <PreviewToolsCard onChanged={refresh} />
        </aside>

        <div className="grid content-start gap-6">
          <NowPanel view={view} onChanged={refresh} />
          <Stats view={view} />
          <PhaseDetail view={view} onChanged={refresh} />
        </div>
      </div>
    </motion.div>
  );
}

function Stats({ view }: { view: AdminView }) {
  const stats = [
    { label: 'Guests', value: view.guestCount },
    { label: 'Votes', value: view.voting.tally.total },
    view.phase === 'QUIZ'
      ? { label: 'Answers this round', value: view.quiz.answeredCount }
      : { label: 'Messages on TV', value: view.messages.items.filter((m) => m.approved && !m.hidden && !m.removed).length },
    { label: 'Messages', value: view.messages.items.filter((m) => !m.removed).length },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-2 md:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="border-l border-ivory/10 pl-5">
          <dt className="text-sm text-mist">{stat.label}</dt>
          <dd className="type-numeral mt-1 text-[2.6rem] leading-none">
            <AnimatedNumber value={stat.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PhaseDetail({ view, onChanged }: { view: AdminView; onChanged: () => void }) {
  switch (view.phase) {
    case 'LOBBY':
      return (
        <>
          <QuizEditor view={view} onChanged={onChanged} />
          <GuestsPanel view={view} />
        </>
      );
    case 'VOTING':
      return (
        <>
          <VotingPanel view={view} />
          <QuizEditor view={view} onChanged={onChanged} />
        </>
      );
    case 'QUIZ':
      return view.quiz.stage === 'INTRO' ? <QuizEditor view={view} onChanged={onChanged} /> : <QuizPanel view={view} />;
    case 'MESSAGES':
      return <MessagesPanel view={view} onChanged={onChanged} />;
    case 'REVEAL':
      return (
        <>
          <RevealPanel view={view} onChanged={onChanged} />
          <MessagesPanel view={view} onChanged={onChanged} />
        </>
      );
    case 'FINISHED':
      return <MessagesPanel view={view} onChanged={onChanged} />;
  }
}
