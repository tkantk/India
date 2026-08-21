#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { toMonoWav, toM4a, durationOf } from './lib/encode.mjs'
import { timingsFromAlignment, estimateTimings, cueTimes } from './lib/words.mjs'
import { isCached } from './lib/cache.mjs'

const flag = (name, def) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? def

const providerName = flag('provider', 'say')
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]
const force = process.argv.includes('--force')

const provider = await import(`./tts-providers/${providerName}.mjs`)
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
    // Audio is unchanged; still recompute cue times in case a cue moved.
    timings[line.id] = { ...previous[line.id], cues: cueTimes(line.cues, previous[line.id]) }
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

  timings[line.id] = { audio: rel, duration, ...t, cues: cueTimes(line.cues, t) }
  cache[line.id] = key
  rendered++
  process.stdout.write(`\r  rendered ${rendered}, reused ${reused}   `)
}

// Creator's Multilingual-v2 concurrency limit is 5, so use 4. The local
// draft voice is CPU-bound and gains nothing from parallelism.
const POOL = providerName === 'elevenlabs' ? 4 : 1
const queue = [...lines]
await Promise.all(Array.from({ length: POOL }, async () => {
  for (let line; (line = queue.shift()); ) await renderLine(line)
}))

rmSync(tmp, { recursive: true, force: true })
writeFileSync(TIMINGS, JSON.stringify(timings))
writeFileSync(CACHE, JSON.stringify(cache, null, 2))

const seconds = Object.values(timings).reduce((a, t) => a + t.duration, 0)
console.log(`\nwrote ${Object.keys(timings).length} clips, ${(seconds / 60).toFixed(1)} minutes of narration`)
console.log(`  ${rendered} rendered, ${reused} reused from cache`)
if (provider.charactersSpent) {
  const spent = provider.charactersSpent()
  console.log(`  ${spent.toLocaleString()} characters billed, about $${(spent / 1000 * 0.10).toFixed(2)}`)
}
