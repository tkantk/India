#!/usr/bin/env node
/**
 * Fetch the sound effects and ambient beds that were PICKED, cut them to
 * size, and write `src/data/sound-credits.json`.
 *
 * Picks live in scripts/sound-picks.json (from iNaturalist, xeno-canto or
 * Freesound, chosen with `npm run sound:candidates`). The older sounds came
 * from Wikimedia Commons and are kept and credit-refreshed from the exact
 * file each names. Nothing is ever searched for and shipped: a sound with no
 * pick stays silent (scripts/lib/soundPlan.mjs says why).
 *
 *   node scripts/fetch-sounds.mjs              the whole job
 *   node scripts/fetch-sounds.mjs --offline    credits only, no network at all
 *
 * `--offline` exists because the credit record has to be able to catch up
 * with the pipeline without re-fetching a byte. Everything that describes
 * what we DID to a file — the `modifications` notice CC BY-SA s3(a)(1)(B)
 * obliges us to publish — is derived from local parameters and the duration
 * already measured off the encoded file, so it can be regenerated for audio
 * that is already on disk. Nothing is downloaded, nothing is re-encoded, and
 * sounds that were never found stay not-found.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  api, sleep, licencePolicy, attribution, stripQuery, COMMONS, EM_FILTER, UA,
} from './lib/wiki.mjs'
import { attributionFor, licenceOk } from './lib/media-sources.mjs'
import { toMonoWav, toM4a, durationOf } from './lib/encode.mjs'
import { LOOP, TRIM, modificationsFor } from './lib/soundEdits.mjs'
import { nextStep } from './lib/soundPlan.mjs'

/** No network at all: refresh what can be derived from disk, and stop. */
const OFFLINE = process.argv.includes('--offline')

const want = JSON.parse(readFileSync('content/sounds.json', 'utf8'))

/**
 * RECORDINGS PICKED FROM SOURCES BEYOND COMMONS — iNaturalist, xeno-canto,
 * Freesound. Commons has almost no real recordings of Indian wildlife or
 * Indian places; these do. Each pick is the exact candidate
 * `npm run sound:candidates` found and measured, copied with its licence,
 * recordist and page, plus:
 *   start  where the cut begins — the measured best moment, because a field
 *          recording rarely opens on the sound itself (trim.py / loop.py)
 *   why    the measurement it was chosen on
 * A pick overrides the Commons search for that id. Nothing here is chosen by
 * the script; see scripts/sound-picks.json's own `_how` note.
 */
const PICKS_FILE = 'scripts/sound-picks.json'
const PICKS = existsSync(PICKS_FILE) ? JSON.parse(readFileSync(PICKS_FILE, 'utf8')).picks ?? {} : {}
const CREDITS = 'src/data/sound-credits.json'
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const tmp = mkdtempSync(join(tmpdir(), 'sfx-'))
mkdirSync('public/audio/sfx', { recursive: true })
mkdirSync('public/audio/ambience', { recursive: true })
mkdirSync('src/data', { recursive: true })

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
 *
 * Plus one field the photo pipeline has no need of: `modifications`. Photos
 * are server-rendered thumbnails stored byte-for-byte as Wikimedia sent them.
 * These sounds are cut, normalised and looped, which makes them Adapted
 * Material — see scripts/lib/soundEdits.mjs for why, and for where the
 * sentence comes from.
 */
const creditFor = (kind, item, fileTitle, ii) => {
  // Measured from the encoded file, not the requested cap: trim.py passes a
  // source shorter than maxSeconds through untouched, so the elephant is 1.44s
  // even though it was allowed 3.
  const seconds = Math.round(durationOf(join(dirFor(kind), `${item.id}.m4a`)) * 100) / 100
  return {
    file: relFor(kind, item.id),
    kind,
    url: stripQuery(ii.url),
    fileTitle,
    seconds,
    modifications: modificationsFor(kind, item, seconds),
    ...attribution(ii),
  }
}

const problems = []

/**
 * Bring one wanted sound up to date. Audio already on disk is never
 * re-downloaded or re-encoded — but a credit written before the attribution
 * fields existed is refreshed in place from the file it already names, which
 * costs one metadata request and no bytes.
 */
/** Download, cut and credit one picked recording. */
async function fetchPick(kind, item, pick) {
  const out = join(dirFor(kind), `${item.id}.m4a`)
  const lic = licenceOk(pick)
  if (!lic.ok) {
    problems.push(`${item.id}: pick ${pick.source}:${pick.ref} licence "${pick.licence}" does not pass`)
    console.log(`  ${item.id}: PICK REJECTED — licence ${pick.licence}`)
    return
  }
  const res = await fetch(pick.download, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  if (!res.ok) { console.log(`  ${item.id}: pick download HTTP ${res.status}`); return }
  const raw = join(tmp, `${item.id}.pick`)
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()))
  const wav = join(tmp, `${item.id}.wav`)
  toMonoWav(raw, wav)
  const start = String(pick.start ?? 0)
  if (kind === 'ambience') {
    const looped = join(tmp, `${item.id}.loop.wav`)
    execFileSync('python3', ['scripts/lib/loop.py', wav, looped,
      String(item.seconds ?? LOOP.defaultSeconds), String(LOOP.crossfadeSeconds), start], { stdio: 'inherit' })
    toM4a(looped, out, 56000)
  } else {
    const cut = join(tmp, `${item.id}.cut.wav`)
    execFileSync('python3', ['scripts/lib/trim.py', wav, cut,
      String(item.maxSeconds ?? TRIM.defaultMaxSeconds), start], { stdio: 'inherit' })
    toM4a(cut, out, 64000)
  }
  const seconds = Math.round(durationOf(out) * 100) / 100
  credits[item.id] = {
    file: relFor(kind, item.id),
    kind,
    url: pick.download,
    fileTitle: pick.title,
    seconds,
    modifications: modificationsFor(kind, { ...item, start: pick.start ?? 0 }, seconds),
    ...attributionFor(pick),
  }
  console.log(`  ${item.id}: ${credits[item.id].licenceShort} — ${pick.source}:${pick.ref} (${pick.title})`)
}

async function grab(kind, item) {
  let have = credits[item.id]
  const out = join(dirFor(kind), `${item.id}.m4a`)
  const pick = PICKS[item.id]
  const step = nextStep({ have, onDisk: existsSync(out), pick })

  if (step === 'already-picked') { console.log(`  ${item.id}: already have it (${pick.source})`); return }
  if (step === 'fetch-pick') {
    if (OFFLINE) { console.log(`  ${item.id}: picked but not on disk, and --offline`); return }
    await fetchPick(kind, item, pick)
    await sleep(1100)
    return
  }
  // A credit from a source other than Commons has no Commons file to refresh
  // from — asking Commons for it would report it "gone" and fail every run.
  if (step === 'keep') { console.log(`  ${item.id}: already have it (${have.source})`); return }
  if (step === 'unpicked') {
    // Silent until someone picks it. See scripts/lib/soundPlan.mjs for the
    // run that shipped a 1916 song as the desert when this searched instead.
    console.log(`  ${item.id}: not picked — silent`)
    return
  }

  if (have && existsSync(out)) {
    // The modification notice costs nothing to recompute and no network at
    // all: it is derived from the parameters below and the duration already
    // measured off this very file. Backfilled before the early return, so a
    // credit written before the field existed picks it up on any run.
    const modifications = modificationsFor(kind, item, have.seconds)
    if (have.modifications !== modifications) {
      have = { ...have, modifications }
      credits[item.id] = have
      console.log(`  ${item.id}: modifications recorded — ${modifications}`)
    }

    if (have.attributionHtml) { console.log(`  ${item.id}: already have it`); return }
    if (OFFLINE) { console.log(`  ${item.id}: credit is incomplete, but --offline`); return }

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
// NC-SA is share-alike too: this once counted CC BY-SA alone.
const adapted = Object.values(credits).filter(c => /^cc-by(-nc)?-sa/i.test(c.licence)).length
console.log(`${adapted} are share-alike, so the edited file must be offered under the same licence`)
const nc = Object.values(credits).filter(c => /^cc-by-nc/i.test(c.licence)).length
console.log(`${nc} are non-commercial, each marked as such on the credits page`)
if (problems.length) {
  console.log(`\n${problems.length} credit problem(s):`)
  for (const p of problems) console.log(`  ${p}`)
  process.exitCode = 1
}
if (OFFLINE) {
  // Nothing was attempted, so nothing failed. A missing sound is still
  // missing, but that is yesterday's news and must not fail today's run.
  console.log(`\n--offline: credits refreshed from disk. ${missing.length} sound(s) still unsourced.`)
} else if (missing.length) {
  console.log(`${missing.length} not yet picked, so silent. Measure candidates with`)
  console.log('`npm run sound:candidates -- <id>` and add a pick to scripts/sound-picks.json:')
  for (const m of missing) console.log(`  ${m.id}  (${m.search ?? m.note ?? ''})`)
  process.exitCode = 1
}
