import type { RevealResult } from '@olu/shared';

/**
 * The only place pink and blue exist in the app, and they are used only once
 * the result has arrived. Soft dawn tones, so they sit with champagne and plum
 * instead of shouting over them.
 */
export interface RevealPalette {
  title: string;
  /** The quieter form, for the thank-you screen. */
  short: string;
  line: string;
  accent: string;
  glow: string;
  wash: string;
  confetti: readonly string[];
}

export const REVEAL_PALETTES: Record<RevealResult['result'], RevealPalette> = {
  BOY: {
    title: 'IT’S A BOY!',
    short: 'It’s a boy',
    line: 'A little boy is on his way to our universe.',
    accent: '#A9C2DE',
    glow: 'rgba(169, 194, 222, 0.6)',
    wash: 'rgba(110, 141, 181, 0.42)',
    confetti: ['#A9C2DE', '#C9D9EA', '#7E9CC4', '#D8BD8B', '#FAF7F0'],
  },
  GIRL: {
    title: 'IT’S A GIRL!',
    short: 'It’s a girl',
    line: 'A little girl is on her way to our universe.',
    accent: '#E7B3C1',
    glow: 'rgba(231, 179, 193, 0.6)',
    wash: 'rgba(195, 135, 154, 0.42)',
    confetti: ['#E7B3C1', '#F2D0D8', '#C98FA2', '#D8BD8B', '#FAF7F0'],
  },
};
