/**
 * WHOSE MOMENT THIS IS — the one table that decides what colour a subject
 * is, everywhere it appears.
 *
 * Before this file, a subject's colour was picked by hand, once per file: a
 * tiger is `tone="teal"` because `Tiger.tsx` says so, a lotus is `tone="sky"`
 * because `Lotus.tsx` says so. Two judges of the visual direction split on
 * exactly this — one preferred the direction that lost on looks purely
 * because it had a single table saying "tiger = orange, lotus = pink"
 * instead of eight hand-picks scattered across eight files. This is that
 * table, grafted onto the direction the father actually chose. Plan 3's 32
 * state screens are the reason it exists now rather than later: adding the
 * 33rd subject should mean adding one row here, never re-discovering "pick
 * one of eight page colours" in a new file.
 *
 * THREE ROLES, not two. `page` is the card's own background — what `Card`
 * used to take as a hand-picked `tone` prop. `ink` is the rule drawn round
 * a card's edge and Counter's outer ring — the SAME literal for every
 * subject today (`PALETTE.inkLine`), because the picture-book direction
 * never varies it; it is still a field of its own, rather than a bare
 * import, so a later direction could vary it without moving the table
 * again. `accent` is new: the subject's own defining hue — the thing that
 * is actually orange about the tiger — and it is what the read-along strip
 * (`grandTour.css`'s `.say`) paints itself in, so a child who cannot yet
 * read fluently gets a second, wordless signal that the picture on screen
 * and the words being spoken about it are the same thing.
 *
 * WHY LITERAL HEX, AGAIN. `art/palette.ts` is the mirror of the app's own
 * CSS custom properties, kept literal because WebKit's legacy SVG engine
 * does not resolve `var()` in a presentation attribute — see that file's own
 * note. This table is built entirely out of `PALETTE`'s values for the same
 * reason: every colour here can land in an SVG `fill`/`stroke`, and
 * `Symbol.test.tsx`'s "paints every symbol out of the app palette and
 * nothing else" would fail the moment it did not.
 *
 * ADDING ONE. Pick `page` from the eight established page tones (never the
 * subject's own colour family — a pink lotus on a pink page is a pink
 * page), pick `accent` from whatever this subject is actually drawn in, and
 * leave `ink` as `PALETTE.inkLine` unless a whole new direction says
 * otherwise. Then add the subject's name to `content/vocab.json` (or, for a
 * verb that is its own subject, to `VERB_SUBJECT_KEYS` below) — `SUBJECTS`
 * has no entry `checkSubjectCoverage` will not notice missing.
 */
import { PALETTE as C } from './art/palette.ts'
import { CUE_VERBS } from '../../../content/schema.ts'
import vocab from '../../../content/vocab.json'

export type Subject = {
  /** The card's own background wash. Only `Card` and `Counter`'s disc
   *  consume this — nothing that is not a plate has a page. */
  page: string
  /** The rule drawn round a plate's edge. Currently one literal
   *  (`PALETTE.inkLine`) for every entry — see this file's own top note. */
  ink: string
  /** The subject's own defining hue: what is actually orange about the
   *  tiger, actually pink about the lotus. Drives the read-along strip, and
   *  (where a piece of art is not a plate at all — the river, the sea, the
   *  look-down ring) the one identifying stroke or fill in that art too. */
  accent: string
}

/** What a moment with no subject of its own looks like — the app's own
 *  colours, so nothing ever renders uncoloured. Only reachable through
 *  `subjectOf`, and only for a key nobody coloured (or none at all): every
 *  key `content` can actually produce is checked against `SUBJECTS` at
 *  import time, below. */
export const DEFAULT_SUBJECT: Subject = { page: C.paper, ink: C.inkLine, accent: C.deep }

/**
 * The verbs that are their own subject, because the picture they put up
 * does not change with whatever argument (if any) rides along with it — the
 * counting disc looks the same whether it is counting to 8 or to 28, so it
 * is coloured as `countTo`, never as `'28'`. Contrast `revealSymbol` and
 * `traceRiver` below, whose argument names something with its own identity
 * — a tiger, a river — and so keys the table directly.
 *
 * Exported so `subjectKeyFor`'s classification and `REQUIRED_KEYS`' coverage
 * check are built from the same one list rather than two that could drift.
 */
export const VERB_SUBJECT_KEYS = [
  'unfurlFlag', 'countTo', 'showScript', 'raiseMountains', 'zoomTo',
] as const

const VERB_KEYED = new Set<string>(VERB_SUBJECT_KEYS)
const ARG_KEYED = new Set(['revealSymbol', 'traceRiver'])

export const SUBJECTS: Record<string, Subject> = {
  // -- revealSymbol: keyed by the symbol's own name (content/vocab.json) --
  tiger: { page: C.matTeal, ink: C.inkLine, accent: C.saffron },
  peacock: { page: C.matRose, ink: C.inkLine, accent: C.peacock },
  lotus: { page: C.matSky, ink: C.inkLine, accent: C.rose },
  mango: { page: C.matTeal, ink: C.inkLine, accent: C.mango },
  banyan: { page: C.matSand, ink: C.inkLine, accent: C.leaf },
  dune: { page: C.matRose, ink: C.inkLine, accent: C.sandDeep },
  // matLeaf, not matSun: beat 5 (india-gate) is bracketed by beat 4's and
  // beat 6's counting discs, which are always matSun (countTo is keyed by
  // the verb, not the number — see this file's own note on VERB_SUBJECT_KEYS
  // — so every count in the tour is the same page). `scripts/colour-check.mjs`
  // caught the india-gate/countTo pair sharing matSun back to back: two
  // different subjects on the same page, which is exactly the "beige smear"
  // the no-two-consecutive-beats rule exists to stop.
  'india-gate': { page: C.matLeaf, ink: C.inkLine, accent: C.stoneDeep },
  outline: { page: C.paper, ink: C.inkLine, accent: C.ink },
  'arabian-sea': { page: C.matSky, ink: C.inkLine, accent: C.sea },
  'bay-of-bengal': { page: C.matSky, ink: C.inkLine, accent: C.sea },
  'indian-ocean': { page: C.matSky, ink: C.inkLine, accent: C.sea },

  // -- traceRiver: keyed by the river's own name (content/vocab.json) -----
  ganga: { page: C.matSky, ink: C.inkLine, accent: C.sea },

  // -- verbs that are their own subject (VERB_SUBJECT_KEYS, above) --------
  unfurlFlag: { page: C.paper, ink: C.inkLine, accent: C.flagSaffron },
  countTo: { page: C.matSun, ink: C.inkLine, accent: C.saffron },
  showScript: { page: C.paper, ink: C.inkLine, accent: C.deep },
  raiseMountains: { page: C.matStone, ink: C.inkLine, accent: C.stoneDeep },
  zoomTo: { page: C.matSky, ink: C.inkLine, accent: C.peacock },
}

/**
 * The colours of whatever is on stage. Never throws and never returns
 * undefined: an unrecognised key (or none — nothing on stage) is a beat
 * with no picture, not a bug worth blanking the screen over. Nothing on the
 * cue or beat path may throw, and this sits on that path — `TourStage`
 * calls it on every render while a beat is in the air.
 *
 * Loud failure lives at import time instead — `checkSubjectCoverage` below
 * — for the vocabulary content is actually allowed to name. A key that
 * reaches here and is not in `SUBJECTS` is therefore always a sign that
 * something OTHER than authored content produced it (a stray verb, a typo
 * in a manual test render), which is exactly the case this function is
 * built to survive without crashing the child's tour.
 */
export function subjectOf(key: string | null | undefined): Subject {
  return (key && SUBJECTS[key]) || DEFAULT_SUBJECT
}

/**
 * The subject key for a cue that just fired — exactly what `GrandTour`'s
 * `showing` needs, and the one seam every art component's own `subject`
 * prop has to agree with for "the picture and the words are the same
 * colour" to hold.
 *
 * NOT simply `cue.arg ?? cue.do`. That reads right for `unfurlFlag` and
 * `raiseMountains`, whose cues never carry an argument in `content/tour.json`
 * — but `countTo`, `traceRiver` and `showScript` always do (`"28"`,
 * `"ganga"`, `"namaste"`), so a naive fallback would key the counting disc
 * by the number it is currently showing rather than by "counting", and
 * would never once reach the verb branch it was written to fall back to.
 * `ARG_KEYED`/`VERB_KEYED` say, per verb, which of the two actually
 * identifies the picture.
 *
 * Returns `undefined` for a cue that draws nothing (`playSfx`,
 * `highlightAllStates`, ...) — callers use that to mean "this cue has
 * nothing to say about what is showing," not "colour it as its own verb."
 */
export function subjectKeyFor(cueDo: string, arg: string | undefined): string | undefined {
  if (ARG_KEYED.has(cueDo)) return arg ?? cueDo
  if (VERB_KEYED.has(cueDo)) return cueDo
  return undefined
}

/**
 * Every key `SUBJECTS` must carry an entry for, derived from content's own
 * declared vocabulary — `vocab.json`'s `revealSymbol` and `rivers` lists —
 * rather than a second array hand-typed here to shadow them. `dune` is in
 * this list although no beat in today's `tour.json` names it: `vocab.json`
 * is the CONTRACT ("adding a value here is a promise that something will be
 * drawn for it" — its own words), and `Symbol.tsx` will render it the
 * moment anything does, so it needs a colour now, not the day that happens.
 */
const REQUIRED_KEYS: string[] = [...vocab.revealSymbol, ...vocab.rivers, ...VERB_SUBJECT_KEYS]

/**
 * Pure comparison, no throwing and no module-load side effect — so a test
 * can feed it a deliberately broken table and watch it report the gap,
 * rather than only ever being able to exercise it via the real files
 * agreeing. Mirrors `verbCoverageIssues` in `scripts/lib/words.mjs`, the
 * same shape of guard for the same reason: a hand-copied list is exactly
 * how this project has been bitten before.
 */
export function missingSubjects(required: string[], table: Record<string, unknown>): string[] {
  return required.filter((key) => !(key in table))
}

/**
 * THE LOUD FAILURE. A subject with no entry must not silently render grey
 * — this project has been bitten twice by a hand-copied list that failed
 * silently instead, most recently `ART_VERBS` in the timings generator. So
 * this throws, at import time, the moment `SUBJECTS` is missing a colour
 * `content` is allowed to ask for, or `VERB_SUBJECT_KEYS` names a verb
 * `content/schema.ts` does not: a broken build is a build someone notices,
 * before it ever reaches a child's iPad.
 */
function checkSubjectCoverage() {
  const missing = missingSubjects(REQUIRED_KEYS, SUBJECTS)
  const unknownVerbs = VERB_SUBJECT_KEYS.filter((v) => !(CUE_VERBS as readonly string[]).includes(v))
  if (missing.length > 0 || unknownVerbs.length > 0) {
    throw new Error(
      'src/tour/effects/subject.ts has drifted from the content it colours.' +
      (missing.length > 0
        ? ` SUBJECTS has no entry for: ${missing.join(', ')}.`
        : '') +
      (unknownVerbs.length > 0
        ? ` VERB_SUBJECT_KEYS names a verb content/schema.ts does not: ${unknownVerbs.join(', ')}.`
        : '') +
      ' Give every subject a row in SUBJECTS before content can name it.',
    )
  }
}
checkSubjectCoverage()
