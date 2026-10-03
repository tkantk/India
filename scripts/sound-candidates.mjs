#!/usr/bin/env node
/**
 * FIND, FETCH AND MEASURE candidate recordings for every sound the app wants
 * and does not have. Research only: writes nothing the app ships.
 *
 *   npm run sound:candidates                 every wanted sound
 *   npm run sound:candidates -- tiger-growl  just these ids
 *
 * For each sound it asks the sources that can honestly have it (iNaturalist
 * for wild animals recorded in India, xeno-canto for birds, Freesound for
 * places and effects), keeps only candidates whose licence passes the
 * project's one allowlist, downloads up to PER of them, and measures each
 * with scripts/lib/audio_metrics.py — signal-to-noise, clipping, steadiness,
 * where the best moment starts — plus a spectrogram image.
 *
 * WHY MEASURE INSTEAD OF LISTEN: the people choosing are not in the room with
 * the audio. An agent reads the numbers and the picture; the owner then
 * listens only to the shortlist. Field recordings fail in ways a title never
 * mentions — wind, traffic, a recordist talking over the call — and the
 * numbers catch most of them before a human ever has to.
 *
 * Output: build/sound-candidates/<id>/{report.json, *.png, *.wav} and one
 * build/sound-candidates/index.html to look at (and listen to) everything.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { toMonoWav } from './lib/encode.mjs'
import { inatSounds, xenoCanto, freesound, licenceOk } from './lib/media-sources.mjs'
import { UA, sleep } from './lib/wiki.mjs'

const OUT = 'build/sound-candidates'
// Measured per sound. `--per N` widens it: the owner turned down the first
// tiger, and six measured candidates had not covered the pool.
const perArg = process.argv.find((a) => a.startsWith('--per='))
const PER = perArg ? Number(perArg.slice(6)) : 6
const MAX_BYTES = 30 * 1024 * 1024

const BED = 'duration:[30 TO 900]'
const SHOT = 'duration:[1 TO 120]'
const xc = (sp) => ({ source: 'xc', q: `sp:"${sp}" cnt:India` })

/**
 * Every sound wanted, and where it can honestly come from. `window` is the
 * length the app will actually use — 3 s for a one-shot (TRIM.defaultMaxSeconds),
 * 20 s for a bed (LOOP.defaultSeconds) — so the measurement describes the
 * part that would ship, not the whole recording.
 */
export const WANTED = [
  // ---- effects already referenced by content and the tour, still silent
  { id: 'tiger-growl', kind: 'sfx', window: 3, note: 'tour beat 7 + 4 tiger landmarks', queries: [{ source: 'inat', q: 'Panthera tigris' }, { source: 'freesound', q: 'tiger growl', filter: SHOT }, { source: 'freesound', q: 'tiger roar india', filter: SHOT }, { source: 'freesound', q: 'tiger Ranthambore', filter: SHOT }, { source: 'freesound', q: 'tiger Bandhavgarh', filter: SHOT }, { source: 'freesound', q: 'tiger Kanha', filter: SHOT }] },
  { id: 'lion-roar', kind: 'sfx', window: 3, note: 'Gir forest, the Asiatic lion', queries: [{ source: 'inat', q: 'Panthera leo' }, { source: 'freesound', q: 'lion roar', filter: SHOT }] },
  { id: 'camel', kind: 'sfx', window: 3, note: "Rajasthan's dromedary card", queries: [{ source: 'freesound', q: 'camel grunt', filter: SHOT }, { source: 'freesound', q: 'camel Rajasthan', filter: SHOT }, { source: 'freesound', q: 'dromedary', filter: SHOT }] },
  { id: 'rhino', kind: 'sfx', window: 3, note: "Assam's rhino card, Kaziranga", queries: [{ source: 'freesound', q: 'rhinoceros', filter: SHOT }, { source: 'freesound', q: 'rhino', filter: SHOT }] },
  { id: 'temple-bell', kind: 'sfx', window: 3, note: 'six temple landmarks', queries: [{ source: 'freesound', q: 'temple bell india', filter: SHOT }, { source: 'freesound', q: 'temple bell', filter: SHOT }, { source: 'freesound', q: 'mandir bell', filter: SHOT }] },
  { id: 'whoosh-soft', kind: 'sfx', window: 2, note: 'ropeway, sea link, toy train', queries: [{ source: 'freesound', q: 'soft whoosh', filter: 'duration:[0.3 TO 4]' }, { source: 'freesound', q: 'gentle swoosh', filter: 'duration:[0.3 TO 4]' }, { source: 'freesound', q: 'swish air', filter: 'duration:[0.3 TO 4]' }, { source: 'freesound', q: 'whoosh foley', filter: 'duration:[0.3 TO 4]' }] },
  // The owner turned down the whoosh. It stands in for three real things —
  // the Darjeeling steam engine, the Sea Link's traffic, the Rajgir ropeway —
  // so the true sound of each is offered beside other whooshes.
  { id: 'steam-train', kind: 'sfx', window: 3, note: 'Darjeeling toy train (West Bengal)', queries: [{ source: 'freesound', q: 'Darjeeling', filter: SHOT }, { source: 'freesound', q: 'Darjeeling Himalayan Railway', filter: SHOT }, { source: 'freesound', q: 'toy train India', filter: SHOT }, { source: 'freesound', q: 'steam locomotive whistle', filter: SHOT }, { source: 'freesound', q: 'steam train India', filter: SHOT }] },
  { id: 'traffic-pass', kind: 'sfx', window: 3, note: 'Bandra-Worli Sea Link (Maharashtra)', queries: [{ source: 'freesound', q: 'Bandra Worli', filter: SHOT }, { source: 'freesound', q: 'Mumbai traffic passing', filter: SHOT }, { source: 'freesound', q: 'car passing by bridge', filter: SHOT }] },
  { id: 'ropeway', kind: 'sfx', window: 3, note: 'Rajgir Ropeway (Bihar)', queries: [{ source: 'freesound', q: 'ropeway India', filter: SHOT }, { source: 'freesound', q: 'chairlift', filter: SHOT }, { source: 'freesound', q: 'cable car pulley', filter: SHOT }] },
  // The owner turned down the stamp chime, which is also the sound check at
  // start-up. A small brass bell is the Indian answer to a "ding".
  { id: 'chime-correct', kind: 'sfx', window: 2, note: 'passport stamp + the start-up sound check', queries: [{ source: 'freesound', q: 'brass bell ding', filter: 'duration:[0.5 TO 20]' }, { source: 'freesound', q: 'puja bell', filter: 'duration:[0.5 TO 20]' }, { source: 'freesound', q: 'ghanti', filter: 'duration:[0.5 TO 20]' }, { source: 'freesound', q: 'small bell single ring', filter: 'duration:[0.5 TO 20]' }, { source: 'freesound', q: 'singing bowl strike', filter: 'duration:[0.5 TO 30]' }] },

  // ---- background beds, named by 19 places, still silent
  { id: 'desert', kind: 'ambience', window: 20, note: 'Rajasthan, Gujarat', queries: [{ source: 'freesound', q: 'desert wind Rajasthan', filter: BED }, { source: 'freesound', q: 'Thar desert', filter: BED }, { source: 'freesound', q: 'desert wind', filter: BED }] },
  { id: 'mountain', kind: 'ambience', window: 20, note: 'Himachal, Ladakh, Sikkim, Arunachal, J&K, Uttarakhand…', queries: [{ source: 'freesound', q: 'Himalaya wind', filter: BED }, { source: 'freesound', q: 'Ladakh', filter: BED }, { source: 'freesound', q: 'mountain wind ambience', filter: BED }] },
  { id: 'city', kind: 'ambience', window: 20, note: 'Delhi, Mumbai, Chandigarh', queries: [{ source: 'freesound', q: 'Delhi street', filter: BED }, { source: 'freesound', q: 'India street ambience', filter: BED }, { source: 'freesound', q: 'Mumbai street', filter: BED }] },
  { id: 'plains', kind: 'ambience', window: 20, note: 'Punjab, Haryana, MP, Telangana', queries: [{ source: 'freesound', q: 'Punjab village', filter: BED }, { source: 'freesound', q: 'India village ambience', filter: BED }, { source: 'freesound', q: 'Indian countryside', filter: BED }] },
  { id: 'temple', kind: 'ambience', window: 20, note: 'Tamil Nadu', queries: [{ source: 'freesound', q: 'Madurai temple', filter: BED }, { source: 'freesound', q: 'Meenakshi', filter: BED }, { source: 'freesound', q: 'Srirangam', filter: BED }, { source: 'freesound', q: 'Tamil Nadu temple', filter: BED }, { source: 'freesound', q: 'temple bells crowd india', filter: BED }, { source: 'freesound', q: 'temple Tamil Nadu', filter: BED }, { source: 'freesound', q: 'south India temple', filter: BED }, { source: 'freesound', q: 'temple bells chanting India', filter: BED }] },
  { id: 'island', kind: 'ambience', window: 20, note: 'Andamans, Lakshadweep', queries: [{ source: 'freesound', q: 'Andaman beach', filter: BED }, { source: 'freesound', q: 'Lakshadweep', filter: BED }, { source: 'freesound', q: 'tropical beach calm waves', filter: BED }] },

  // ---- animal-card calls: real recordings of the very species, in India
  { id: 'asian-koel', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Eudynamys scolopaceus'), { source: 'inat', q: 'Eudynamys scolopaceus' }] },
  { id: 'black-francolin', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Francolinus francolinus'), { source: 'inat', q: 'Francolinus francolinus' }] },
  { id: 'indian-paradise-flycatcher', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Terpsiphone paradisi'), { source: 'inat', q: 'Terpsiphone paradisi' }] },
  { id: 'indian-giant-squirrel', kind: 'sfx', window: 3, note: 'animal card', queries: [{ source: 'inat', q: 'Ratufa indica' }, xc('Ratufa indica')] },
  { id: 'sarus-crane', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Antigone antigone'), xc('Grus antigone'), { source: 'inat', q: 'Antigone antigone' }] },
  { id: 'common-hill-myna', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Gracula religiosa'), { source: 'inat', q: 'Gracula religiosa' }] },
  { id: 'himalayan-monal', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Lophophorus impejanus'), { source: 'inat', q: 'Lophophorus impejanus' }] },
  { id: 'great-egret', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Ardea alba')] },
  { id: 'greater-flamingo', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Phoenicopterus roseus')] },
  { id: 'western-tragopan', kind: 'sfx', window: 3, note: 'animal card', queries: [xc('Tragopan melanocephalus')] },
  { id: 'gaur', kind: 'sfx', window: 3, note: 'animal card', queries: [{ source: 'inat', q: 'Bos gaurus' }, { source: 'freesound', q: 'gaur bison india', filter: SHOT }] },

  // ---- older Commons sounds that fail the rule the new ones are held to
  // (found 2026-10-02 while checking the new beds against them): the forest
  // bed is English woodland (Bourne Woods, Surrey) with 0.6 s of digital
  // silence in every loop; the peacock is a farm bird in Slovakia; the
  // elephant's page names neither species nor place.
  { id: 'forest', kind: 'ambience', window: 20, note: 'Kerala, Karnataka, Jharkhand, Chhattisgarh, Mizoram, Nagaland, Tripura', queries: [{ source: 'freesound', q: 'Kerala forest', filter: BED }, { source: 'freesound', q: 'Western Ghats', filter: BED }, { source: 'freesound', q: 'India jungle birds', filter: BED }, { source: 'freesound', q: 'India forest ambience', filter: BED }] },
  { id: 'peacock-call', kind: 'sfx', window: 3, note: 'the national bird, Grand Tour; Mor himself', queries: [xc('Pavo cristatus'), { source: 'inat', q: 'Pavo cristatus' }] },
  { id: 'elephant', kind: 'sfx', window: 3, note: 'Kerala and Assam, the Asian elephant', queries: [{ source: 'inat', q: 'Elephas maximus' }, xc('Elephas maximus'), { source: 'freesound', q: 'asian elephant india', filter: SHOT }] },
]

const SEARCH = {
  inat: (q) => inatSounds(q.q),
  xc: (q) => xenoCanto(q.q),
  freesound: (q) => freesound(q.q, { filter: q.filter }),
}

/** India first, then the source's own quality signal. */
const rank = (c) => (c.inIndia === true ? 0 : c.inIndia === null ? 1 : 2) * 10 + (c.quality && /^A$/.test(c.quality) ? 0 : c.quality === 'B' ? 1 : 2)

async function gather(item) {
  const seen = new Set()
  const out = []
  for (const q of item.queries) {
    let found = []
    try {
      found = await SEARCH[q.source](q)
    } catch (err) {
      console.log(`    ${q.source} "${q.q}": ${err.message}`)
    }
    for (const c of found) {
      const key = `${c.source}:${c.ref}`
      if (seen.has(key) || !c.download || c.captive) continue
      // A one-shot needs three seconds; a ten-minute file costs a slow
      // download and decode to find them. Beds need ~25 s, not an hour.
      const cap = item.kind === 'ambience' ? 900 : 180
      if (c.seconds != null && c.seconds > cap) continue
      seen.add(key)
      const lic = licenceOk(c)
      if (!lic.ok) continue
      out.push({ ...c, licenceCode: lic.code, query: q.q })
    }
    await sleep(1100)
  }
  return out.sort((a, b) => rank(a) - rank(b))
}

async function measure(item, c, dir, n) {
  const base = join(dir, `${n}-${c.source}-${c.ref}`)
  // A download that hangs must cost one candidate, not the whole run: the
  // first full run stalled for most of an hour on slow multi-minute files.
  const res = await fetch(c.download, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`download HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_BYTES) throw new Error(`too large (${Math.round(len / 1e6)} MB)`)
  const raw = `${base}.src`
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()))
  if (statSync(raw).size > MAX_BYTES) throw new Error('too large')
  const wav = `${base}.wav`
  toMonoWav(raw, wav)
  const m = JSON.parse(execFileSync('python3', ['scripts/lib/audio_metrics.py', wav, `${base}.png`, String(item.window)], { encoding: 'utf8' }))
  return { ...c, n, wav: resolve(wav), png: resolve(`${base}.png`), metrics: m }
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const items = only.length ? WANTED.filter((w) => only.includes(w.id)) : WANTED
mkdirSync(OUT, { recursive: true })
const summary = []

for (const item of items) {
  console.log(`\n${item.id} (${item.kind}) — ${item.note}`)
  const dir = join(OUT, item.id)
  mkdirSync(dir, { recursive: true })
  const pool = await gather(item)
  console.log(`  ${pool.length} candidate(s) pass the licence rule`)
  const measured = []
  for (const c of pool) {
    if (measured.length >= PER) break
    try {
      const r = await measure(item, c, dir, measured.length + 1)
      measured.push(r)
      const m = r.metrics
      console.log(`  ${String(r.n).padStart(2)}. ${c.source}:${c.ref} ${c.licenceCode} india=${c.inIndia} ${m.seconds}s snr=${m.snr_db}dB spread=${m.spread_db}dB clip=${m.clipped} @${m.best_start}s — ${String(c.title).slice(0, 60)}`)
    } catch (err) {
      console.log(`  skip ${c.source}:${c.ref}: ${String(err.message).split('\n')[0]}`)
    }
  }
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ ...item, candidates: measured }, null, 2))
  summary.push({ ...item, candidates: measured })
}

// One page to look at — and, for a human, listen to — every candidate.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = summary.map((s) => `<section><h2>${esc(s.id)} <small>${esc(s.kind)} · ${esc(s.note)}</small></h2>${
  s.candidates.length ? s.candidates.map((c) => `<figure><img src="file://${c.png}"><figcaption><b>${c.n}. ${esc(c.source)}:${esc(c.ref)}</b> · ${esc(c.licenceCode)} · India: ${c.inIndia}<br>snr ${c.metrics.snr_db} dB · spread ${c.metrics.spread_db} dB · clip ${c.metrics.clipped} · ${c.metrics.seconds}s · best @${c.metrics.best_start}s<br>${esc(c.title).slice(0, 90)}<br><audio controls preload="none" src="file://${c.wav}"></audio></figcaption></figure>`).join('') : '<p>No candidate passed.</p>'
}</section>`).join('')
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><style>body{font:12px system-ui;margin:12px}section{margin-bottom:18px}figure{display:inline-block;width:330px;margin:4px;vertical-align:top}img{width:320px;height:100px}h2{font-size:15px;margin:8px 0 2px}</style>${html}`)
console.log(`\nwrote ${OUT}/index.html`)
