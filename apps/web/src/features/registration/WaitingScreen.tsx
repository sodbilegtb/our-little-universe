import { GuestTitle, Rise, Scene } from '@/components/layout/Scene';
import { Orbit } from '@/components/sky/Orbit';

interface WaitingScreenProps {
  title: string;
  lead: string;
  footnote?: string;
}

/** The resting state between activities. Also used as the lobby "You're in!" screen. */
export function WaitingScreen({ title, lead, footnote }: WaitingScreenProps) {
  return (
    <Scene className="justify-center py-10">
      <Rise className="mx-auto mb-10 w-56">
        <Orbit />
      </Rise>
      <GuestTitle title={title} lead={lead} />
      {footnote && (
        <Rise className="mt-10 text-center text-sm text-mist">
          <p>{footnote}</p>
        </Rise>
      )}
    </Scene>
  );
}
