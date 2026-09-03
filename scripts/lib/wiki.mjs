/**
 * Wikimedia client shared by the photo and sound fetchers.
 * Policy: a descriptive User-Agent is mandatory (an empty one returns 403),
 * requests go in series and never in parallel, and maxlag is sent because
 * this is a non-interactive task.
 */
export const UA =
  'NamasteIndia/1.0 (https://github.com/tkantk/India; https://github.com/tkantk/India/issues) node-fetch'

export const EN = 'https://en.wikipedia.org/w/api.php'
export const WD = 'https://www.wikidata.org/w/api.php'
export const COMMONS = 'https://commons.wikimedia.org/w/api.php'

export const EM_FILTER = [
  'LicenseShortName', 'License', 'Artist', 'Credit', 'AttributionRequired',
  'UsageTerms', 'LicenseUrl', 'Restrictions', 'Copyrighted', 'NonFree',
].join('|')

const ALLOWED_LICENCE = /^(cc0|pd|cc-by-\d(\.\d)?|cc-by-sa-\d(\.\d)?)$/i
const GOOD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const NOT_A_PHOTO = /collage|montage|composite|diagram|satellite|\bISS\d{3}|\bmaps?\b|\bplan\b|\bsketch\b|\blogo\b|\bseal\b/i

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function api(base, params, tries = 4) {
  const u = new URL(base)
  u.search = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })
  for (let i = 0; i < tries; i++) {
    let res
    try {
      res = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } })
    } catch {
      await sleep(1000 * 2 ** i); continue
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep((Number(res.headers.get('retry-after')) || 2 ** i) * 1000); continue
    }
    const j = await res.json()
    if (j.error?.code === 'maxlag') { await sleep((Number(j.error.lag) || 5) * 1000); continue }
    if (j.error) throw new Error(`${j.error.code}: ${j.error.info}`)
    return j
  }
  throw new Error(`giving up on ${base} after ${tries} attempts`)
}

/** Wikimedia now appends utm_* tracking parameters to returned URLs. */
export const stripQuery = url => { const u = new URL(url); u.search = ''; return u.href }

/** The width actually delivered. iiurlwidth=900 silently gives you 960 while
 *  reporting thumbwidth 900, so never trust the reported number. */
export const realWidth = url => Number(stripQuery(url).match(/\/(\d+)px-/)?.[1]) || null

const text = html => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
const absolutise = html => (html ?? '').replace(/href="\/\//g, 'href="https://')

/**
 * THE licence rule, for every kind of media. Photographs and bird calls differ
 * in mime type, pixel size and aspect ratio; they do not differ in one bit of
 * what makes a licence shippable, so both fetchers ask this same function.
 * vet() below layers the photo-specific checks on top, and fetch-sounds.mjs
 * layers the audio-specific ones.
 *
 * `hostedOnCommons` has to come from the caller and cannot be read off the
 * response, because `imagerepository` describes the file relative to THE WIKI
 * THAT ANSWERED. Ask en.wikipedia, as fetch-photos does, and a Commons file
 * reports "shared" while a fair-use upload reports "local" — the one check
 * that eliminates the entire fair-use category. Ask commons.wikimedia.org, as
 * fetch-sounds does, and every file reports "local", free ones included,
 * because Commons hosts no fair use at all.
 */
export function licencePolicy(ii, { hostedOnCommons }) {
  const g = k => ii.extmetadata?.[k]?.value

  if (!hostedOnCommons) return { ok: false, why: 'local upload, not Commons' }
  if (String(g('NonFree')).toLowerCase() === 'true') return { ok: false, why: 'NonFree' }

  const short = String(g('LicenseShortName') ?? '')
  if (/fair use|non-?free/i.test(short)) return { ok: false, why: `LicenseShortName "${short}"` }

  // Allowlist, never a denylist, and always against the machine-readable
  // `License` code rather than the human-readable short name, which is free
  // text: a legitimately-licensed file can have no machine code at all
  // (GFDL), and those must be rejected.
  const code = String(g('License') ?? '').toLowerCase()
  if (!ALLOWED_LICENCE.test(code)) return { ok: false, why: `licence "${code || short || 'unknown'}" not allowlisted` }

  if (/trademark|personality/i.test(String(g('Restrictions') ?? ''))) {
    return { ok: false, why: `Restrictions ${g('Restrictions')}` }
  }
  return { ok: true }
}

/** licencePolicy plus the checks that only mean anything for a photograph. */
/**
 * A STUFFED ANIMAL IN A GLASS CASE IS WRONG FOR EVERYTHING THIS APP SHOWS,
 * which is why this half lives in `vet()` and applies to landmarks too,
 * unlike `NOT_LIVING_RE` below (paintings, statues, replicas) which is
 * animal-only because a landmark's whole subject can legitimately be a wall
 * painting.
 *
 * Found by a landmark, not an animal card: Manipur's Keibul Lamjao National
 * Park was given `File:CervusEldiAMNH.jpg`, categorised `Taxidermied
 * Rucervus eldii` — a mounted sangai in the American Museum of Natural
 * History standing in for the only floating national park in the world.
 * `vetAnimal` would have caught it; `vetAnimal` never runs on a landmark.
 *
 * "fossil", "skeleton" and "skull" are deliberately NOT here and live in the
 * animal-only rule instead: Puducherry's landmark "The Stone Tree" is a
 * fossilised tree whose photograph is literally `File:Fossil photo2.JPG`.
 * A fossil is the right picture there and the wrong picture on an animal
 * card, which is exactly why the two rules are separate.
 */
const SPECIMEN_RE = /\btaxiderm\w*|museum\s+specimens?|mounted\s+specimens?|\bstuffed\b/i

export function vet(ii) {
  const licence = licencePolicy(ii, { hostedOnCommons: ii.imagerepository === 'shared' })
  if (!licence.ok) return licence

  if (SPECIMEN_RE.test([ii.fileTitle, ...(ii.categories ?? [])].join(' | '))) {
    return { ok: false, why: 'title or category says this is a taxidermied or mounted museum specimen' }
  }
  if (NOT_A_PHOTO.test(ii.fileTitle)) return { ok: false, why: 'title suggests a montage, map or satellite image' }
  if (!GOOD_MIME.has(ii.mime)) return { ok: false, why: `mime ${ii.mime}` }
  if (ii.width < 800) return { ok: false, why: `only ${ii.width}px wide` }

  const ratio = ii.width / ii.height
  if (ratio < 0.5 || ratio > 3) return { ok: false, why: `extreme aspect ratio ${ratio.toFixed(2)}` }

  return { ok: true }
}

/**
 * "A tiger behind concrete answers 'the tiger looks fake' worse than the
 * drawing already does" (Task 5's own brief). There is no field anywhere in
 * Wikimedia's metadata that says "this individual animal is captive" — the
 * only signal available at all is text a human or a WikiProject happened to
 * write, in the file's own title or the Commons categories it was filed
 * under. So this is a heuristic, not a fact-check, and it is honest about
 * the gap: `vetAnimal`'s own test file pins a case it cannot catch (a
 * captive animal whose title and categories name only the species and the
 * place, never the word "zoo" or "captiv*" anywhere) right next to the cases
 * it can.
 *
 * Deliberately does NOT fire on "sanctuary", "national park" or "reserve" —
 * India's own wild, protected habitats are routinely named exactly that way
 * (Ranthambore NATIONAL PARK, Periyar WILDLIFE SANCTUARY), and treating
 * those words as a captivity signal would reject precisely the photographs
 * this project wants.
 */
const ZOO_RE = /\bzoos?\b|\bzoopark\w*|zoological\s+(garden|park)|safari\s+park|wildlife\s+park|animal\s+park|animal\s+kingdom|\btierpark\w*|\bbiopar[ck]\w*|\bcaptiv\w*|\benclosure\b|\baquarium\b|\bmenagerie\b|\bcircus\b|\baviary\b|\bvivarium\b|breeding\s+cent(re|er)|\bpheasantry\b|rescue\s+cent(re|er)|rehabilitation\s+cent(re|er)/i

/**
 * NOT THE ANIMAL AT ALL — a different failure from captivity, and one this
 * project shipped before it was checked for. Himachal Pradesh's western
 * tragopan card was given a seventeenth-century Mughal PAINTING ("A Page of
 * Birds. St. Petersburg Muraqqa..."), and Manipur's sangai card a photograph
 * of a REPLICA. Both passed every gate that existed: the licence was free,
 * the file was on Commons, it was large enough, nothing said "zoo", and the
 * replica was even genuinely photographed in Manipur, so the locality check
 * confirmed it. Nothing anywhere asked whether the thing in the picture was
 * a living animal.
 *
 * That is the exact shape of this project's first device-test complaint —
 * "the images are fake and not original, the tiger and others are fake" —
 * and for an animal card it is worse than having no picture, because the
 * card's own contract (see `PlaceScreen.tsx`'s `photo` note) is a real
 * photograph or nothing, never a stand-in.
 *
 * ANIMAL-ONLY, and that restriction is load-bearing: Jharkhand's Sohrai
 * houses are a landmark whose whole subject IS a wall painting. `vet()`
 * must never learn this rule.
 */
const NOT_LIVING_RE = /\btaxiderm\w*|museum\s+specimens?|mounted\s+specimens?|\bstuffed\b|\bskeletons?\b|\bskulls?\b|\bfossils?\b|\bpaintings?\b|\bdrawings?\b|\billustrat\w*|\bartworks?\b|\bengravings?\b|\blithograph\w*|\bwatercolou?rs?\b|\bsketch(es)?\b|\bmuraqqa\b|\bmanuscripts?\b|\bfolio\b|\bstatues?\b|\bsculptures?\b|\breplicas?\b|\bmodels?\s+of\b/i

/** Does the file's own title or categories say the subject is a painting, a
 *  carving, a stuffed specimen or a model, rather than a living animal?
 *  Same heuristic honesty as `isZooPhoto`: text is the only signal there is. */
export function isNotLivingAnimal(ii) {
  const haystack = [ii.fileTitle, ...(ii.categories ?? [])].join(' | ')
  return NOT_LIVING_RE.test(haystack)
}

/** Checks `ii.fileTitle` and `ii.categories` (an array of Commons category
 *  strings, as `fetch-photos.mjs`'s `fileInfo()` attaches) against `ZOO_RE`.
 *  `categories` is optional — a caller that never asked Commons for them
 *  gets `false` here rather than a crash, which only matters for a caller
 *  that skips `vetAnimal` for exactly that reason (there is none today; it
 *  is here so this function has no silent way to be misused). */
export function isZooPhoto(ii) {
  const haystack = [ii.fileTitle, ...(ii.categories ?? [])].join(' | ')
  return ZOO_RE.test(haystack)
}

/** `vet()` plus the one check that only means anything for an animal photo.
 *  Every landmark photo is still judged by plain `vet()` alone — a fort or a
 *  temple has no "captive" failure mode to check for. */
export function vetAnimal(ii) {
  const base = vet(ii)
  if (!base.ok) return base
  if (isZooPhoto(ii)) return { ok: false, why: 'title or category names a zoo, enclosure or other captive setting' }
  if (isNotLivingAnimal(ii)) return { ok: false, why: 'title or category says this is a painting, carving, model or specimen, not a living animal' }
  return { ok: true }
}

/**
 * "Right species, wrong continent" — this task's own first pass fetched a
 * genuine dromedary photographed in Egypt and a genuine house sparrow
 * photographed in Brooklyn. Both pass `vetAnimal` (right species, free
 * licence, not a zoo) and both are still wrong for a card that tells a
 * six-year-old about the animal that lives HERE. This is the machine-side
 * half of closing that: a locality check `fetch-photos.mjs` uses to PREFER
 * an India-located candidate over one it cannot place, or one it can place
 * outside India. It is not a hard filter — see `localityVerdict`'s own note
 * on why "not established" must never collapse to "reject".
 *
 * India's rough bounding box (mainland plus every island this app draws —
 * see src/data/geo.json's own recorded northernBound of 37.077 for the true
 * detailed shape, which this is a coarse box around, not a copy of). Wide
 * enough for the Andamans/Nicobars (Indira Point, India's own southernmost
 * point, is 6.75°N 93.82°E) and the north-east (Arunachal Pradesh reaches
 * ~97.4°E) without being so wide it would also wave through most of
 * Pakistan or China.
 */
const INDIA_BBOX = { minLat: 6, maxLat: 36, minLon: 68, maxLon: 98 }

/**
 * SRI LANKA, carved out explicitly and checked BEFORE `INDIA_BBOX` — found
 * by this task's own real run, not hypothesised: a "Sri Lankan elephant"
 * candidate, genuinely geotagged at 6.29°N 81.408°E (Yala National Park, SRI
 * LANKA), landed inside the plain India box above and was reported `true`.
 * A flat lat/lon box cannot separate the two countries by latitude alone —
 * Sri Lanka's own range (roughly 5.9-9.9°N) genuinely overlaps India's,
 * because Kanyakumari, India's own mainland southern tip, is 8.08°N, barely
 * north of Sri Lanka's own northern coast. Longitude is what actually
 * separates them at those latitudes: Sri Lanka's own landmass sits within a
 * narrow 79.3-82.1°E band that India's mainland coastline does not reach
 * into at the same latitudes, and the Nicobars — the one Indian territory
 * that shares this latitude band — sit much further east (~93.8°E), well
 * clear of this box. This is a targeted fix for the one neighbour this task
 * actually hit, not a claim that every other neighbour (Bangladesh, Nepal,
 * Bhutan, Pakistan, Myanmar) is similarly guarded against — `localityVerdict`'s
 * own top note already says this is a heuristic, not a fact-check.
 */
const SRI_LANKA_BBOX = { minLat: 5.8, maxLat: 9.9, minLon: 79.3, maxLon: 82.1 }

const inBox = (lat, lon, box) =>
  lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon

/** `true`/`false` against a real `{lat, lon}` Commons geotag, `null` when
 *  there is none to check — "no coordinate" is not the same claim as
 *  "outside India", and must never be reported as `false`. */
export function coordsInIndia(coords) {
  if (!coords || typeof coords.lat !== 'number' || typeof coords.lon !== 'number') return null
  const { lat, lon } = coords
  if (inBox(lat, lon, SRI_LANKA_BBOX)) return false
  return inBox(lat, lon, INDIA_BBOX)
}

/** Builds a regex matching "India", "Indian", or any of the given region
 *  names (state/UT names — the caller passes `src/data/geo.json`'s own list
 *  so this file does not hand-maintain a second copy of it) as a whole
 *  word. Escapes each name (several carry "&" — "Jammu & Kashmir") so a
 *  region name cannot corrupt the pattern. */
export function indiaLocalityRegex(regionNames = []) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const alt = ['india', 'indian', ...regionNames.map(esc)].join('|')
  return new RegExp(`\\b(${alt})\\b`, 'i')
}

/** The fallback signal, for the — common — case of no geotag at all: does
 *  the file's own title or Commons categories say so in plain text. */
export function textNamesIndia(ii, indiaRe = indiaLocalityRegex()) {
  const haystack = [ii.fileTitle, ...(ii.categories ?? [])].join(' | ')
  return indiaRe.test(haystack)
}

/**
 * The countries `INDIA_BBOX` swallows, plus the Southeast Asian ones whose
 * fauna is routinely confused with India's. Every one of these is a country
 * whose photographs this project has a real reason to keep out, not a
 * generic gazetteer: the rectangle above is 6-36N by 68-98E, so Nepal,
 * Bhutan, Bangladesh and large parts of Pakistan, Tibet and Myanmar are
 * *entirely inside it*, and `SRI_LANKA_BBOX` was only ever a carve-out for
 * the one neighbour that had been hit at the time.
 *
 * Thailand, Laos, Vietnam, Cambodia, Malaysia and Indonesia are here for a
 * different reason: they are outside the box, so coordinates already refute
 * them, but a file with NO geotag and a `... in Thailand` category is
 * exactly the Phayre's langur failure this project was warned about by
 * name. Text is the only signal available there.
 *
 * `\b` word boundaries are load-bearing, not decoration: "Chinese" must not
 * match "China", or this app's own Kerala landmark — the Chinese fishing
 * nets at Fort Kochi, in India — refutes itself.
 */
const OTHER_COUNTRIES = [
  'Nepal', 'Bhutan', 'Bangladesh', 'Pakistan', 'China', 'Tibet', 'Myanmar',
  'Burma', 'Sri Lanka', 'Afghanistan', 'Thailand', 'Laos', 'Vietnam',
  'Cambodia', 'Malaysia', 'Indonesia', 'Singapore',
]
const OTHER_COUNTRY_RE = new RegExp(`\\b(${OTHER_COUNTRIES.join('|')})\\b`, 'i')

/** Does the file's own title or Commons categories name a country that is
 *  not India? Commons categorises systematically ("Antilope cervicapra in
 *  Nepal"), which makes this a far stronger signal than its crudeness
 *  suggests — it is the uploader's own statement of where the animal was. */
export function textNamesOtherCountry(ii) {
  const haystack = [ii.fileTitle, ...(ii.categories ?? [])].join(' | ')
  return OTHER_COUNTRY_RE.test(haystack)
}

/**
 * TRI-STATE, on purpose: `true` (confirmed India), `false` (confirmed
 * elsewhere), or `null` (not established either way) — never a boolean
 * defaulting a "don't know" to "no". Coordinates are checked first and are
 * definitive when present; title/category text is the fallback.
 *
 * The `null` case is not a hypothetical: this task's own Asian elephant
 * (Bandipur National Park, Karnataka — genuinely India) carries neither
 * coordinates nor any category or title text naming India or a state, only
 * the park's own name, which nothing here has a gazetteer to recognise.
 * Reporting that as `false` would have caused the caller to actively
 * PREFER a worse, non-Indian candidate over a genuinely Indian one it
 * simply couldn't prove — worse than doing nothing. A human still has to
 * close that specific gap; this function's job is only to never claim
 * false confidence in the meantime.
 */
export function localityVerdict(ii, indiaRe = indiaLocalityRegex()) {
  // AN EXPLICIT STATEMENT OUTRANKS A CRUDE RECTANGLE, and this ordering is
  // the whole point — it is checked BEFORE the coordinate, reversing what
  // the rest of this function's own comment says about coordinates being
  // definitive, because a real shipped file proved that claim too strong.
  // The blackbuck used by Andhra Pradesh and Punjab was geotagged 28.248N
  // 81.325E — inside `INDIA_BBOX`, so the rectangle said India — while its
  // only category was `Antilope cervicapra in Nepal`. Bardiya is in Nepal.
  // The box cannot know that; Commons already did.
  //
  // Carving Nepal out by bbox the way Sri Lanka was is NOT available as a
  // fix: a Nepal rectangle overlaps Bihar, Uttar Pradesh, Sikkim and north
  // Bengal, so it would refute genuinely Indian photographs to catch this
  // one. Sri Lanka only worked because a longitude band happens to separate
  // it; India's northern neighbours have no such band.
  //
  // Requiring the text to name another country AND NOT India keeps a range
  // category ("Mammals of India and Nepal") from refuting anything — that
  // describes where a species lives, not where the shutter was.
  if (textNamesOtherCountry(ii) && !textNamesIndia(ii, indiaRe)) return false
  const byCoords = coordsInIndia(ii.coordinates)
  if (byCoords !== null) return byCoords
  if (textNamesIndia(ii, indiaRe)) return true
  return null
}

export function attribution(ii) {
  const g = k => ii.extmetadata?.[k]?.value
  const code = String(g('License') ?? '').toLowerCase()
  const short = g('LicenseShortName') ?? g('UsageTerms') ?? code
  const url = g('LicenseUrl') ?? null
  const page = ii.descriptionurl
  const isPublicDomain = code === 'pd' || code === 'cc0'
  const artistHtml = absolutise(g('Artist')) || 'Unknown author'
  const licenceHtml = url ? `<a href="${url}" rel="license noopener">${short}</a>` : short

  return {
    artist: text(g('Artist')) || 'Unknown author',
    licence: code || short,
    licenceShort: short,
    licenceUrl: url,
    attributionRequired: String(g('AttributionRequired') ?? (isPublicDomain ? 'false' : 'true')) === 'true',
    descriptionUrl: page,
    attributionHtml: isPublicDomain
      ? `${artistHtml}, <a href="${page}">via Wikimedia Commons</a> (${licenceHtml})`
      : `${artistHtml}, ${licenceHtml}, <a href="${page}">via Wikimedia Commons</a>`,
  }
}
