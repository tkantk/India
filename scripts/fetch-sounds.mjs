#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { api, sleep, COMMONS, EM_FILTER, UA } from './lib/wiki.mjs'
import { toMonoWav, toM4a } from './lib/encode.mjs'

const want = JSON.parse(readFileSync('content/sounds.json', 'utf8'))
const CREDITS = 'src/data/sound-credits.json'
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const tmp = mkdtempSync(join(tmpdir(), 'sfx-'))
mkdirSync('public/audio/sfx', { recursive: true })
mkdirSync('public/audio/ambience', { recursive: true })
mkdirSync('src/data', { recursive: true })

const ALLOWED = /^(cc0|public domain|cc by(-sa)? \d(\.\d)?)$/i
/** Commons audio search returns Wiktionary pronunciations: humans saying the
 *  word, not the animal. Without this filter the site ships people talking. */
const PRONUNCIATION = /^(de|en|fr|nl|ru|es|it|pt|pl)-|^ll-q\d+/i

async function commonsAudio(term) {
  const j = await api(COMMONS, {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '12',
    gsrsearch: `filetype:audio ${term}`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: EM_FILTER,
  })
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index)
  for (const p of pages) {
    const name = p.title.replace(/^File:/, '')
    if (PRONUNCIATION.test(name)) continue
    const ii = p.imageinfo?.[0]; if (!ii) continue
    const licence = ii.extmetadata?.LicenseShortName?.value ?? ''
    if (!ALLOWED.test(licence.trim())) continue
    return {
      url: ii.url.split('?')[0], fileTitle: p.title, licenceShort: licence,
      artist: (ii.extmetadata?.Artist?.value ?? 'Unknown').replace(/<[^>]*>/g, '').trim(),
      descriptionUrl: ii.descriptionurl,
    }
  }
  return null
}

async function grab(kind, item) {
  if (credits[item.id]) { console.log(`  ${item.id}: already have it`); return }
  const hit = await commonsAudio(item.search)
  await sleep(1000)
  if (!hit) { console.log(`  ${item.id}: NOT FOUND for "${item.search}"`); return }

  const res = await fetch(hit.url, { headers: { 'User-Agent': UA } })
  if (!res.ok) { console.log(`  ${item.id}: download HTTP ${res.status}`); return }
  const raw = join(tmp, `${item.id}.src`)
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()))

  const wav = join(tmp, `${item.id}.wav`)
  toMonoWav(raw, wav)

  const dir = kind === 'sfx' ? 'public/audio/sfx' : 'public/audio/ambience'
  const out = join(dir, `${item.id}.m4a`)

  if (kind === 'ambience') {
    const looped = join(tmp, `${item.id}.loop.wav`)
    execFileSync('python3', ['scripts/lib/loop.py', wav, looped, String(item.seconds ?? 20), '3'],
      { stdio: 'inherit' })
    toM4a(looped, out, 56000)
  } else {
    toM4a(wav, out, 64000)
  }

  credits[item.id] = {
    file: `${kind === 'sfx' ? 'audio/sfx' : 'audio/ambience'}/${item.id}.m4a`,
    kind, ...hit,
  }
  console.log(`  ${item.id}: ${hit.licenceShort} — ${hit.fileTitle}`)
}

console.log('sound effects')
for (const s of want.sfx) await grab('sfx', s)
console.log('ambient beds')
for (const a of want.ambience) await grab('ambience', a)

writeFileSync(CREDITS, JSON.stringify(credits, null, 2))

const missing = [...want.sfx, ...want.ambience].filter(i => !credits[i.id])
console.log(`\n${Object.keys(credits).length} sounds`)
if (missing.length) {
  console.log(`${missing.length} not found on Commons. Get a free Freesound token at`)
  console.log(`https://freesound.org/apiv2/apply/ and hand-pick these:`)
  for (const m of missing) console.log(`  ${m.id}  (${m.search})`)
  process.exitCode = 1
}
