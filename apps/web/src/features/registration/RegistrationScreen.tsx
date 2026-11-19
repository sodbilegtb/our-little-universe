import { useState, type FormEvent } from 'react';
import { DISPLAY_NAME_MAX, displayNameSchema, type GuestSession } from '@olu/shared';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { GuestTitle, Rise, Scene } from '@/components/layout/Scene';
import { MoonMark } from '@/components/brand/MoonMark';
import { api } from '@/services/api';
import { actionErrorMessage } from '@/lib/actionError';

export function RegistrationScreen({ onJoined }: { onJoined: (session: GuestSession) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please enter your name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onJoined(await api.registerGuest({ displayName: parsed.data }));
    } catch (reason) {
      setError(actionErrorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <Scene>
      <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
        <div className="flex flex-1 flex-col justify-center py-10">
          <Rise className="mb-8 flex justify-center">
            <MoonMark className="h-16 w-16" halo />
          </Rise>
          <GuestTitle title="Welcome to Our Little Universe" />
          <Rise className="mt-12">
            <TextField
              label="What's your name?"
              name="displayName"
              autoComplete="given-name"
              autoCapitalize="words"
              enterKeyHint="go"
              placeholder="Your name"
              value={name}
              maxLength={DISPLAY_NAME_MAX + 8}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
              error={error}
              hint="This is how you'll appear on the big screen."
            />
          </Rise>
        </div>
        <Rise>
          <Button type="submit" size="lg" block loading={busy}>
            Join the Party
          </Button>
        </Rise>
      </form>
    </Scene>
  );
}
