import { GuestTitle, Rise, Scene } from '@/components/layout/Scene';
import { Orbit } from '@/components/sky/Orbit';

export function FinishedGuestScreen() {
  return (
    <Scene className="justify-center py-10">
      <Rise className="mx-auto mb-10 w-44">
        <Orbit />
      </Rise>
      <GuestTitle
        title="Thank you for being part of our little universe"
        lead="Your vote, your answers and your message are now part of the story."
      />
    </Scene>
  );
}
