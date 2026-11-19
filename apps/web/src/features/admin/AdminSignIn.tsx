import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { MoonMark } from '@/components/brand/MoonMark';
import { api, errorMessage, isMockApi, type AdminSession } from '@/services/api';
import { riseIn, sceneVariants } from '@/lib/motion';

export function AdminSignIn({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.adminSignIn(password));
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <motion.main
      variants={sceneVariants}
      initial="initial"
      animate="animate"
      className="grid min-h-dvh place-items-center px-6"
    >
      <form onSubmit={submit} className="w-full max-w-sm" noValidate>
        <motion.div variants={riseIn} className="mb-10 flex flex-col items-center text-center">
          <MoonMark className="h-14 w-14" halo />
          <h1 className="type-display mt-8 text-[2.4rem]">Host desk</h1>
          <p className="mt-3 text-ivory-dim">Sign in to run the celebration.</p>
        </motion.div>
        <motion.div variants={riseIn}>
          <TextField
            label="Host password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error}
            hint={isMockApi && !import.meta.env.VITE_MOCK_ADMIN_PASSWORD ? 'Local preview: any password works.' : undefined}
          />
        </motion.div>
        <motion.div variants={riseIn} className="mt-6">
          <Button type="submit" size="lg" block loading={busy} icon={<Lock className="h-4 w-4" aria-hidden />}>
            Sign in
          </Button>
        </motion.div>
      </form>
    </motion.main>
  );
}
