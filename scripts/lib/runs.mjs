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
 * **This reasoning is CONDITIONING, and it is unchanged and still correct —
 * do not start chaining place lines to one another to "fix" batching below.**
 *
 * Every place line ALSO carries a `place` field (that place's own `id`) —
 * consumed by `selectRuns()`'s and `scripts/tts.mjs`'s BATCHING rule, a
 * second and different rule from conditioning: a place's ten lines must be
 * rendered together, in one pass, whenever any one of them needs to render,
 * so they never again end up split across two different paid sessions (see
 * `selectRuns()`'s own comment for the incident this responds to). Batching
 * only ever changes WHICH lines a render pass includes; it never chains one
 * place line's request to another's — every place line is still, and always
 * will be, a run of one, submitted to the provider independently.
 */
export function collectRuns({
  placesDir = 'content/places',
  tourPath = 'content/tour.json',
  uiPath = 'content/ui.json',
} = {}) {
  const runs = []
  for (const f of readdirSync(placesDir).filter((f) => f.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(placesDir, f), 'utf8'))
    runs.push([{ ...p.intro, place: p.id }])
    for (const l of Object.values(p.card)) runs.push([{ ...l, place: p.id }])
    for (const lm of p.landmarks) runs.push([{ ...lm.line, place: p.id }])
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
 *  above); a run of more than one is chained from its own first line. The
 *  BATCHING rule (`selectRuns()`, `scripts/tts.mjs`) never appears here on
 *  purpose — it decides which lines a pass renders, not how a line's own
 *  key is computed, so it cannot invalidate a line whose text never
 *  changed just because a sibling line's did. */
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
 * widens the selection to the run's every member. This is CONDITIONING's own
 * widening rule, unchanged from before this task.
 *
 * BATCHING widens a second, different way, added after a real incident: two
 * places' worth of lines got corrected for factual accuracy and re-rendered
 * a day after the rest of the corpus, and even with byte-identical settings
 * the paid provider came back with an audibly different take — it does not
 * reproduce its own previous output. So a place's ten lines (each still its
 * own run — see `collectRuns()`) must never again be split across two
 * sessions: matching ANY one of a place's lines widens the selection to
 * every run sharing that line's `place`, exactly the way matching one beat
 * of the tour already widened to the whole chained run. The two widenings
 * compose: `--only=tour.02` still only touches the tour (no line in it
 * carries a `place`); `--only=<place>.card.festival` still touches only
 * that one place's own ten lines, never a different place's.
 *
 * This is ONLY selection — which runs are in scope. It does not by itself
 * make an unchanged sibling line re-render; that half of batching (a place
 * renders as a whole once ANY of its lines needs to) is `scripts/tts.mjs`'s
 * own job, done to the already-selected runs' plans, once their individual
 * cache state is known — deliberately not duplicated here, where no cache
 * has been consulted yet.
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
  const places = new Set(matched.flatMap((run) => run.map((line) => line.place).filter((p) => p !== undefined)))
  if (places.size === 0) return matched
  return runs.filter((run) => matched.includes(run) || run.some((line) => places.has(line.place)))
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

/**
 * BATCHING's second half. `selectRuns()` puts every run of a touched place
 * in scope; this decides whether each of THOSE runs actually renders. Takes
 * the array `scripts/tts.mjs` already builds — one `{ run, keys, plan,
 * entries }` per run, `plan` being whatever `planRun`/`planFromCache`
 * already decided from that run's OWN cache state, `entries` its
 * `readCacheEntry()` results — and groups the place ones (every run whose
 * first line carries a `place`, set by `collectRuns()`) by that field.
 *
 * The trigger is deliberately narrower than "any run in the group needs
 * rendering": it is specifically a line that was rendered before under a
 * DIFFERENT key — `entries[0].key !== undefined` (a real prior render
 * exists) and `plan.effectiveStart < run.length` (that key no longer
 * matches) — because that is the one shape a genuine content EDIT takes.
 * A line with NO prior entry at all does not count, even though it also
 * needs rendering: that shape is a brand-new place's first-ever render, or
 * — the incident this distinction was added to fix — a line a PREVIOUS run
 * never reached because it failed partway through. Treating "never
 * rendered" as "edited" would force that run's already-good, already-cached
 * siblings to re-render too, re-billing clips nothing is wrong with, on
 * every retry of a failed render — the exact regression
 * `scripts/tts.test.mjs`'s "batching: editing one line..." suite sits next
 * to and its partial-failure suite caught the first time this shipped.
 *
 * If ANY run in a place's group NEEDS RENDERING, every run in that
 * group is forced to render in full, exactly as `force` would for a single
 * run: `{ effectiveStart: 0, seedIds: [] }`. A group with nothing edited is
 * left completely untouched, plan objects and all — this is what keeps an
 * unedited place (Odisha, today) from ever being re-billed by a change
 * somewhere else in the corpus.
 *
 * "NEEDS RENDERING", not "was edited" — and the distinction was raised in
 * review, so it is written down. The trigger reads `isCached`, which ANDs
 * three things: the cache key still matches, the .m4a still exists, and a
 * previous timings entry exists. Only the first is about an edit. A line
 * whose text is untouched but whose audio file has gone missing — a partial
 * checkout, a half-finished render, a manual delete — also trips it, and
 * forces its nine siblings to re-render.
 *
 * That is correct, and it is why the wording here changed rather than the
 * logic. This rule exists so a place's ten clips all come from ONE provider
 * session; the provider does not reproduce its own previous take, so a line
 * re-rendered alone comes back audibly deeper than its neighbours. That was
 * reported from a real device: three places sounded inconsistent and the one
 * rendered in a single batch did not. If a clip must be re-rendered at all,
 * for any reason whatsoever, then re-rendering it alone reintroduces exactly
 * that seam. The reason it needs rendering is irrelevant; the seam is not.
 *
 * The genuinely-never-rendered exemption above is different and still
 * applies: a line with no cache entry at all has no session to match.
 *
 * Deliberately does not touch `keys` or read `signature` — batching only
 * ever decides which lines a pass RENDERS, never how a line's own cache key
 * is computed, so an unedited sibling line's key still matches its existing
 * cache entry byte-for-byte; this function is the only reason it renders
 * anyway. Mutates each item's `plan` in place (the same objects the caller
 * already holds) and returns `runPlans` back, plus the place grouping the
 * caller needs anyway to report per-place cost before spending anything.
 */
export function applyBatching(runPlans) {
  const byPlace = new Map()
  for (const item of runPlans) {
    const place = item.run[0]?.place
    if (place === undefined) continue
    if (!byPlace.has(place)) byPlace.set(place, [])
    byPlace.get(place).push(item)
  }
  for (const items of byPlace.values()) {
    const anyEdited = items.some(({ run, plan, entries }) =>
      plan.effectiveStart < run.length && entries?.[0]?.key !== undefined)
    if (!anyEdited) continue
    for (const item of items) item.plan = { effectiveStart: 0, seedIds: [] }
  }
  return { runPlans, byPlace }
}
