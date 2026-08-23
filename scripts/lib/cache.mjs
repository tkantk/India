import { createHash } from 'node:crypto'

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

/**
 * A short, stable, non-reversible stand-in for a provider signature, safe to
 * print. A raw `signature()` can embed real configuration — ElevenLabs'
 * includes the account's voice id — and the provider-change guard needs to
 * tell a human "this changed" without ever putting that on their screen or
 * in a CI log. Two calls with the same signature always print the same
 * fingerprint, which is all a human needs to see that it did (or did not)
 * change between runs.
 */
export function signatureFingerprint(signature) {
  if (signature === undefined) return '(none recorded)'
  return createHash('sha256').update(signature).digest('hex').slice(0, 8)
}

/**
 * Normalises one line's entry in the render cache to its three logical
 * fields, regardless of which of two shapes it is on disk in.
 *
 * Every line rendered before this task's prosodic-continuity work has
 * `cache[id]` as a bare string — the render key, and nothing else. Chained
 * runs need more than that per line (the ElevenLabs `request_id` a later
 * member can condition on, and when it was rendered, to judge whether that
 * id is still good), so new entries are `{ key, requestId, renderedAt }`.
 * Reading either shape through this one function is what lets the two
 * co-exist in the same cache file without every old string entry looking
 * like a chain id that has gone stale.
 */
export function readCacheEntry(entry) {
  if (entry === undefined) return { key: undefined, requestId: undefined, renderedAt: undefined }
  if (typeof entry === 'string') return { key: entry, requestId: undefined, renderedAt: undefined }
  return { key: entry.key, requestId: entry.requestId, renderedAt: entry.renderedAt }
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

/**
 * Whether a stored `renderedAt` is recent enough for its `requestId` to still
 * be worth sending as a `previous_request_ids` entry. `now` is a parameter,
 * not `Date.now()` read internally, so a test can assert the exact boundary
 * without waiting two hours or mocking global time.
 */
export function isFresh(renderedAt, now = Date.now()) {
  return typeof renderedAt === 'number' && now - renderedAt < TWO_HOURS_MS
}

/**
 * `tts:draft`'s footgun (Task 6a): `npm run tts:draft` runs `--provider=say`,
 * whose cache key misses on every line the moment a different provider
 * produced them, and nothing before this guard stopped `say` from silently
 * overwriting a paid clip with the macOS robot voice — the `--yes` gate that
 * existed only protected the `elevenlabs` path.
 *
 * True exactly when there IS a previously recorded signature, it differs
 * from the one about to render, and there is something on disk it could
 * destroy. Deliberately narrower than "prompt whenever anything renders":
 * `--force` is a user explicitly asking for an unchanged provider to
 * re-render, and must keep working unprompted (existing tests depend on
 * it); this only fires on an actual provider swap. A signature-less cache —
 * a fresh clone, or a cache written before this check existed — never
 * refuses: it has nothing to compare against, so a fresh tree prompts for
 * nothing.
 */
export function providerChanged({ previousSignature, currentSignature, clipsExist }) {
  return previousSignature !== undefined && previousSignature !== currentSignature && Boolean(clipsExist)
}
