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

const LandmarkSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  name: z.string().min(1),
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
    animal: lineSchema('card'),
    food: lineSchema('card'),
    festival: lineSchema('card'),
    hello: lineSchema('card'),
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
