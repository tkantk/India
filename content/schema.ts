import { z } from 'zod'

/**
 * Per-clip character ceilings. These are a COST constraint, not a style guide:
 * speech synthesis bills per character and the whole script must fit the
 * 99,100-character ceiling. The validator enforces both these and the total.
 */
export const LINE_BUDGET = {
  intro: 400,
  card: 170,
  landmark: 300,
  tour: 230,
  ui: 60,
} as const

export type LineKind = keyof typeof LINE_BUDGET

/**
 * The character ceiling for `Landmark.short` — the word a landmark tile
 * actually shows, as opposed to `name` (the real, possibly long, title used
 * for the photo's own alt text). MEASURED, not guessed, against the
 * narrowest real tile this app ever renders: `place-strip.mjs`'s own
 * `build/place-layout.json` puts that at 129.6x120px, an iPad mini in
 * portrait (5 tiles across a 744px screen) — narrower than any landscape
 * rail tile (159px, two columns of a fixed 328px rail).
 *
 * A one-off calibration pass (same technique `place-strip.mjs` itself uses:
 * a real headless Chrome, the real built CSS, `getBoundingClientRect` on the
 * real `.tile__word`) against that narrowest tile found the ACTUAL hazard is
 * not total length but a single unbroken word: "Brihadeeswarar Temple" (21
 * characters) clipped, because "Brihadeeswarar" alone (14 letters, no space
 * to wrap on) is wider than the tile itself, while "Ajanta and Ellora Caves"
 * (23 characters, four words) did not, and neither did "Chhatrapati Shivaji
 * Rly" (23 characters). Every `short` drafted for the four seed places tops
 * out at 18 ("Athirappilly Falls"); this ceiling gives that real worst case
 * genuine headroom while still reading as a TILE label, not a landmark's
 * full title. It is a length guard, not a guarantee — a `short` value still
 * has to be an actual short phrase (two or three ordinary words), not one
 * very long compound word, however few characters it totals.
 */
export const SHORT_BUDGET = 24

/** The single definition of "a word", shared by the schema, the validator,
 *  the timing generator and the app. If these ever disagree, cues drift. */
export function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

/** The one authoritative list of verbs content is allowed to author. Exported
 *  so `scripts/lib/words.mjs` can check its own art/non-art classification
 *  against this instead of hand-copying it — a verb added here and not
 *  classified there must fail loudly, not silently fall back to a constant. */
export const CUE_VERBS = [
  'revealSymbol', 'playSfx', 'highlightState', 'highlightAllStates',
  'highlightUnionTerritories', 'zoomTo', 'traceRiver', 'raiseMountains',
  'unfurlFlag', 'countTo', 'showScript', 'lightNeighbour',
] as const

const CueSchema = z.object({
  /** Index into wordsOf(line.text). NEVER a timestamp — timestamps change
   *  when the voice is re-rendered; word indices do not. */
  word: z.number().int().nonnegative(),
  do: z.enum(CUE_VERBS),
  arg: z.string().optional(),
})

/**
 * What a line's audio invites the child to do once it ends, and how long the
 * tour should wait for them to do it before moving on — see `GrandTour.tsx`'s
 * dwell timer.
 *
 * Authored per line, in content, on purpose — never a hardcoded "this beat is
 * special" in the sequencer. Beat 2 is the first place this fires ("trace the
 * edge with your finger"), but the next plan wants it on roughly 32 more
 * lines, one per state screen, and none of those will share a beat index with
 * this one to key off.
 */
const InviteSchema = z.object({
  /** What the child is being asked to do. Not read by name anywhere on the
   *  advance path — it exists so content can say what it means, and so a
   *  later gesture ("say it back", "find the flag") is a different string
   *  here rather than a second field. */
  gesture: z.string().min(1),
  /** The floor, in seconds: the shortest the tour will ever wait after this
   *  line's audio ends, whether or not a finger ever touches anything. */
  min: z.number().positive(),
  /** The hard cap, in seconds: the longest the tour will ever wait, however
   *  long a finger stays on the corridor. */
  max: z.number().positive(),
}).refine((i) => i.max >= i.min, { message: 'invite.max must be at least invite.min' })

function lineSchema(kind: LineKind) {
  return z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, 'ids are lowercase dot/dash separated'),
    kind: z.literal(kind),
    text: z.string().min(1).max(
      LINE_BUDGET[kind],
      `${kind} line exceeds its ${LINE_BUDGET[kind]}-character budget`,
    ),
    cues: z.array(CueSchema).optional(),
    /** Optional one-shot fired when the tile/scene opens, before narration. */
    sfx: z.string().optional(),
    /** Native-script text shown on screen (the "hello" tile). Not narrated. */
    script: z.string().optional(),
    /** Optional: this line's audio ends with an invitation, and the tour
     *  should hold the beat open rather than advancing the instant the last
     *  word is spoken. See `InviteSchema` above. */
    invite: InviteSchema.optional(),
  }).superRefine((line, ctx) => {
    const n = wordsOf(line.text).length
    for (const [i, cue] of (line.cues ?? []).entries()) {
      if (cue.word >= n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cues', i, 'word'],
          message: `cue word index ${cue.word} is past the last word (${n - 1}) of "${line.id}"`,
        })
      }
    }
  })
}

export const AMBIENCE = [
  'desert', 'ocean', 'forest', 'mountain', 'river', 'city', 'plains', 'temple', 'island',
] as const

/** One lowercase token (letters and hyphens only — "asian-elephant", not
 *  "Asian elephant"), the same shape `content/vocab.json`'s own keys and
 *  `scene`'s own values already use. Enforced here, not left to convention,
 *  because the whole point of `species` is that it is precise enough to
 *  drive a photo query correctly — "elephant" alone fetches whichever
 *  elephant a search engine feels like today, continent included. */
const SPECIES_RE = /^[a-z]+(-[a-z]+)*$/

/** A permissive but real BCP-47 shape: a 2-3 letter primary subtag (covers
 *  every ISO 639-1 code — "hi", "ml", "or" — and the ISO 639-3 codes BCP-47
 *  falls back to when no 639-1 code exists, like Rajasthani's "raj"),
 *  optionally followed by further subtags (region, script, variant). Not
 *  the full RFC 5646 grammar — nothing here needs extension subtags or
 *  private-use tags — just enough to reject "Hindi" or "hindi_IN" and
 *  accept the handful of real tags this app actually uses. */
const BCP47_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

const LandmarkSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  /** The real, full name — used for the photo's own alt text, and anywhere
   *  else the whole title matters. NEVER what a tile shows: see `short`. */
  name: z.string().min(1),
  /** What the landmark's own tile actually prints. A tile is 129.6x120px on
   *  the narrowest real device this app renders (an iPad mini in portrait —
   *  see `SHORT_BUDGET`'s own comment for how that was measured), and
   *  `name` is not written to that constraint: "Chhatrapati Shivaji Maharaj
   *  Terminus" is a real Indian landmark name and does not fit anywhere
   *  close to it. `short` is the tile-length name authored alongside it,
   *  on purpose, rather than truncated at render time. */
  short: z.string().min(1).max(
    SHORT_BUDGET,
    `landmark short name exceeds its ${SHORT_BUDGET}-character tile budget`,
  ),
  /** Fully qualified so the photo fetcher does not land on a disambiguation
   *  page — "Rock Garden" returns a botanical garden in the Netherlands. */
  photoQuery: z.string().min(1),
  /** Key into the illustration scene kit (Plan 2). */
  scene: z.string().min(1),
  line: lineSchema('landmark'),
})

export const PlaceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z-]*$/),
  name: z.string().min(1),
  type: z.enum(['state', 'ut']),
  capital: z.string().min(1),
  ambience: z.enum(AMBIENCE),
  intro: lineSchema('intro'),
  card: z.object({
    animal: lineSchema('card').extend({
      /** The precise animal a photo of this card should show — "dromedary",
       *  never "camel". See this field's own long note in `docs/handover.md`
       *  for why: a bare "camel" photo query returns a two-humped Bactrian,
       *  which does not live in Rajasthan, and this is exactly the class of
       *  factual error this project has been caught making before. Required,
       *  not optional, and checked at build time — a card with no `species`
       *  must fail loudly here, not surface later as a wrong photograph with
       *  nothing pointing back at why. */
      species: z.string().regex(
        SPECIES_RE,
        'species must be a single lowercase token (e.g. "dromedary", not "camel" or "Camel")',
      ),
    }),
    food: lineSchema('card'),
    festival: lineSchema('card'),
    hello: lineSchema('card').extend({
      /** The BCP-47 tag for the language `script` (this same card's native-
       *  text field) is written in. `script` has always held the text
       *  itself; nothing said what language it was in, which is exactly
       *  what picks the right lettering (Devanagari for Hindi, the Malayalam
       *  script for Malayalam, the Odia script for Odia) for whatever
       *  eventually renders it. */
      lang: z.string().regex(BCP47_RE, 'lang must be a BCP-47 language tag (e.g. "hi", "ml", "raj")'),
    }),
  }),
  landmarks: z.array(LandmarkSchema).length(5, 'every place needs exactly five landmarks'),
})

export const TourSchema = z.object({ beats: z.array(lineSchema('tour')).min(1) })
export const UiSchema = z.object({ lines: z.array(lineSchema('ui')).min(1) })

export type Place = z.infer<typeof PlaceSchema>
export type Landmark = z.infer<typeof LandmarkSchema>
export type Cue = z.infer<typeof CueSchema>
export type Invite = z.infer<typeof InviteSchema>
export type Line = {
  id: string
  kind: LineKind
  text: string
  cues?: Cue[]
  sfx?: string
  script?: string
  invite?: Invite
}
export type TourBeat = z.infer<typeof TourSchema>['beats'][number]
export type UiLine = z.infer<typeof UiSchema>['lines'][number]
