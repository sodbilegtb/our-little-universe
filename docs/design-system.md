# Design system: "One sky, all night"

Every screen is a window onto the same night sky. The TV, the phones and the host desk share one celestial backdrop, and during Messages each guest's note becomes a star in that sky. The sky is where the boldness goes; everything in front of it stays quiet.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| `night` | `#1C1922` | Page base. A deeper Midnight Plum so stars have depth. |
| `night-deep` | `#15131A` | Inputs, the reveal dimmer. |
| `plum` | `#302B3A` | Raised surfaces (Midnight Plum from the spec). |
| `ivory` | `#FAF7F0` | Text, the QR plate, the doctor's paper. |
| `champagne` | `#D8BD8B` | The one accent: primary actions, starlight, highlights. |
| `sage` | `#A9B7A0` | Done states (completed phases, "On TV"). |
| `lavender` | `#B9B1C8` | Preview and informational labels. |
| `ink` | `#2A2531` | Text on paper (doctor only). |

**Gender neutrality rule:** Boy and Girl always get identical treatment (same card, same pillar, same color) and differ only in their label. No pink or blue exists in the palette. They appear only from the reveal's light burst on, as soft dawn tones defined in one place (`features/reveal/palette.ts`): rose `#E7B3C1` for a girl, dusk blue `#A9C2DE` for a boy, each with a matching glow, wash and confetti set.

## Type

- **Fraunces Variable** for display, with `SOFT 100`, light weight and optical size 144. Rounded serifs give it the feel of a hand-set announcement. Classes: `.type-display`, `.type-display-italic`, `.type-numeral`.
- **Figtree Variable** for UI and body text, at 17px on phones.
- Both are self-hosted via `@fontsource`, so the party makes no third-party font requests.

## Surfaces

- **Phones:** a single centered column (max 28rem) with the main action pinned in thumb reach. Safe-area aware. Inputs are at least 16px, so iOS doesn't zoom.
- **TV:** a fixed 1920×1080 stage (`TvStage`) scaled to fit. Layouts are designed in stage pixels with 120px side and 96px top/bottom margins. No controls and a hidden cursor.
- **Host desk:** a phase timeline on the left; a "Live now" panel with the next action on the right; quiet panels below.
- **Doctor:** the only light surface. Ivory paper with an inset deckle line, ink text, and a wax seal on confirm.

## Motion

- **The sky:** a single canvas (`StarField`) with three depth layers, slow parallax drift and twinkle. It runs outside React, pauses in hidden tabs, and is static under reduced motion.
- **Scene changes:** a soft dissolve with a breath of blur (`sceneVariants`), with children rising in a short stagger.
- **One orchestrated moment per action:**
  - Vote: the chosen card expands and releases light motes.
  - Message: the card glows, dissolves, and a star rises.
  - Quiz answer: the correct option lights up in place.
  - Winner: neutral-colored confetti.
  - Doctor: the wax seal presses down.
- Numbers count with `AnimatedNumber` (direct DOM writes, no re-renders). Countdowns are a single linear CSS-driven animation.
- `MotionConfig reducedMotion="user"` plus a CSS fallback honor `prefers-reduced-motion` everywhere.

## Copy

Sentence case and plain verbs. Spec phrases are used verbatim ("Join the Party", "Your vote is in!", "THE FINAL SECRET"). Errors say what happened and what to do next.
