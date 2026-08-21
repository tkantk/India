#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  api, sleep, licencePolicy, attribution, stripQuery, COMMONS, EM_FILTER, UA,
} from './lib/wiki.mjs'
import { toMonoWav, toM4a, durationOf } from './lib/encode.mjs'

const want = JSON.parse(readFileSync('content/sounds.json', 'utf8'))
const CREDITS = 'src/data/sound-credits.json'
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const tmp = mkdtempSync(join(tmpdir(), 'sfx-'))
mkdirSync('public/audio/sfx', { recursive: true })
mkdirSync('public/audio/ambience', { recursive: true })
mkdirSync('src/data', { recursive: true })

/** Commons audio search returns Wiktionary pronunciations: humans saying the
 *  word, not the animal. Without this filter the site ships people talking. */
const PRONUNCIATION = /^(de|en|fr|nl|ru|es|it|pt|pl)-|^ll-q\d+/i

const II_PROPS = {
  prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: EM_FILTER,
}

// Every hit here comes from commons.wikimedia.org itself, which hosts no
// fair-use material at all — so unlike fetch-photos, which asks en.wikipedia
// and has to separate shared Commons files from local fair-use uploads, the
// answer is unconditionally yes. See licencePolicy() for why this cannot be
// read off `imagerepository`: from Commons every file reports "local".
const ON_COMMONS = { hostedOnCommons: true }

const dirFor = kind => (kind === 'sfx' ? 'public/audio/sfx' : 'public/audio/ambience')
const relFor = (kind, id) => `${kind === 'sfx' ? 'audio/sfx' : 'audio/ambience'}/${id}.m4a`

/** The licence rule is shared with the photo pipeline; only the media checks
 *  below it differ. Returns the first hit that passes, or null. */
async function commonsAudio(term) {
  const j = await api(COMMONS, {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '12',
    gsrsearch: `filetype:audio ${term}`, ...II_PROPS,
  })
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index)
  for (const p of pages) {
    if (PRONUNCIATION.test(p.title.replace(/^File:/, ''))) continue
    const ii = p.imageinfo?.[0]; if (!ii) continue
    const licence = licencePolicy(ii, ON_COMMONS)
    if (!licence.ok) { console.log(`    reject ${p.title}: ${licence.why}`); continue }
    return { fileTitle: p.title, ii }
  }
  return null
}

/** Metadata for one already-chosen file, by exact title. Never downloads. */
async function fileInfo(fileTitle) {
  const j = await api(COMMONS, { action: 'query', titles: fileTitle, ...II_PROPS })
  return (j.query?.pages ?? [])[0]?.imageinfo?.[0] ?? null
}

/**
 * The credit record. Deliberately the same attribution shape the photo
 * pipeline writes — artist, licence, licenceShort, licenceUrl,
 * attributionRequired, descriptionUrl, attributionHtml — because seven of
 * these sounds are CC BY-SA 3.0 or 4.0 and are only legally usable if the app
 * can render a credit and a link to the licence. Without those fields it
 * cannot, whatever the interface does.
 */
const creditFor = (kind, item, fileTitle, ii) => ({
  file: relFor(kind, item.id),
  kind,
  url: stripQuery(ii.url),
  fileTitle,
  // Measured from the encoded file, not the requested cap: trim.py passes a
  // source shorter than maxSeconds through untouched, so the elephant is 1.44s
  // even though it was allowed 3.
  seconds: Math.round(durationOf(join(dirFor(kind), `${item.id}.m4a`)) * 100) / 100,
  ...attribution(ii),
})

const problems = []

/**
 * Bring one wanted sound up to date. Audio already on disk is never
 * re-downloaded or re-encoded — but a credit written before the attribution
 * fields existed is refreshed in place from the file it already names, which
 * costs one metadata request and no bytes.
 */
async function grab(kind, item) {
  const have = credits[item.id]
  const out = join(dirFor(kind), `${item.id}.m4a`)

  if (have && existsSync(out)) {
    if (have.attributionHtml) { console.log(`  ${item.id}: already have it`); return }

    let ii
    try {
      ii = await fileInfo(have.fileTitle)
    } catch (err) {
      problems.push(`${item.id}: could not refresh credit — ${err.message}`)
      console.log(`  ${item.id}: REFRESH FAILED (${err.message}), credit left as it was`)
      return
    }
    await sleep(1000)
    if (!ii) {
      problems.push(`${item.id}: ${have.fileTitle} no longer exists on Commons`)
      console.log(`  ${item.id}: ${have.fileTitle} is GONE from Commons`)
      return
    }
    const licence = licencePolicy(ii, ON_COMMONS)
    if (!licence.ok) {
      // Not deleted automatically: a human has to choose the replacement. The
      // non-zero exit stops this passing unnoticed in the meantime.
      problems.push(`${item.id}: ${have.fileTitle} NO LONGER PASSES the licence policy (${licence.why})`)
      console.log(`  ${item.id}: LICENCE NOW FAILS (${licence.why}) — replace ${have.fileTitle}`)
      return
    }
    credits[item.id] = { ...have, ...creditFor(kind, item, have.fileTitle, ii) }
    console.log(`  ${item.id}: credit refreshed — ${credits[item.id].licenceShort}`)
    return
  }

  const hit = await commonsAudio(item.search)
  await sleep(1000)
  if (!hit) { console.log(`  ${item.id}: NOT FOUND for "${item.search}"`); return }

  const res = await fetch(stripQuery(hit.ii.url), { headers: { 'User-Agent': UA } })
  if (!res.ok) { console.log(`  ${item.id}: download HTTP ${res.status}`); return }
  const raw = join(tmp, `${item.id}.src`)
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()))

  const wav = join(tmp, `${item.id}.wav`)
  toMonoWav(raw, wav)

  if (kind === 'ambience') {
    const looped = join(tmp, `${item.id}.loop.wav`)
    execFileSync('python3', ['scripts/lib/loop.py', wav, looped, String(item.seconds ?? 20), '3'],
      { stdio: 'inherit' })
    toM4a(looped, out, 56000)
  } else {
    // Trim. A one-shot fires on a single narrated word, so it must be short —
    // raw Commons sources run to 96 seconds and would still be playing several
    // sentences later, over the top of the narration.
    const cut = join(tmp, `${item.id}.cut.wav`)
    execFileSync('python3', ['scripts/lib/trim.py', wav, cut, String(item.maxSeconds ?? 3)],
      { stdio: 'inherit' })
    toM4a(cut, out, 64000)
  }

  credits[item.id] = creditFor(kind, item, hit.fileTitle, hit.ii)
  console.log(`  ${item.id}: ${credits[item.id].licenceShort} — ${hit.fileTitle}`)
}

/**
 * One bad source must not cost the whole run. loop.py refuses a bed shorter
 * than the loop it was asked for, afconvert refuses a container it cannot
 * decode, and a download can 500 — none of which says anything about the
 * other twenty-two sounds. Unhandled, any of them aborted the run before
 * sound-credits.json was written, throwing away every credit refreshed so far.
 */
async function attempt(kind, item) {
  try {
    await grab(kind, item)
  } catch (err) {
    const first = String(err.message).split('\n')[0]
    problems.push(`${item.id}: ${first}`)
    console.log(`  ${item.id}: FAILED — ${first}`)
  }
}

console.log('sound effects')
for (const s of want.sfx) await attempt('sfx', s)
console.log('ambient beds')
for (const a of want.ambience) await attempt('ambience', a)

writeFileSync(CREDITS, JSON.stringify(credits, null, 2))

const missing = [...want.sfx, ...want.ambience].filter(i => !credits[i.id])
console.log(`\n${Object.keys(credits).length} sounds`)
const attributed = Object.values(credits).filter(c => c.attributionRequired).length
console.log(`${attributed} of them legally require a visible credit and licence link`)
if (problems.length) {
  console.log(`\n${problems.length} credit problem(s):`)
  for (const p of problems) console.log(`  ${p}`)
  process.exitCode = 1
}
if (missing.length) {
  console.log(`${missing.length} not found on Commons. Get a free Freesound token at`)
  console.log(`https://freesound.org/apiv2/apply/ and hand-pick these:`)
  for (const m of missing) console.log(`  ${m.id}  (${m.search})`)
  process.exitCode = 1
}
