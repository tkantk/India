#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toMonoWav, toM4a, durationOf } from './lib/encode.mjs'
import { timingsFromAlignment, estimateTimings, cueTimes } from './lib/words.mjs'
import { isCached, readCacheEntry, providerChanged, signatureFingerprint, billingVerdict } from './lib/cache.mjs'
import { collectRuns, flattenRuns, keysForRun, selectRuns, planRun, applyBatching } from './lib/runs.mjs'

const flag = (name, def) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? def

const providerName = flag('provider', 'say')
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]
const force = process.argv.includes('--force')
const yes = process.argv.includes('--yes')

// A bare name selects a module from scripts/tts-providers/. A value with a
// path separator in it is imported as-is, which is how scripts/tts.test.mjs
// injects a provider that throws partway through a run without dropping a
// test-only file into the production provider directory.
const provider = await import(
  providerName.includes('/')
    ? pathToFileURL(resolve(providerName)).href
    : `./tts-providers/${providerName}.mjs`,
)
const SIGNATURE = provider.signature()

// Overridable so scripts/tts.test.mjs can point at scratch directories
// instead of the tracked public/audio/en and src/data/timings.json — the
// production npm scripts never pass these flags, so they keep the defaults
// below untouched.
const OUT_DIR = flag('audio-dir', 'public/audio/en')
const TIMINGS = flag('timings', 'src/data/timings.json')
const CACHE = flag('cache', 'build/tts-cache.json')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(dirname(TIMINGS), { recursive: true })
mkdirSync(dirname(CACHE), { recursive: true })

// The cache is never wiped wholesale. `force` means "re-render the lines in
// scope even if they are cached" — not "forget every other line's key",
// which would make the next unscoped run re-render, and re-bill, the lot.
// `previous` is also the merge base for `--only` (see below), and was never
// safe to zero on `force` either: --only=rajasthan --force would otherwise
// write a timings file containing only Rajasthan and silently delete every
// other place's entry.
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const previous = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, 'utf8')) : {}
// Start from the previous timings when rendering a subset, or --only=rajasthan
// would write a timings.json containing ONLY Rajasthan and silently delete
// every other clip's entry.
const timings = only ? { ...previous } : {}
const tmp = mkdtempSync(join(tmpdir(), 'tts-'))

// `--only=tour.07` must not render one member of a chained run alone — see
// selectRuns() — so a typo that matches nothing throws rather than silently
// rendering zero lines. Caught here, once, so the script exits with a clear
// message instead of a raw stack trace.
let runs
try {
  runs = selectRuns(collectRuns(), only)
} catch (err) {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
}
const lines = flattenRuns(runs)
console.log(`${lines.length} lines, provider "${providerName}"`)

// --------------------------------------------------------- Task 6a: the guard
//
// `npm run tts:draft` runs --provider=say. Its cache key misses on every
// line the moment a different provider produced them, and until this guard
// existed nothing stopped `say` from silently overwriting a paid clip with
// the macOS robot voice — the --yes gate below only ever protected the
// elevenlabs path. This is provider-agnostic on purpose: refuse to silently
// overwrite clips a different provider produced, regardless of which
// provider is running now.
/** The bit before the first ':' in a signature — "elevenlabs" or "say" —
 *  safe to print even when the rest of the signature is not. */
const providerFamily = (signature) => signature === undefined ? '(none recorded)' : signature.split(':')[0]

const clipsExist = lines.some((l) => existsSync(join(OUT_DIR, `${l.id}.m4a`)))
if (providerChanged({ previousSignature: cache.__signature__, currentSignature: SIGNATURE, clipsExist }) && !yes) {
  // Fingerprints only, never the raw signature: ElevenLabs' signature embeds
  // the account's real voice id, and this message must be safe to appear in
  // a terminal or a CI log.
  console.error(
    `\n  Refusing to render: clips on disk were produced by a different provider.\n` +
    `    previously: provider "${providerFamily(cache.__signature__)}" (${signatureFingerprint(cache.__signature__)})\n` +
    `    now:        provider "${providerName}" (${signatureFingerprint(SIGNATURE)})\n` +
    `\n  Re-run with --yes if you really mean to overwrite them.\n`,
  )
  process.exit(1)
}

// ------------------------------------------------------- plan every run once
//
// Both the cost preflight below and the render loop ask the same question —
// how much of this run needs rendering, and what ids seed it? — through this
// one planRun() call per run, so they cannot drift on the answer, the same
// reason isCached() is shared rather than reimplemented twice.
const isCachedLine = (line, key) => isCached({
  cachedKey: readCacheEntry(cache[line.id]).key,
  currentKey: key,
  audioExists: existsSync(join(OUT_DIR, `${line.id}.m4a`)),
  hasPrevious: Boolean(previous[line.id]),
})

const RUN_NOW = Date.now()
const runPlans = runs.map((run) => {
  const keys = keysForRun(run, SIGNATURE)
  const matches = run.map((line, i) => isCachedLine(line, keys[i]))
  const entries = run.map((line) => readCacheEntry(cache[line.id]))
  const plan = planRun(run, { matches, entries, force, now: RUN_NOW })
  return { run, keys, plan, entries }
})

// ---------------------------------------------------- Task: the batching rule
//
// A DIFFERENT rule from conditioning (see runs.mjs's own comments at length)
// — added after a real incident: three places had eight lines corrected for
// factual accuracy and re-rendered a day after the other twenty-two, and
// even with byte-identical settings the paid provider came back with an
// audibly different take on the second day. It does not reproduce its own
// previous output, so "only the line that changed" is not a safe scope for
// a place's narration — the other nine lines must render again too, in the
// same pass, purely so the whole place is one take. `applyBatching()` does
// the deciding (see its own comment); it never touches `keysForRun`/the
// cache key format, so an untouched place — Odisha, today — is never
// re-billed by a change somewhere else in the corpus.
const { byPlace } = applyBatching(runPlans)

let preflightChars = null

if (providerName === 'elevenlabs') {
  const todo = runPlans.flatMap(({ run, plan }) => run.slice(plan.effectiveStart))
  const chars = todo.reduce((a, l) => a + l.text.length, 0)
  preflightChars = chars
  console.log(`  ${todo.length} of ${lines.length} lines need rendering`)
  console.log(`  ${chars.toLocaleString()} characters, about $${(chars / 1000 * 0.10).toFixed(2)}`)
  console.log(`  Creator tier allowance is 220,000 characters per month.`)

  // Say plainly, before spending anything, that a chained run is one atomic
  // unit: editing any member can re-render the whole thing, never just the
  // line that was edited.
  for (const { run, plan } of runPlans) {
    if (run.length <= 1 || plan.effectiveStart >= run.length) continue
    const scope = plan.effectiveStart === 0
      ? `the whole ${run.length}-line run`
      : `${run.length - plan.effectiveStart} of its ${run.length} lines, from "${run[plan.effectiveStart].id}" onward`
    console.log(
      `  ${run[0].id}..${run[run.length - 1].id} is one chained run (${run.length} lines): ` +
      `this pass renders ${scope}.`,
    )
  }

  // Say the same thing for BATCHING, plainly, and separately, so it is never
  // mistaken for the chained-run message above: editing one line of a place
  // re-renders that place's ten lines, together, and here is what that
  // costs — never chained to one another, still ten independent requests.
  for (const [place, items] of byPlace) {
    const stale = items.filter(({ plan }) => plan.effectiveStart === 0)
    if (stale.length === 0) continue
    const chars = stale.reduce((a, { run }) => a + run[0].text.length, 0)
    console.log(
      `  ${place}.* is a ${items.length}-line batch (never chained — each still its own request): ` +
      `this pass renders all ${stale.length} of its ${items.length} lines, ` +
      `${chars.toLocaleString()} characters, about $${(chars / 1000 * 0.10).toFixed(2)}.`,
    )
  }

  if (!yes) {
    console.log(`\n  Re-run with --yes to spend these characters.\n`)
    process.exit(0)
  }
}

// ------------------------------------------------------------- the render loop

let rendered = 0, reused = 0

/** Audio is unchanged; still recompute cue times (and holds) in case a cue
 *  moved — and always re-carry `invite` from the content, not the cached
 *  entry, so authoring one (or editing its min/max) on an otherwise-unchanged
 *  line takes effect without re-rendering audio. */
function reuseLine(line) {
  const prev = previous[line.id]
  timings[line.id] = {
    ...prev,
    invite: line.invite,
    cues: cueTimes(line.cues, prev, prev.duration, line.invite),
  }
  reused++
}

async function renderOneLine(line, key, { previousRequestIds, nextText }) {
  const rel = `audio/en/${line.id}.m4a`
  const abs = join(OUT_DIR, `${line.id}.m4a`)

  const { audioPath, alignment, requestId } = await provider.synth(line.text, {
    tmpDir: tmp, id: line.id, previousRequestIds, nextText,
  })
  const wav = join(tmp, `${line.id}.wav`)
  toMonoWav(audioPath, wav)
  toM4a(wav, abs, 56000)

  const duration = durationOf(abs)
  // A zero duration means afinfo's output did not match probe()'s regexes —
  // its format varies by macOS version. Left unguarded, estimateTimings
  // would put every word at t=0 and the highlight would never advance.
  if (!(duration > 0)) {
    throw new Error(
      `could not read a duration from ${abs}. Run \`afinfo\` on it by hand and ` +
      `fix the regexes in scripts/lib/encode.mjs — do not ship zero timings.`,
    )
  }
  const t = alignment
    ? timingsFromAlignment(line.text, alignment)
    : estimateTimings(line.text, duration)

  // THE WORDS THE CHILD READS ARE THE REAL SPELLING, not the one the voice
  // was given. `line.text` is the SPOKEN text — respelled where
  // content/pronounce.json says a name misleads the model — and the
  // alignment above is necessarily against that. `line.display` is the
  // authored spelling, and it is what `timings.json`'s `words` must carry,
  // because `ReadAlong.tsx` prints them one span per word and a child
  // learning to read must never see "Kozhi-kode".
  //
  // Safe by construction, not by luck: `respell` refuses any replacement
  // containing whitespace and re-checks the word count, so word i of the
  // spoken text is always word i of the displayed text. Only the SPELLING of
  // a word changes; every start and end time still belongs to it.
  if (line.display) {
    const shown = line.display.trim().split(/\s+/)
    if (shown.length !== t.words.length) {
      throw new Error(
        `pronunciation desync on ${line.id}: ${t.words.length} spoken words but ` +
        `${shown.length} displayed. content/pronounce.json must map one word to one word.`,
      )
    }
    t.words = shown
  }

  timings[line.id] = {
    audio: rel,
    duration,
    ...t,
    invite: line.invite,
    cues: cueTimes(line.cues, t, duration, line.invite),
  }
  cache[line.id] = { key, requestId: requestId ?? null, renderedAt: Date.now() }
  rendered++
  process.stdout.write(`\r  rendered ${rendered}, reused ${reused}   `)
  return requestId
}

// Every line that reaches renderOneLine has already been paid for on the
// paid provider, so a failure partway through must never throw that away:
// the .m4a file is on disk, and if timings.json and the render cache do not
// record it, the next run re-renders — and re-bills — it. A quota 401, "gave
// up after 5 attempts", a missing alignment and the zero-duration guard all
// get a run here.
//
// So: a worker that hits an error records it and stops taking new runs
// rather than throwing. A run already in flight finishes the line it is
// currently on (its request cannot be aborted anyway) and then stops rather
// than continuing to that run's later members — chaining requires each
// request to have actually completed, so there is nothing safe left to send.
// Other workers finish whatever run they are on instead of being abandoned
// mid-request by a fast-rejecting Promise.all.
let failure = null
const failed = new Set()

/** Renders (or reuses) every member of one run, serially — chaining a
 *  request onto the one before it requires that one to have completed, so a
 *  run is inherently a single sequential thread of work, never parallel
 *  internally. Different runs still render in parallel across the pool. */
async function renderRun({ run, keys, plan }) {
  let recentIds = plan.seedIds.slice(-3)
  for (let i = 0; i < run.length; i++) {
    if (failure) return
    const line = run[i]
    if (i < plan.effectiveStart) {
      reuseLine(line)
      continue
    }
    try {
      const nextText = run[i + 1]?.text
      const requestId = await renderOneLine(line, keys[i], {
        previousRequestIds: run.length > 1 && recentIds.length ? recentIds : undefined,
        nextText: run.length > 1 ? nextText : undefined,
      })
      if (requestId) recentIds = [...recentIds, requestId].slice(-3)
    } catch (err) {
      failed.add(line.id)
      failure ??= err
      return
    }
  }
}

/** Write both bookkeeping files. Always runs, however the render loop ended. */
function persist() {
  // Merge over the file read at startup rather than replacing it. A run that
  // died partway holds no entry for the lines it never reached, and writing
  // that thin object would delete theirs — which makes the NEXT run see no
  // previous timing, treat them as uncached, and re-render them. A run that
  // completes still replaces the file wholesale, which is what drops the
  // entries of lines that no longer exist in the content.
  const out = failure ? { ...previous, ...timings } : timings
  // A line whose render threw may have left a truncated .m4a behind, and
  // under --force its cache key can still match. Drop both records so the
  // next run re-renders it rather than trusting half a file.
  for (const id of failed) { delete out[id]; delete cache[id] }
  // The sidecar only ever reflects the provider that most recently actually
  // WROTE something — a run that reused everything from cache never touches
  // it, so a `tts:draft` dry run over an all-cached tree cannot manufacture
  // a false "provider changed" the next time the real provider runs.
  if (rendered > 0) cache.__signature__ = SIGNATURE
  writeFileSync(TIMINGS, JSON.stringify(out))
  writeFileSync(CACHE, JSON.stringify(cache, null, 2))
  return out
}

// Each provider declares its own safe concurrency (ElevenLabs' Creator tier
// allows 5 concurrent requests; tts.mjs uses 4 to leave headroom. The local
// draft voice is CPU-bound and gains nothing from parallelism). The pool now
// holds RUNS, not lines — a run's members are chained and must render one
// after another, but independent runs still render across the pool at once.
const POOL = provider.concurrency ?? 1
const queue = [...runPlans]
let written
try {
  await Promise.all(Array.from({ length: POOL }, async () => {
    for (let item; !failure && (item = queue.shift()); ) {
      await renderRun(item)
    }
  }))
} finally {
  // persist() must run first and must not be skippable: every line that
  // reached renderOneLine is already paid for, so if cleaning up the scratch
  // directory throws (a locked file, a permissions problem, an interrupted
  // filesystem) that must never take the billing bookkeeping down with it.
  written = persist()
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch (err) {
    console.error(`\n  warning: could not remove temp directory ${tmp}: ${err.message}`)
  }
}

const seconds = Object.values(written).reduce((a, t) => a + (t.duration ?? 0), 0)
console.log(`\nwrote ${Object.keys(written).length} clips, ${(seconds / 60).toFixed(1)} minutes of narration`)
console.log(`  ${rendered} rendered, ${reused} reused from cache`)
if (provider.charactersSpent) {
  const spent = provider.charactersSpent()
  // null means the provider sent no character-cost header. Printing "0
  // characters billed, about $0.00" for that reads like a free run and hides
  // whatever was actually spent.
  if (spent === null) {
    console.log(`  characters billed: NOT REPORTED by the provider — no character-cost`)
    console.log(`  header on at least one response. Check your usage page for the real spend.`)
  } else {
    console.log(`  ${spent.toLocaleString()} characters billed, about $${(spent / 1000 * 0.10).toFixed(2)}`)
    // Task 6 Step 4: whether next_text/previous_text characters are billed
    // is undocumented. This is the empirical answer, printed every real run
    // rather than worked out once by hand — see billingVerdict() for why the
    // read has to be three-way, not "unequal, so billed".
    if (preflightChars !== null) {
      const { delta, verdict } = billingVerdict(preflightChars, spent)
      console.log(
        `  preflight estimated ${preflightChars.toLocaleString()} characters; ` +
        `provider billed ${spent.toLocaleString()} (${delta >= 0 ? '+' : ''}${delta.toLocaleString()}): ${verdict}`,
      )
    }
  }
}

if (failure) {
  console.error(`\n${failure.stack ?? failure.message}`)
  console.error(
    `\n  ${rendered} line(s) rendered before this failure are on disk, cached and ` +
    `recorded in\n  ${TIMINGS} — re-running will reuse them rather than re-billing them.`,
  )
  process.exit(1)
}
