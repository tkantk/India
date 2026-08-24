/**
 * The drawn marks on the controls.
 *
 * WHY THIS FILE EXISTS. The bar used to carry literal emoji characters in the
 * TSX — `▶ ⏸ ⏳ ↺ 🐢 🔊 🔇 🏠` — which render as the PLATFORM's colour emoji.
 * Apple's turtle and Apple's house were the only illustration style in the
 * app that was not the project's own: a photoreal green tortoise with a
 * gradient shell, two inches from a flat peacock drawn in five colours. They
 * also change with the OS, and they cannot be recoloured, so the one thing a
 * six-year-old's control bar most needs — that the mark and the word read as
 * one object — was the one thing the emoji could not do.
 *
 * These are drawn in the same language as the rest of the book: flat shapes,
 * no gradient, no outline of their own, and `currentColor` throughout, so a
 * glyph is whatever colour the button it sits in is. That is the whole
 * contract — put one anywhere and it inherits.
 *
 * THE WORD IS STILL THE LABEL. Nothing here is allowed to be the only signal:
 * every control carries a visible word beside its mark (Controls.tsx), for a
 * child who is six and may not read confidently, and for one who reads
 * perfectly well but has never seen this app. A glyph is a landmark for
 * finding the button again, not a name for it.
 *
 * One 24-unit box for all of them, so they optically match without anybody
 * tuning sizes per mark, and `aria-hidden` because the word next door is the
 * accessible name.
 */

import type { ReactNode } from 'react'

export type GlyphName =
  | 'play'
  | 'pause'
  | 'loading'
  | 'again'
  | 'slower'
  | 'normal'
  | 'sound-on'
  | 'sound-off'
  | 'home'
  /* The four cards every place carries (`content/schema.ts`'s `card`, whose
     keys are fixed at exactly these four). They are LANDMARKS FOR FINDING
     THE TILE AGAIN, never its name — each tile carries the word "Animal",
     "Food", "Festival", "Hello" beside the mark, same contract as the bar.
     Deliberately generic: the same four marks serve all 36 places, so
     nothing here can be wrong about which animal a particular state has,
     which is exactly the class of error this project keeps catching. */
  | 'animal'
  | 'food'
  | 'festival'
  | 'hello'

/** The mark itself, in a 24x24 box, painted in `currentColor`. */
const MARKS: Record<GlyphName, ReactNode> = {
  play: <path d="M7 4.5 L20 12 L7 19.5 Z" />,

  pause: (
    <>
      <rect x="6" y="4.5" width="4.6" height="15" rx="1.6" />
      <rect x="13.4" y="4.5" width="4.6" height="15" rx="1.6" />
    </>
  ),

  /* An hourglass, and deliberately a still one. The bar disables Play while
     a clip is in flight, and the note in Controls.tsx is explicit that a
     static, honest label is the fix rather than a spinner — a mark that
     span would be a promise of progress nobody is measuring. */
  loading: (
    <>
      <path d="M6 3.5 h12 a1 1 0 0 1 0 2 h-12 a1 1 0 0 1 0-2 Z" />
      <path d="M6 18.5 h12 a1 1 0 0 1 0 2 h-12 a1 1 0 0 1 0-2 Z" />
      <path d="M7.5 5.5 h9 L12 12 Z" />
      <path d="M12 12 L16.5 18.5 h-9 Z" />
    </>
  ),

  /* A circle that comes back round to its own arrowhead. */
  again: (
    <>
      <path
        d="M20 12 A8 8 0 1 1 12 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M12 0.6 L12 7.4 L16.6 4 Z" />
    </>
  ),

  /* A tortoise: shell, neck, head, two feet and a tail. He is the app's own
     drawing now, not Apple's, and the same flat language as the peacock.
     The NECK is what makes him legible at 28px — the first version put a
     round head straight onto the side of a tall dome and read as a
     mushroom. */
  slower: (
    <>
      <path d="M4 15.4 C4 10.6 7.6 7.4 12 7.4 C16.4 7.4 20 10.6 20 15.4 Z" />
      <path
        d="M18.6 14 C20 13 20.8 12 21.4 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="21.6" cy="10.4" r="2" />
      <rect x="5.6" y="15.4" width="3.6" height="3.8" rx="1.7" />
      <rect x="14.8" y="15.4" width="3.6" height="3.8" rx="1.7" />
      <path d="M4.2 14 L1.2 16 L4.2 16.4 Z" />
    </>
  ),

  /* A hare, for the way back to normal speed: two long ears and a run. */
  normal: (
    <>
      <path d="M8.6 8.6 C6.6 6.2 6 3.4 7 2.6 C8 1.8 10 3.6 11 6.6 Z" />
      <path d="M12.6 7 C12.2 4 13.2 1.6 14.4 1.6 C15.6 1.6 16.2 4 15.4 7 Z" />
      <path d="M11.6 8 C15.4 8 18.4 10.8 18.4 14.4 C18.4 18 15.4 20.6 11.6 20.6 C7 20.6 4 18 4 14.4 C4 10.8 7.4 8 11.6 8 Z" />
      <circle cx="8.4" cy="13.4" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),

  'sound-on': (
    <>
      <path d="M4 9.2 h3.6 L12.6 5 v14 L7.6 14.8 H4 Z" />
      <path
        d="M15.6 9 A4.4 4.4 0 0 1 15.6 15 M18.4 6.4 A8 8 0 0 1 18.4 17.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </>
  ),

  /* Sound off is the same speaker with a cross, not a speaker with nothing:
     "no waves" and "waves you cannot see at this size" look identical. */
  'sound-off': (
    <>
      <path d="M4 9.2 h3.6 L12.6 5 v14 L7.6 14.8 H4 Z" />
      <path
        d="M16 9.4 L21.2 14.6 M21.2 9.4 L16 14.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </>
  ),

  home: (
    <>
      <path d="M12 2.6 L22 11.2 h-3 v9.2 h-14 V11.2 H2 Z" />
      <rect x="9.6" y="14" width="4.8" height="6.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),

  /* A paw print: one pad and four toes. Not a species — see the note on
     `GlyphName` above. Every state's animal is different and this mark is
     the same on all 36 tiles, which is the only way a mark can be honest
     about a fact it does not know. */
  animal: (
    <>
      <path d="M12 11.4 C15.6 11.4 18.6 14 18.6 17 C18.6 19.8 16 21.4 12 21.4 C8 21.4 5.4 19.8 5.4 17 C5.4 14 8.4 11.4 12 11.4 Z" />
      <ellipse cx="6.4" cy="9.6" rx="2.3" ry="3" transform="rotate(-18 6.4 9.6)" />
      <ellipse cx="10.4" cy="6.2" rx="2.2" ry="3.1" transform="rotate(-7 10.4 6.2)" />
      <ellipse cx="14.6" cy="6.2" rx="2.2" ry="3.1" transform="rotate(7 14.6 6.2)" />
      <ellipse cx="18.6" cy="9.6" rx="2.3" ry="3" transform="rotate(18 18.6 9.6)" />
    </>
  ),

  /* A bowl with steam coming off it. A bowl rather than a plate because a
     sadya, a thali and a bowl of dal all read as one; and because a bowl at
     28px is a shape, where a plate is a line. */
  food: (
    <>
      <path d="M3 11.6 h18 C21 16.6 17 20.4 12 20.4 C7 20.4 3 16.6 3 11.6 Z" />
      <rect x="1.6" y="9.6" width="20.8" height="2.6" rx="1.3" />
      <path
        d="M9 7.2 C9 5.6 10.6 5.4 10.6 3.6 M15 7.2 C15 5.6 13.4 5.4 13.4 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </>
  ),

  /* A rangoli: the pattern laid on the ground in petals at Onam, Diwali,
     Pongal and half the festivals in the book. Eight petals round a centre
     — a shape a six-year-old can name even at 28px, and one that belongs to
     no single religion or region. */
  festival: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <ellipse cx="12" cy="4.4" rx="1.9" ry="3" />
      <ellipse cx="12" cy="19.6" rx="1.9" ry="3" />
      <ellipse cx="4.4" cy="12" rx="3" ry="1.9" />
      <ellipse cx="19.6" cy="12" rx="3" ry="1.9" />
      <ellipse cx="6.6" cy="6.6" rx="2.6" ry="1.7" transform="rotate(-45 6.6 6.6)" />
      <ellipse cx="17.4" cy="17.4" rx="2.6" ry="1.7" transform="rotate(-45 17.4 17.4)" />
      <ellipse cx="17.4" cy="6.6" rx="2.6" ry="1.7" transform="rotate(45 17.4 6.6)" />
      <ellipse cx="6.6" cy="17.4" rx="2.6" ry="1.7" transform="rotate(45 6.6 17.4)" />
    </>
  ),

  /* A hand raised in greeting. The card is "how people say hello here", and
     a waving hand is the one gesture that means it in every one of the
     twenty-two languages this book is going to have to hold. */
  hello: (
    <>
      <path d="M8.2 12.4 V4.6 a1.5 1.5 0 0 1 3 0 V11 h0.6 V3.2 a1.5 1.5 0 0 1 3 0 V11 h0.6 V5 a1.5 1.5 0 0 1 3 0 v12.2 C18.4 20.4 16 22 13 22 C9.6 22 7.4 20.2 6.2 17 L4.6 12.8 a1.5 1.5 0 0 1 2.6 -1.4 Z" />
    </>
  ),
}

/**
 * `size` is a CSS length, and it is the ONLY thing a caller sets: the box is
 * square, the paint is `currentColor`, and there is no colour prop on
 * purpose. A glyph that could be given its own colour is a glyph that can
 * fall out of step with the label beside it.
 */
export function Glyph({ name, size = '1em' }: { name: GlyphName; size?: string }) {
  return (
    <svg
      className="glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {MARKS[name]}
    </svg>
  )
}
