#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toMonoWav, toM4a, durationOf } from './lib/encode.mjs'
import { timingsFromAlignment, estimateTimings, cueTimes } from './lib/words.mjs'
import { isCached } from './lib/cache.mjs'

const flag = (name, def) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? def

const providerName = flag('provider', 'say')
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]
const force = process.argv.includes('--force')

// A bare name selects a module from scripts/tts-providers/. A value with a
// path separator in it is imported as-is, which is how scripts/tts.test.mjs
// injects a provider that throws partway through a run without dropping a
// test-only file into the production provider directory.
const provider = await import(
  providerName.includes('/')
    ? pathToFileURL(resolve(providerName)).href
    : `./tts-providers/${providerName}.mjs`,
)
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

/** Every narrated line in the whole corpus, in a stable order. */
function collectLines() {
  const lines = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join('content/places', f), 'utf8'))
    lines.push(p.intro)
    for (const l of Object.values(p.card)) lines.push(l)
    for (const lm of p.landmarks) lines.push(lm.line)
  }
  // Tolerate these being absent: the pipeline is built and tested (Task 5)
  // before the tour and interface copy is written (Task 9). validate-content
  // is what insists they exist.
  if (existsSync('content/tour.json')) {
    lines.push(...JSON.parse(readFileSync('content/tour.json', 'utf8')).beats)
  }
  if (existsSync('content/ui.json')) {
    lines.push(...JSON.parse(readFileSync('content/ui.json', 'utf8')).lines)
  }
  return lines
}

/** Cache key. Regenerating a line costs real money on the paid provider, so
 *  never re-request an unchanged one. Cues are deliberately excluded: moving a
 *  cue changes the timings file but not the audio. */
const keyOf = (line) =>
  createHash('sha256').update(`${provider.signature()} ${line.text}`).digest('hex').slice(0, 16)

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

// Both the cost preflight below and renderLine ask this same question — is
// this line's on-disk audio still good enough to reuse? — via the single
// isCached() import, so they cannot drift apart on the answer. `force` is
// deliberately layered on here rather than folded into isCached() itself.
const cachedFor = (line) => isCached({
  cachedKey: cache[line.id],
  currentKey: keyOf(line),
  audioExists: existsSync(join(OUT_DIR, `${line.id}.m4a`)),
  hasPrevious: previous[line.id],
})

let rendered = 0, reused = 0
const lines = collectLines().filter(l => !only || l.id.startsWith(only))
console.log(`${lines.length} lines, provider "${providerName}"`)

if (providerName === 'elevenlabs') {
  const todo = lines.filter(l => force || !cachedFor(l))
  const chars = todo.reduce((a, l) => a + l.text.length, 0)
  console.log(`  ${todo.length} of ${lines.length} lines need rendering`)
  console.log(`  ${chars.toLocaleString()} characters, about $${(chars / 1000 * 0.10).toFixed(2)}`)
  console.log(`  Creator tier allowance is 220,000 characters per month.`)
  if (!process.argv.includes('--yes')) {
    console.log(`\n  Re-run with --yes to spend these characters.\n`)
    process.exit(0)
  }
}

async function renderLine(line) {
  const key = keyOf(line)
  const rel = `audio/en/${line.id}.m4a`
  const abs = join(OUT_DIR, `${line.id}.m4a`)

  if (!force && cachedFor(line)) {
    // Audio is unchanged; still recompute cue times (and holds) in case a
    // cue moved — and always re-carry `invite` from the content, not the
    // cached entry, so authoring one (or editing its min/max) on an
    // otherwise-unchanged line takes effect without re-rendering audio.
    const prev = previous[line.id]
    timings[line.id] = {
      ...prev,
      invite: line.invite,
      cues: cueTimes(line.cues, prev, prev.duration, line.invite),
    }
    reused++
    return
  }

  const { audioPath, alignment } = await provider.synth(line.text, { tmpDir: tmp, id: line.id })
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

  timings[line.id] = {
    audio: rel,
    duration,
    ...t,
    invite: line.invite,
    cues: cueTimes(line.cues, t, duration, line.invite),
  }
  cache[line.id] = key
  rendered++
  process.stdout.write(`\r  rendered ${rendered}, reused ${reused}   `)
}

// Every line that reaches the end of renderLine has already been paid for on
// the paid provider, so a failure partway through must never throw that away:
// the .m4a files are on disk, and if timings.json and the render cache do not
// record them, the next run re-renders — and re-bills — every one. A quota
// 401, "gave up after 5 attempts", a missing alignment and the zero-duration
// guard all get a run here.
//
// So: a worker that hits an error records it and stops taking new lines
// rather than throwing. Its three siblings finish the line already in flight
// instead of being abandoned mid-request by Promise.all's fast reject, and
// the bookkeeping is written in a finally, which also covers anything that
// throws outside renderLine.
let failure = null
const failed = new Set()

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
  writeFileSync(TIMINGS, JSON.stringify(out))
  writeFileSync(CACHE, JSON.stringify(cache, null, 2))
  return out
}

// Creator's Multilingual-v2 concurrency limit is 5, so use 4. The local
// draft voice is CPU-bound and gains nothing from parallelism.
const POOL = providerName === 'elevenlabs' ? 4 : 1
const queue = [...lines]
let written
try {
  await Promise.all(Array.from({ length: POOL }, async () => {
    for (let line; !failure && (line = queue.shift()); ) {
      try {
        await renderLine(line)
      } catch (err) {
        failed.add(line.id)
        failure ??= err
      }
    }
  }))
} finally {
  // persist() must run first and must not be skippable: every line that
  // reached renderLine is already paid for, so if cleaning up the scratch
  // directory throws (a locked file, a permissions problem, an interrupted
  // filesystem) that must never take the billing bookkeeping down with it.
  written = persist()
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch (err) {
    console.error(`\n  warning: could not remove temp directory ${tmp}: ${err.message}`)
  }
}

const seconds = Object.values(written).reduce((a, t) => a + t.duration, 0)
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
