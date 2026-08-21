/**
 * Wikimedia client shared by the photo and sound fetchers.
 * Policy: a descriptive User-Agent is mandatory (an empty one returns 403),
 * requests go in series and never in parallel, and maxlag is sent because
 * this is a non-interactive task.
 */
export const UA =
  'NamasteIndia/1.0 (https://github.com/OWNER/REPO; tushar.et1@gmail.com) node-fetch'

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
export function vet(ii) {
  const licence = licencePolicy(ii, { hostedOnCommons: ii.imagerepository === 'shared' })
  if (!licence.ok) return licence

  if (NOT_A_PHOTO.test(ii.fileTitle)) return { ok: false, why: 'title suggests a montage, map or satellite image' }
  if (!GOOD_MIME.has(ii.mime)) return { ok: false, why: `mime ${ii.mime}` }
  if (ii.width < 800) return { ok: false, why: `only ${ii.width}px wide` }

  const ratio = ii.width / ii.height
  if (ratio < 0.5 || ratio > 3) return { ok: false, why: `extreme aspect ratio ${ratio.toFixed(2)}` }

  return { ok: true }
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
