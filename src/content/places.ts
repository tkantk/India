/**
 * The authored content for a place, looked up by slug — the FIRST consumer
 * of `content/places/*.json` anywhere in `src/`.
 *
 * FOUR OF THIRTY-SIX FILES EXIST. Rajasthan, Odisha, Kerala and Delhi are
 * written; the other 32 are not, and will not all land at once. So "there is
 * no content for this place" is a first-class answer here, not an exception:
 * `contentFor` returns `undefined` and `PlaceScreen` has a real page for
 * that case. The tour tells every child "tap any state on the map"
 * (`content/tour.json`, beat 14) and that promise has to survive being taken
 * up on a state nobody has written yet.
 *
 * WHY A GLOB AND NOT AN INDEX. An index file listing the four that exist is
 * a hand-copied list, and this project has been bitten twice by exactly that
 * (`ART_VERBS` in the timings generator; the `SUBJECTS` coverage check
 * exists because of it). `import.meta.glob(..., { eager: true })` is derived
 * from the directory itself, so adding `content/places/assam.json` makes
 * Assam's page work with no second edit anywhere — the same property
 * `scripts/lib/runs.mjs` already relies on for the narration cache.
 *
 * `eager: true` means these are ordinary static imports and land in the main
 * bundle. That is correct at 4 files (~9 KB of JSON) and wants revisiting at
 * 36 (~80 KB) — a lazy glob would split them per place, at the cost of an
 * await on arrival. Noted rather than pre-optimised: the audio for one place
 * is 400 KB and is fetched on demand already, so the JSON is not the thing
 * that will hurt.
 */
import type { Place } from '../../content/schema.ts'

const files = import.meta.glob('../../content/places/*.json', { eager: true }) as Record<
  string,
  { default: Place }
>

const BY_SLUG: Record<string, Place> = {}
for (const [path, module] of Object.entries(files)) {
  const slug = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '')
  BY_SLUG[slug] = module.default
}

/** Every place with a written page, in the order a child would meet them —
 *  alphabetical, because nothing better is available and stable beats
 *  clever. Used by the "we have not been here yet" page to offer the ones
 *  that do exist rather than leaving a child at a dead end. */
export const WRITTEN: Place[] = Object.values(BY_SLUG).sort((a, b) =>
  a.name.localeCompare(b.name),
)

/** The authored page for a slug, or `undefined` for one of the 32 that is
 *  not written yet. Never throws: a slug is whatever a finger landed on. */
export function contentFor(slug: string | undefined): Place | undefined {
  return slug ? BY_SLUG[slug] : undefined
}
