#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  api, vet, vetAnimal, attribution, realWidth, stripQuery, sleep,
  EN, WD, COMMONS, EM_FILTER, UA, indiaLocalityRegex, localityVerdict,
} from './lib/wiki.mjs'

const OUT = 'public/photos'
const CREDITS = 'src/data/photo-credits.json'
mkdirSync(OUT, { recursive: true })
mkdirSync('src/data', { recursive: true })

/** Every state/UT name this app itself draws — read off the real, generated
 *  geo.json rather than hand-listed a second time — fed to
 *  `indiaLocalityRegex` (wiki.mjs) as the text-fallback signal for "was this
 *  photo taken in India". See that function's own note on why this is a
 *  fallback and not the primary signal. */
const STATE_NAMES = Object.values(JSON.parse(readFileSync('src/data/geo.json', 'utf8')).places).map((p) => p.name)
const INDIA_RE = indiaLocalityRegex(STATE_NAMES)

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
  // the tiger; Rajasthan's own animal card is a dromedary, not a tiger (see
  // `animals()` below), so this landmark override is still, and permanently,
  // the only real tiger photograph anywhere in the app.
  'Ranthambore National Park': 'File:Bengal tiger in Ranthambore National Park.jpg',
}

function landmarks() {
  const out = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    for (const lm of JSON.parse(readFileSync(join('content/places', f), 'utf8')).landmarks) {
      out.push({ id: lm.id, name: lm.name, query: lm.photoQuery, kind: 'landmark' })
    }
  }
  return out
}

/** Turns a `species` token ("asian-elephant") into the query a photo search
 *  actually needs ("Asian elephant") — the same sentence-case convention
 *  Wikipedia itself titles a species article with (hyphens to spaces,
 *  ONLY the first word capitalised: "Asian elephant", never "Asian
 *  Elephant"). Derived, not a hand-maintained map, so a 33rd species added
 *  by a later task gets a correct query for free rather than needing an
 *  entry here. */
function speciesQuery(species) {
  const [first, ...rest] = species.split('-')
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(' ')
}

/**
 * One entry per DISTINCT species named across every place's `card.animal`,
 * never one per place. Keyed on `species` — deliberately the same key
 * `PlaceScreen.tsx`'s `pagesFor` reads (`PHOTOS[place.card.animal.species]`)
 * — because a photograph of a dromedary is a photograph of a dromedary
 * regardless of which state is telling the story: two places that ever
 * shared a species should share the one fetch, not pay for it twice. Today
 * all four seed places name different species, so this dedupe is not yet
 * doing observable work, but it is the correct shape for the ~32-place
 * pipeline this was built to prove, where a shared species (two states both
 * naming, say, the peacock) is genuinely expected.
 */
function animals() {
  const seen = new Set()
  const out = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    const species = JSON.parse(readFileSync(join('content/places', f), 'utf8')).card.animal.species
    if (seen.has(species)) continue
    seen.add(species)
    out.push({ id: species, name: species, query: speciesQuery(species), kind: 'animal' })
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

/** Tier 3: Commons search. Noisy. Results arrive unordered; index is the
 *  rank. Returns up to `limit` results, not only the best guess — an animal
 *  candidate needs a POOL to prefer an India-located one from; a landmark
 *  (via `commonsSearch` below) has only ever needed the single best guess. */
async function commonsSearchMany(name, limit = 10) {
  const j = await api(COMMONS, {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
    gsrsearch: `filetype:bitmap ${name}`, prop: 'imageinfo', iiprop: 'url|size|mime',
  })
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index)
  return pages.map((p) => ({ file: p.title, source: 'commons-search' }))
}

async function commonsSearch(name) {
  return (await commonsSearchMany(name, 10))[0] ?? null
}

/** Licence and thumbnail, asked of en.wikipedia because it transparently
 *  resolves Commons files and returns full extmetadata from one host.
 *  Also asks for `categories`, but that turns out to be close to useless:
 *  MEASURED directly (Task 5a), en.wikipedia's own `categories` prop on a
 *  Commons-hosted file returns EN.WIKIPEDIA'S OWN wrapper categories
 *  ("Featured pictures", "Wikipedia Picture of the day files"), never
 *  Commons' real ones ("Elephas maximus in the Bandipur National Park").
 *  Kept anyway because `isZooPhoto` still checks whatever is here and an
 *  empty array is harmless, not wrong — `attachLocality` below is what
 *  fetches the categories (and coordinates) that actually carry signal, by
 *  asking Commons directly instead of en.wikipedia's mirror of it. */
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
      // en.wikipedia sets missing:true for Commons files with no local
      // description page, yet still returns full imageinfo. Filtering on
      // p.missing silently discards perfectly good files.
      if (!p.imageinfo?.[0]) continue
      out.set(p.title, {
        ...p.imageinfo[0], imagerepository: p.imagerepository, fileTitle: p.title,
        categories: (p.categories ?? []).map(c => c.title),
      })
    }
    await sleep(300)
  }
  return out
}

/**
 * ANIMAL-ONLY. Overwrites each candidate's `categories` with Commons' own
 * real ones (see `fileInfo`'s note on why en.wikipedia's copy is not
 * usable) and adds `coordinates` when Commons has a geotag for the file —
 * the two inputs `localityVerdict` (wiki.mjs) actually needs. Mutates the
 * `infos` map in place rather than returning a new one: the caller already
 * has a reference to every entry it cares about.
 */
async function attachLocality(infos, titles) {
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const j = await api(COMMONS, {
      action: 'query', titles: batch.join('|'),
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

// Landmarks and animals share every step below — the query tiers, the
// licence gate, the download, the credit shape — and differ only in which
// vet() an animal's own extra "not a zoo" check runs under. See `animals()`
// for why this is species-keyed rather than place-keyed.
const list = [...landmarks(), ...animals()]
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const todo = list.filter(l => !credits[l.id] || !existsSync(join(OUT, `${l.id}.jpg`)))
console.log(`${list.length} photographs wanted (${list.filter(l => l.kind === 'animal').length} animals), ${todo.length} still to fetch`)

const leads = await leadImages(todo.map(l => l.query))
const failures = []

for (const lm of todo) {
  const isAnimal = lm.kind === 'animal'
  const candidates = []
  if (OVERRIDES[lm.query]) candidates.push({ file: OVERRIDES[lm.query], source: 'override' })
  // Animal-only, extra tier: an India-biased Commons search, tried ahead of
  // the country-agnostic tiers below. This is what actually gives the
  // locality preference below a real POOL to choose from — the plain lead
  // image and Wikidata P18 tiers each return exactly one photograph (the
  // article's own, usually the same one both ways), so without this there
  // is nothing to prefer AMONG.
  if (isAnimal) candidates.push(...await commonsSearchMany(`${lm.query} India`, 8))
  const lead = leads.get(lm.query); if (lead) candidates.push(lead)
  const wd = await wikidataP18(lm.query); if (wd) candidates.push(wd)
  const cs = await commonsSearch(lm.query); if (cs) candidates.push(cs)

  const infos = await fileInfo([...new Set(candidates.map(c => c.file))])
  if (isAnimal) await attachLocality(infos, [...new Set(candidates.map(c => c.file))])

  const vetFn = isAnimal ? vetAnimal : vet
  const passing = []
  for (const c of candidates) {
    const ii = infos.get(c.file.replace(/_/g, ' '))
    if (!ii) continue
    const v = vetFn(ii)
    if (!v.ok) { console.log(`    reject ${c.file} (${c.source}): ${v.why}`); continue }
    passing.push({ ii, source: c.source })
  }

  // An override always wins outright when it passes — a human already made
  // this call, and a locality heuristic (below) must never second-guess it.
  let chosen = passing.find((p) => p.source === 'override') ?? null
  // "confirmed" | "unconfirmed" | null (not an animal, no locality question
  // to ask at all). Tri-state per `localityVerdict`'s own reasoning: "not
  // established" is real information, not a rounding-down to "no".
  let locality = null
  if (!chosen && isAnimal) {
    chosen = passing.find((p) => localityVerdict(p.ii, INDIA_RE) === true) ?? null
    if (chosen) locality = 'confirmed'
  }
  if (!chosen) {
    chosen = passing[0] ?? null
    if (chosen && isAnimal) {
      const v = localityVerdict(chosen.ii, INDIA_RE)
      locality = v === false ? 'confirmed-elsewhere' : 'unconfirmed'
    }
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
    // Only ever set for an animal — see `locality`'s own note above. Read
    // by `scripts/contact-sheet-animals.mjs` so a photograph whose location
    // could not be confirmed is flagged to the human reviewer instead of
    // passing silently, per Task 5a's own review comment.
    ...(locality ? { locality } : {}),
  }
  const localityNote = locality ? ` — locality ${locality}` : ''
  console.log(`  ${lm.id}: ${chosen.source}, ${credits[lm.id].licenceShort}${localityNote}`)
  await sleep(1000)
}

writeFileSync(CREDITS, JSON.stringify(credits, null, 2))
console.log(`\n${Object.keys(credits).length} photographs with credits`)
if (failures.length) {
  console.log(`${failures.length} need a hand-picked override:`)
  for (const f of failures) console.log(`  '${f.query}': 'File:...',`)
  process.exitCode = 1
}
