/**
 * THREE SOURCES BEYOND WIKIMEDIA COMMONS, for media Commons simply does not
 * have: real, located recordings of Indian wildlife, and field recordings of
 * Indian places.
 *
 *   iNaturalist  — research-grade observations with sounds and photos, each
 *                  with the place it was recorded. Open API, no key.
 *   xeno-canto   — bird (and some other) recordings, rich in India. API v3
 *                  needs XENO_CANTO_API_KEY.
 *   Freesound    — field recordings and effects. Needs FREESOUND_API_KEY;
 *                  the 128 kbps HQ preview downloads with the same token.
 *
 * Every source states its licence differently, so everything is first
 * normalised into the one code format Commons uses ("cc-by-nc-sa-4.0") and
 * then judged by THE SAME allowlist the photos and Commons sounds already
 * pass through (`licenceCodeOk`, wiki.mjs). No source gets its own rule.
 *
 * Nothing here chooses. Each adapter returns CANDIDATES in one shape; the
 * candidate tool measures them and a human (or a reviewer reading
 * spectrograms) picks, exactly as photos are picked from thumbnails.
 */
import { licenceCodeOk, isNonCommercial, UA, sleep } from './wiki.mjs'

const INDIA_PLACE_ID = 6681 // iNaturalist's place id for India

/**
 * One licence, in Commons' code format, from whatever a source hands over:
 *   iNaturalist  "cc-by-nc"                                  (no version: 4.0)
 *   xeno-canto   "//creativecommons.org/licenses/by-nc-sa/4.0/"
 *   Freesound    "http://creativecommons.org/licenses/by/4.0/"
 *                "http://creativecommons.org/publicdomain/zero/1.0/"
 * Returns null for anything it cannot read — and "cannot read" must fail
 * closed, so a null is always rejected by the caller.
 */
export function normaliseLicence(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (/publicdomain\/zero|^cc0$/.test(s)) {
    return { code: 'cc0', short: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }
  }
  if (/publicdomain\/mark|^pd$/.test(s)) {
    return { code: 'pd', short: 'Public domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/' }
  }
  // A Creative Commons URL: .../licenses/<type>/<version>/
  let m = s.match(/creativecommons\.org\/licenses\/([a-z+-]+)\/(\d\.\d)/)
  let type, version
  if (m) { [, type, version] = m } else {
    // iNaturalist's bare code, which carries no version; iNaturalist has
    // offered the 4.0 licences since 2017 and states them as such on its pages.
    m = s.match(/^cc-(by(?:-nc)?(?:-sa|-nd)?)$/)
    if (!m) return null
    type = m[1]
    version = '4.0'
  }
  if (!/^by(-nc)?(-sa|-nd)?$/.test(type)) return null // e.g. "sampling+"
  const code = `cc-${type}-${version}`
  const short = `CC ${type.toUpperCase()} ${version}`
  return { code, short, url: `https://creativecommons.org/licenses/${type}/${version}/` }
}

/** Escape text that came from a stranger before it is put into HTML the app
 *  renders with dangerouslySetInnerHTML (Credits.tsx). A recordist's display
 *  name is free text on all three sites. */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const SOURCE_NAME = { inat: 'iNaturalist', xc: 'xeno-canto', freesound: 'Freesound' }

/**
 * The credit record — the same fields the Commons pipelines write (artist,
 * licence, licenceShort, licenceUrl, attributionRequired, descriptionUrl,
 * attributionHtml), so Credits.tsx renders every source the same way, plus
 * `source` and `nonCommercial`.
 */
export function attributionFor(c) {
  const lic = normaliseLicence(c.licence)
  if (!lic) throw new Error(`unreadable licence "${c.licence}" for ${c.source}:${c.ref}`)
  const isPublicDomain = lic.code === 'cc0' || lic.code === 'pd'
  const artist = c.artist || 'Unknown recordist'
  const via = `<a href="${esc(c.pageUrl)}">via ${SOURCE_NAME[c.source] ?? c.source}</a>`
  const licenceHtml = `<a href="${lic.url}" rel="license noopener">${lic.short}</a>`
  return {
    source: c.source,
    artist,
    licence: lic.code,
    licenceShort: lic.short,
    licenceUrl: lic.url,
    attributionRequired: !isPublicDomain,
    descriptionUrl: c.pageUrl,
    nonCommercial: isNonCommercial(lic.code),
    attributionHtml: isPublicDomain
      ? `${esc(artist)}, ${via} (${licenceHtml})`
      : `${esc(artist)}, ${licenceHtml}, ${via}`,
  }
}

/** Does this candidate's licence pass the project's one allowlist? */
export function licenceOk(c) {
  const lic = normaliseLicence(c.licence)
  return lic ? { ok: licenceCodeOk(lic.code), code: lic.code } : { ok: false, code: null }
}

// --------------------------------------------------------------- adapters
//
// Each returns candidates in ONE shape:
//   { source, ref, title, artist, licence, pageUrl, download, seconds,
//     place, lat, lon, inIndia, quality }
// `inIndia` is true / false / null, the same tri-state the photo pipeline's
// localityVerdict uses: null means "not established", never "no".

const getJson = async (url, fetchImpl = fetch) => {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/(key|token)=[^&]+/, '$1=…')}`)
  return res.json()
}

/**
 * THE EXACT SPECIES, never "the first search hit". The first version looked
 * the taxon up with `taxa?q=Panthera tigris&per_page=1`, which returned the
 * GENUS Panthera — and the "tiger" candidates came back as Indian leopards
 * and Gir lions. That is this project's founding mistake (a "camel" that was
 * the wrong camel) arriving in sound instead of pictures.
 *
 * So: `taxon_name=` on the observations endpoint, which iNaturalist matches
 * by name and includes the taxon's own subspecies; then every observation is
 * checked again (`sameTaxon`) against the binomial asked for, so a genus or a
 * sister species can never come back even if the API's matching changes.
 */
async function inatObservations(taxonName, kind, { perPage = 30, fetchImpl } = {}) {
  const j = await getJson(
    `https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(taxonName)}` +
    `&${kind}=true&quality_grade=research&place_id=${INDIA_PLACE_ID}&per_page=${perPage}` +
    `&order_by=votes&captive=false`, fetchImpl)
  return inatToCandidates(j, kind, taxonName)
}

/** iNaturalist research-grade observations of one species that carry SOUNDS,
 *  recorded in India. */
export const inatSounds = (taxonName, opts) => inatObservations(taxonName, 'sounds', opts)

/** The same, for PHOTOS — for animal cards Commons cannot illustrate. */
export const inatPhotos = (taxonName, opts) => inatObservations(taxonName, 'photos', opts)

/** Is this observation's taxon the one asked for, or one of its own
 *  subspecies? "Panthera tigris tigris" matches "Panthera tigris";
 *  "Panthera pardus fusca" and the genus "Panthera" do not. */
export function sameTaxon(observed, wanted) {
  const o = String(observed ?? '').toLowerCase().trim()
  const w = String(wanted ?? '').toLowerCase().trim()
  return o === w || o.startsWith(`${w} `)
}

/** Exported for the tests: one observations response, as candidates. */
export function inatToCandidates(j, kind, wanted = null) {
  const out = []
  for (const o of j.results ?? []) {
    if (wanted && !sameTaxon(o.taxon?.name, wanted)) continue
    const media = kind === 'sounds' ? (o.sounds ?? []) : (o.photos ?? [])
    for (const m of media) {
      if (!m.license_code) continue // all rights reserved
      const [lon, lat] = o.geojson?.coordinates ?? []
      out.push({
        source: 'inat',
        ref: `${kind === 'sounds' ? 's' : 'p'}${m.id}`,
        title: `${o.taxon?.preferred_common_name ?? o.taxon?.name ?? 'observation'} — ${o.place_guess ?? ''}`.trim(),
        artist: o.user?.name || o.user?.login || null,
        licence: m.license_code,
        pageUrl: o.uri ?? `https://www.inaturalist.org/observations/${o.id}`,
        download: kind === 'sounds' ? m.file_url : String(m.url ?? '').replace('/square.', '/large.'),
        seconds: null,
        place: o.place_guess ?? null,
        lat: lat ?? null,
        lon: lon ?? null,
        // Queried with place_id=India, so iNaturalist itself has placed it.
        inIndia: true,
        captive: Boolean(o.captive),
        quality: o.quality_grade,
      })
    }
  }
  return out
}

/** xeno-canto v3. `query` is v3 tag syntax, e.g. 'sp:"Ardea alba" cnt:India'. */
export async function xenoCanto(query, { key = process.env.XENO_CANTO_API_KEY, fetchImpl } = {}) {
  if (!key) throw new Error('XENO_CANTO_API_KEY is not set (.env)')
  const j = await getJson(`https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent(query)}&key=${key}`, fetchImpl)
  return xcToCandidates(j)
}

const xcSeconds = (len) => {
  const [m, s] = String(len ?? '').split(':').map(Number)
  return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null
}
const https = (u) => (String(u ?? '').startsWith('//') ? `https:${u}` : u)

export function xcToCandidates(j) {
  return (j.recordings ?? []).map((r) => ({
    source: 'xc',
    ref: String(r.id),
    title: `${r.en ?? `${r.gen} ${r.sp}`} — ${r.type ?? ''} — ${r.loc ?? ''}`.trim(),
    artist: r.rec ?? null,
    licence: https(r.lic),
    pageUrl: https(r.url) ?? `https://xeno-canto.org/${r.id}`,
    download: https(r.file),
    seconds: xcSeconds(r.length),
    place: r.loc ?? null,
    lat: r.lat != null ? Number(r.lat) : null,
    lon: r.lon != null ? Number(r.lon) : (r.lng != null ? Number(r.lng) : null),
    inIndia: r.cnt ? /^india$/i.test(r.cnt) : null,
    quality: r.q ?? null,
  }))
}

/** Freesound text search. `filter` is Freesound filter syntax. */
export async function freesound(query, { key = process.env.FREESOUND_API_KEY, filter = 'duration:[2 TO 300]', pageSize = 15, fetchImpl } = {}) {
  if (!key) throw new Error('FREESOUND_API_KEY is not set (.env)')
  const fields = 'id,name,license,duration,username,previews,url,geotag,tags,avg_rating,num_downloads,description'
  const j = await getJson(
    `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}&filter=${encodeURIComponent(filter)}` +
    `&fields=${fields}&page_size=${pageSize}&sort=score&token=${key}`, fetchImpl)
  return fsToCandidates(j)
}

/**
 * Is a Freesound recording from India? Text first, geotag second — and the
 * first version of this got two things wrong, both found by its own first
 * run: "Mu Ko Lanta National Marine Park - Thailand" and a sound-design
 * "Crashing Starship" both came back marked India.
 *
 *   1. Every place name needs WORD BOUNDARIES. Unbounded, "goa" matched
 *      inside "goal" and "thar" inside "thank".
 *   2. "Andaman" is not India on its own — the Andaman SEA is Thailand's and
 *      Myanmar's coast too. So, exactly as the photo pipeline's
 *      localityVerdict does: a recording whose text names ANOTHER country
 *      (and not India) is not from India, whatever else it mentions.
 */
// NOT 'indian': species are named for India everywhere — "Indian
// rhinoceros", "Indian roller" — and a Freesound file titled "Indian
// rhinoceros (Rhinoceros unicornis)" was flagged as India by that word alone
// when it was in fact recorded in a European zoo. A recording genuinely made
// in India nearly always says "India" itself, in its title, tags or text.
const INDIA_WORDS = ['india', 'rajasthan', 'delhi', 'mumbai', 'kolkata', 'kerala', 'ladakh',
  'himalaya', 'himalayas', 'goa', 'punjab', 'tamil', 'chennai', 'bengal', 'varanasi', 'andaman', 'lakshadweep',
  'karnataka', 'bangalore', 'bengaluru', 'gujarat', 'kutch', 'thar', 'jaisalmer', 'assam', 'sikkim',
  'darjeeling', 'hampi', 'madurai', 'odisha', 'puducherry', 'pondicherry', 'hyderabad', 'agra', 'jaipur']
const INDIA_TEXT = new RegExp(`\\b(${INDIA_WORDS.join('|')})\\b`, 'i')
const OTHER_COUNTRY = /\b(thailand|thai|nepal|bhutan|bangladesh|pakistan|china|tibet|myanmar|burma|sri lanka|malaysia|indonesia|bali|vietnam|cambodia|laos|philippines|maldives)\b/i
const inIndiaBox = (lat, lon) => lat >= 6 && lat <= 36 && lon >= 68 && lon <= 98

/** true / false / null — the same tri-state as the photo pipeline. */
export function fsInIndia(text, lat, lon) {
  const other = OTHER_COUNTRY.test(text)
  const named = INDIA_TEXT.test(text)
  if (other && !/\bindia\b/i.test(text)) return false
  if (named) return true
  if (Number.isFinite(lat) && Number.isFinite(lon)) return inIndiaBox(lat, lon) && !other ? true : false
  return null
}

export function fsToCandidates(j) {
  return (j.results ?? []).map((r) => {
    const [lat, lon] = String(r.geotag ?? '').split(/\s+/).map(Number)
    const text = [r.name, ...(r.tags ?? []), r.description ?? ''].join(' ')
    const inIndia = fsInIndia(text, lat, lon)
    return {
      source: 'freesound',
      ref: String(r.id),
      title: r.name,
      artist: r.username ?? null,
      licence: r.license,
      pageUrl: r.url ?? `https://freesound.org/s/${r.id}/`,
      download: r.previews?.['preview-hq-mp3'] ?? null,
      seconds: typeof r.duration === 'number' ? r.duration : null,
      place: inIndia === true ? 'India (title, tags or geotag)' : null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      inIndia,
      quality: r.avg_rating ? `rating ${r.avg_rating.toFixed(1)} (${r.num_downloads} dl)` : null,
    }
  })
}
