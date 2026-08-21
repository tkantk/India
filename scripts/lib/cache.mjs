/**
 * True when a rendered line can be reused as-is: the cache still holds the
 * key a re-hash of the line's current text would produce, the audio file
 * for it exists on disk, and prior timings exist to reuse.
 *
 * Pulled out of tts.mjs so the cost preflight (which decides what counts as
 * "needs rendering" before spending money) and the render loop (which
 * decides what to actually skip) share one definition and cannot drift.
 * `--force` is deliberately not baked in here: each caller layers it on top
 * (`force || !isCached(...)`), because "ignore the cache for lines in
 * scope" and "the cache entry is stale" are different questions.
 */
export function isCached({ cachedKey, currentKey, audioExists, hasPrevious }) {
  return cachedKey === currentKey && audioExists && Boolean(hasPrevious)
}
