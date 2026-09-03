#!/usr/bin/env node
/**
 * Research tool for the OVERRIDES table in `scripts/fetch-photos.mjs`.
 * Read-only: it downloads nothing and writes nothing. It exists because of
 * an asymmetry in the fetcher itself — a LANDMARK only ever considers the
 * single top Commons search hit (`commonsSearch` is
 * `commonsSearchMany(name, 10)[0]`), while an ANIMAL vets a pool of ten and
 * prefers an India-located one from it. So a landmark can be reported as
 * "NO USABLE IMAGE" while nine unexamined candidates sit directly behind
 * the one that failed.
 *
 * This does NOT auto-pick. `OVERRIDES`' own comment says never let the
 * script guess, and that ruling stands: this prints the candidates that
 * pass the real `vet()` — the same licence, size and restriction gate the
 * fetcher applies — so a human picks a `File:` line from evidence instead
 * of from a bare search page. The picked file still has to survive the
 * contact-sheet review like every other photograph.
 *
 *   node scripts/override-candidates.mjs <landmark-id> [<landmark-id> ...]
 *   node scripts/override-candidates.mjs --from-log <path-to-fetch-log>
 *   node scripts/override-candidates.mjs --query "hangul Cervus hanglu"
 *   node scripts/override-candidates.mjs --animal markhor
 *
 * `--query` searches arbitrary words, for the case where the landmark's own
 * `photoQuery` is simply the wrong question — Dachigam's narration is about
 * the hangul DEER, so searching the park's name returns six landscapes and
 * no animal. `--animal` runs `vetAnimal` (which adds the captive/zoo
 * rejection) and reports each candidate's `localityVerdict`, because for a
 * species the question "where was this taken" is the whole point.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  api, vet, vetAnimal, attribution, realWidth, sleep, EN, COMMONS, EM_FILTER,
  indiaLocalityRegex, localityVerdict,
} from './lib/wiki.mjs'

/** id -> { name, query } for every landmark the content actually declares. */
function landmarkIndex() {
  const out = new Map()
  for (const f of readdirSync('content/places').filter((f) => f.endsWith('.json'))) {
    const place = JSON.parse(readFileSync(join('content/places', f), 'utf8'))
    for (const lm of place.landmarks) out.set(lm.id, { name: lm.name, query: lm.photoQuery })
  }
  return out
}

const args = process.argv.slice(2)
const mode = args[0] === '--query' ? 'query' : args[0] === '--animal' ? 'animal' : 'landmark'
let ids = []
if (args[0] === '--from-log') {
  const log = readFileSync(args[1], 'utf8')
  ids = [...log.matchAll(/^\s*(\S+): NO USABLE IMAGE/gm)].map((m) => m[1])
} else if (mode !== 'landmark') {
  ids = args.slice(1)
} else {
  ids = args
}
if (!ids.length) {
  console.error('usage: override-candidates.mjs <landmark-id>... | --from-log <file>')
  process.exit(2)
}

const index = landmarkIndex()

/** The pool the landmark path never looks at. Two queries per landmark —
 *  its `photoQuery` and its plain `name` — because the two return
 *  materially different result sets and a failure is exactly the case where
 *  the narrower one came back wrong. */
async function pool(queries, limit = 12) {
  const files = new Set()
  for (const q of queries) {
    const j = await api(COMMONS, {
      action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
      gsrsearch: `filetype:bitmap ${q}`, prop: 'imageinfo', iiprop: 'url|size|mime',
    })
    for (const p of (j.query?.pages ?? []).sort((a, b) => a.index - b.index)) files.add(p.title)
    await sleep(400)
  }
  return [...files]
}

async function fileInfo(titles, width = 900) {
  const out = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const j = await api(EN, {
      action: 'query', titles: titles.slice(i, i + 50).join('|'),
      prop: 'imageinfo|categories', iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(width), iiextmetadatafilter: EM_FILTER,
      cllimit: 'max', clshow: '!hidden',
    })
    for (const p of j.query?.pages ?? []) {
      if (!p.imageinfo?.[0]) continue
      out.set(p.title, {
        ...p.imageinfo[0], imagerepository: p.imagerepository, fileTitle: p.title,
        categories: (p.categories ?? []).map((c) => c.title),
      })
    }
    await sleep(300)
  }
  return out
}

const STATE_NAMES = Object.values(JSON.parse(readFileSync('src/data/geo.json', 'utf8')).places).map((p) => p.name)
const INDIA_RE = indiaLocalityRegex(STATE_NAMES)

/** ANIMAL ONLY — the same second pass `fetch-photos.mjs` runs, replacing
 *  en.wikipedia's useless mirror of the categories with Commons' own and
 *  attaching the geotag, because those are the two inputs a locality
 *  verdict actually needs. */
async function attachLocality(infos, titles) {
  for (let i = 0; i < titles.length; i += 50) {
    const j = await api(COMMONS, {
      action: 'query', titles: titles.slice(i, i + 50).join('|'),
      prop: 'categories|coordinates', cllimit: 'max', clshow: '!hidden',
    })
    for (const p of j.query?.pages ?? []) {
      const ii = infos.get(p.title)
      if (!ii) continue
      ii.categories = (p.categories ?? []).map((c) => c.title)
      ii.coordinates = p.coordinates?.[0]
    }
    await sleep(300)
  }
}

for (const id of ids) {
  let queries, label
  if (mode === 'landmark') {
    const lm = index.get(id)
    if (!lm) { console.log(`\n${id}: NOT A LANDMARK IN content/places — skipped`); continue }
    queries = [lm.query, lm.name]
    label = `${id} — "${lm.name}"  (photoQuery: "${lm.query}")`
  } else {
    queries = [id]
    label = `${mode === 'animal' ? 'ANIMAL ' : ''}query: "${id}"`
  }
  console.log(`\n${label}`)

  const titles = await pool(queries)
  const infos = await fileInfo(titles)
  if (mode === 'animal') await attachLocality(infos, titles)
  const vetFn = mode === 'animal' ? vetAnimal : vet
  const passing = []
  for (const t of titles) {
    const ii = infos.get(t.replace(/_/g, ' '))
    if (!ii) continue
    const v = vetFn(ii)
    if (!v.ok) continue
    passing.push({ t, ii })
  }

  if (!passing.length) {
    console.log(`  no candidate in ${titles.length} results passes vet() — this one needs a human search`)
    continue
  }
  for (const { t, ii } of passing.slice(0, 8)) {
    const a = attribution(ii)
    const w = realWidth(ii.thumburl ?? ii.url) ?? ii.width
    const loc = mode === 'animal' ? ` · locality ${localityVerdict(ii, INDIA_RE) ?? 'not established'}` : ''
    console.log(`  "${t}",`)
    console.log(`      ${a.licenceShort} · ${w}px${loc} · ${String(a.artist || 'unknown author').slice(0, 60)}`)
    const desc = (ii.extmetadata?.ImageDescription?.value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (desc) console.log(`      ${desc.slice(0, 150)}`)
  }
}
