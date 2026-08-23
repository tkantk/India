import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isFresh, readCacheEntry } from './cache.mjs'

/**
 * Every narrated line in the whole corpus, grouped into RUNS: an ordered
 * sequence of lines that must be rendered serially, chained together for
 * prosodic continuity.
 *
 * `content/tour.json`'s `beats` array is the ONLY multi-line run — it is a
 * continuous four-minute read that `GrandTour.tsx` chains beat to beat on
 * `onEnd`, so consecutive beats really are spoken back to back. Every place
 * intro, card line, landmark line and UI line is a run of one: nothing plays
 * them consecutively, and conditioning an independently-tapped card line on
 * whatever happened to render immediately before it would make it open like
 * the continuation of a sentence the child never heard. The grouping is
 * derived from the content, not hand-listed, so the next plan's ~32 state
 * screens inherit runs-of-one for free without anyone updating this file.
 */
export function collectRuns({
  placesDir = 'content/places',
  tourPath = 'content/tour.json',
  uiPath = 'content/ui.json',
} = {}) {
  const runs = []
  for (const f of readdirSync(placesDir).filter((f) => f.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(placesDir, f), 'utf8'))
    runs.push([p.intro])
    for (const l of Object.values(p.card)) runs.push([l])
    for (const lm of p.landmarks) runs.push([lm.line])
  }
  // Tolerate these being absent, same as the pipeline always has: it is
  // built and tested before the tour and interface copy exist.
  if (existsSync(tourPath)) {
    runs.push(JSON.parse(readFileSync(tourPath, 'utf8')).beats)
  }
  if (existsSync(uiPath)) {
    for (const l of JSON.parse(readFileSync(uiPath, 'utf8')).lines) runs.push([l])
  }
  return runs
}

/** Every line, in the same stable order `collectLines()` used to return —
 *  for any caller that only wants "every line," not the run grouping. */
export function flattenRuns(runs) {
  return runs.flat()
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

/**
 * The render cache key exactly as it was computed before this task, for a
 * line that is not part of a multi-line run: `sha256(signature + ' ' + text)`.
 * Runs of one keep using this, and only this, forever — switching them to a
 * chained key format (even a chain of length one) would change every one of
 * their keys at once and turn the ~9,185 characters of content that were
 * never part of a multi-line run into a cache miss the day this ships.
 */
export function legacyKey(signature, text) {
  return sha(`${signature} ${text}`)
}

/**
 * The chained key for one line of a multi-line run: it folds in this line's
 * own text, the text that will be sent as `next_text` (the following line's,
 * or '' for the run's last member), and the key computed for the line
 * before it (or '' for the run's first member) — so a run's keys form a hash
 * chain. Changing any one line's text changes its own key and therefore
 * every key computed after it; it can also change the key of the line
 * immediately before it, because that line's own `next_text` changed too —
 * both are real: ElevenLabs' `next_text` is a prosody lookahead that can
 * audibly affect the segment before it, not bookkeeping.
 */
export function chainedKey(signature, text, nextText, prevKey) {
  return sha(`${signature} ${text}|${nextText ?? ''}|${prevKey ?? ''}`)
}

/** Every key for one run, in order. A run of one uses `legacyKey` (see
 *  above); a run of more than one is chained from its own first line. */
export function keysForRun(run, signature) {
  if (run.length === 1) return [legacyKey(signature, run[0].text)]
  const keys = []
  let prev
  for (const line of run) {
    const nextText = run[keys.length + 1]?.text
    const key = chainedKey(signature, line.text, nextText, prev)
    keys.push(key)
    prev = key
  }
  return keys
}

/**
 * `--only` narrows which lines a run gets. For a multi-line run, rendering
 * only the matched member(s) alone would reintroduce the very seam
 * continuity exists to remove — the beat would render unconditioned, or
 * conditioned on ids nobody threaded this run. So a match against ANY member
 * widens the selection to the run's every member.
 *
 * A value that matches nothing is almost always a typo (`--only=tour.7`
 * instead of `tour.07`), and silently rendering zero lines is a worse
 * failure than refusing outright — so that throws instead.
 */
export function selectRuns(runs, only) {
  if (!only) return runs
  const matched = runs.filter((run) => run.some((line) => line.id.startsWith(only)))
  if (matched.length === 0) {
    throw new Error(`--only=${only} matched no lines. Check the id — a typo here would otherwise render nothing.`)
  }
  return matched
}

/**
 * How much of a run actually needs rendering, and what request ids (if any)
 * should seed the chain into the first line that does.
 *
 * Takes no filesystem access of its own — `matches[i]` (does line i's
 * current key match what's cached, with its audio and prior timings still on
 * disk?) and `entries[i]` (that line's normalised cache entry) are supplied
 * by the caller, which is the only thing with a cache and an `OUT_DIR` to
 * check. That split is what makes this pure enough to unit test with
 * synthetic input.
 *
 * `force` renders the whole run from its own first line, exactly as `force`
 * has always meant "ignore the cache for everything in scope" — and, for a
 * chained run, "in scope" already includes every member once `selectRuns`
 * has widened it, so there is no partial-run form of force to reason about.
 *
 * For a multi-line run whose FIRST stale member (`firstMiss`) is not its
 * first line at all, the lines before it can only be skipped if the ids a
 * fresh render at `firstMiss` would condition on are still good: at most the
 * three entries immediately before it must each carry a `requestId` and be
 * `isFresh`. If even one is missing or stale, the whole run restarts from
 * its own first line — there is no way to condition a request on an id that
 * has expired or never existed.
 */
export function planRun(run, { matches, entries, force = false, now = Date.now() } = {}) {
  if (force) return { effectiveStart: 0, seedIds: [] }

  const firstMiss = matches.findIndex((m) => !m)
  if (firstMiss === -1) return { effectiveStart: run.length, seedIds: [] }

  let effectiveStart = firstMiss
  if (run.length > 1 && firstMiss > 0) {
    const preceding = entries.slice(Math.max(0, firstMiss - 3), firstMiss)
    const chainIntact = preceding.length > 0 && preceding.every((e) => e.requestId && isFresh(e.renderedAt, now))
    if (!chainIntact) effectiveStart = 0
  }

  const seedIds = run.length > 1 && effectiveStart > 0
    ? entries.slice(Math.max(0, effectiveStart - 3), effectiveStart).map((e) => e.requestId).filter(Boolean).slice(-3)
    : []

  return { effectiveStart, seedIds }
}

/** Turns a cache object (`{ [lineId]: entry }`) and a run's keys into the
 *  `matches`/`entries` arrays `planRun` needs, given the caller's own
 *  per-line "is this cached" predicate (which needs the filesystem —
 *  `isCachedLine(line, key)` — so it stays outside this pure module). */
export function planFromCache(run, keys, cache, isCachedLine, opts) {
  const matches = run.map((line, i) => isCachedLine(line, keys[i]))
  const entries = run.map((line) => readCacheEntry(cache[line.id]))
  return planRun(run, { matches, entries, ...opts })
}
