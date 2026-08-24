#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { api, vet, attribution, realWidth, stripQuery, sleep, EN, WD, COMMONS, EM_FILTER, UA } from './lib/wiki.mjs'

const OUT = 'public/photos'
const CREDITS = 'src/data/photo-credits.json'
mkdirSync(OUT, { recursive: true })
mkdirSync('src/data', { recursive: true })

/**
 * Landmarks where all three automatic tiers fail or return the wrong thing.
 * Expect five to ten percent of a 180-name list to end up here. Add entries
 * as the contact sheet review surfaces them; never let the script guess.
 */
const OVERRIDES = {
  // 'Mysore Palace': 'File:Mysore Palace WLM 2022 India 14.jpg',
  // The article's lead image and every Commons-search hit for this one are
  // GFDL 1.2, which the licence allowlist deliberately rejects.
  "Humayun's Tomb": "File:Humayun's tomb, Delhi in 2019.jpg",
  // The Munnar article's lead image is the town, not the tea. The narration
  // is entirely about the tea bushes, so the picture has to show them.
  'Munnar': 'File:Munnar Tea Plantations-WUS07352.jpg',
  // Task 4c: the article's lead image is a wide shot of the temple that
  // never shows a wheel, while the line is entirely about the twenty-four
  // carved wheels and the shadow that crosses one of them to tell the time.
  'Konark Sun Temple': 'File:Wheel engraved in the 13th century built Konark Sun Temple in Orissa, India.jpg',
  // The lead image is an empty landscape — neither a tiger nor the fort the
  // line names, and the father's first device-test complaint was literally
  // "the tiger and others are fake". The line's three sentences are about
  // the tiger; this is the state's only real tiger photograph until Task 5
  // builds a separate animal-photo pipeline, so it carries that weight here.
  'Ranthambore National Park': 'File:Bengal tiger in Ranthambore National Park.jpg',
}

function landmarks() {
  const out = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    for (const lm of JSON.parse(readFileSync(join('content/places', f), 'utf8')).landmarks) {
      out.push({ id: lm.id, name: lm.name, query: lm.photoQuery })
    }
  }
  return out
}

/** Tier 1: the article's curated lead image. Batches 50 titles per request. */
async function leadImages(queries) {
  const found = new Map()
  for (let i = 0; i < queries.length; i += 50) {
    const batch = queries.slice(i, i + 50)
    const j = await api(EN, {
      action: 'query', redirects: '1', titles: batch.join('|'),
      prop: 'pageimages|pageprops', piprop: 'original|name', pilimit: '50', ppprop: 'disambiguation',
    })
    const q = j.query ?? {}
    const hop = new Map([...(q.normalized ?? []), ...(q.redirects ?? [])].map(r => [r.from, r.to]))
    const resolve = t => { const seen = new Set(); while (hop.has(t) && !seen.has(t)) { seen.add(t); t = hop.get(t) } return t }
    const byTitle = new Map((q.pages ?? []).map(p => [p.title, p]))
    for (const name of batch) {
      const p = byTitle.get(resolve(name))
      if (p?.pageimage && !(p.pageprops && 'disambiguation' in p.pageprops)) {
        found.set(name, { file: 'File:' + p.pageimage, source: 'pageimages' })
      }
    }
    await sleep(300)
  }
  return found
}

/** Tier 2: Wikidata P18, "image of this thing". */
async function wikidataP18(name) {
  const j = await api(WD, { action: 'wbgetentities', sites: 'enwiki', titles: name, props: 'claims', languages: 'en' })
  for (const e of Object.values(j.entities ?? {})) {
    const f = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    if (f) return { file: 'File:' + f, source: 'wikidata-P18' }
  }
  return null
}

/** Tier 3: Commons search. Noisy. Results arrive unordered; index is the rank. */
async function commonsSearch(name) {
  const j = await api(COMMONS, {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '10',
    gsrsearch: `filetype:bitmap ${name}`, prop: 'imageinfo', iiprop: 'url|size|mime',
  })
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index)
  return pages[0] ? { file: pages[0].title, source: 'commons-search' } : null
}

/** Licence and thumbnail, asked of en.wikipedia because it transparently
 *  resolves Commons files and returns full extmetadata from one host. */
async function fileInfo(titles, width = 900) {
  const out = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const j = await api(EN, {
      action: 'query', titles: titles.slice(i, i + 50).join('|'),
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(width), iiextmetadatafilter: EM_FILTER,
    })
    for (const p of j.query?.pages ?? []) {
      // en.wikipedia sets missing:true for Commons files with no local
      // description page, yet still returns full imageinfo. Filtering on
      // p.missing silently discards perfectly good files.
      if (!p.imageinfo?.[0]) continue
      out.set(p.title, { ...p.imageinfo[0], imagerepository: p.imagerepository, fileTitle: p.title })
    }
    await sleep(300)
  }
  return out
}

const list = landmarks()
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const todo = list.filter(l => !credits[l.id] || !existsSync(join(OUT, `${l.id}.jpg`)))
console.log(`${list.length} landmarks, ${todo.length} still to fetch`)

const leads = await leadImages(todo.map(l => l.query))
const failures = []

for (const lm of todo) {
  const candidates = []
  if (OVERRIDES[lm.query]) candidates.push({ file: OVERRIDES[lm.query], source: 'override' })
  const lead = leads.get(lm.query); if (lead) candidates.push(lead)
  const wd = await wikidataP18(lm.query); if (wd) candidates.push(wd)
  const cs = await commonsSearch(lm.query); if (cs) candidates.push(cs)

  const infos = await fileInfo([...new Set(candidates.map(c => c.file))])
  let chosen = null
  for (const c of candidates) {
    const ii = infos.get(c.file.replace(/_/g, ' '))
    if (!ii) continue
    const v = vet(ii)
    if (!v.ok) { console.log(`    reject ${c.file} (${c.source}): ${v.why}`); continue }
    chosen = { ii, source: c.source }
    break
  }

  if (!chosen) {
    failures.push(lm)
    console.log(`  ${lm.id}: NO USABLE IMAGE, add to OVERRIDES`)
    await sleep(1000)
    continue
  }

  const url = stripQuery(chosen.ii.thumburl ?? chosen.ii.url)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) { failures.push(lm); console.log(`  ${lm.id}: download HTTP ${res.status}`); continue }
  writeFileSync(join(OUT, `${lm.id}.jpg`), Buffer.from(await res.arrayBuffer()))

  credits[lm.id] = {
    file: `photos/${lm.id}.jpg`,
    width: realWidth(url) ?? chosen.ii.width,
    source: chosen.source,
    fileTitle: chosen.ii.fileTitle,
    ...attribution(chosen.ii),
  }
  console.log(`  ${lm.id}: ${chosen.source}, ${credits[lm.id].licenceShort}`)
  await sleep(1000)
}

writeFileSync(CREDITS, JSON.stringify(credits, null, 2))
console.log(`\n${Object.keys(credits).length} photographs with credits`)
if (failures.length) {
  console.log(`${failures.length} need a hand-picked override:`)
  for (const f of failures) console.log(`  '${f.query}': 'File:...',`)
  process.exitCode = 1
}
