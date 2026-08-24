#!/usr/bin/env node
/**
 * The re-runnable half of Task 4. docs/fact-check.md was a prose record: it
 * described sources by publication title, quoted a few of them, and could
 * not be re-checked by anything but a human re-reading it. This script is
 * what content/fact-check.json is FOR — every row's verification is exactly
 * one of three kinds:
 *
 *   fetched  — a URL plus the exact words the page must contain. This script
 *              re-opens it. A non-2xx response, a timeout, or a page that no
 *              longer contains those words is a FAILURE, never a silent pass.
 *              That single rule is what would have caught the Britannica rows
 *              docs/fact-check.md's own preamble confesses to.
 *   cited    — a real source with no fetchable URL (a printed report, a
 *              volume-and-page citation), plus the quoted words and where
 *              they appear. This script cannot confirm the words are true —
 *              it can only confirm the row is COMPLETE (source, quote,
 *              location all present) and count how many claims rest on
 *              human reading alone.
 *   derived  — recomputed from this repo's own data: neighbour lists and
 *              polygon geometry in src/data/geo.json, or a row's own line id
 *              against the content that actually ships. Fully re-checkable,
 *              no network required.
 *
 * A row with no verification, or a verification whose type is not one of
 * the three above, FAILS. It does not warn — see README below and the task
 * brief: "A row with no verification at all must fail. Not warn."
 *
 * Usage: node scripts/fact-check.mjs [path-to-fact-check.json]
 * Defaults to content/fact-check.json. The optional argument exists so the
 * three deliberate-breakage proofs (403, changed quote, missing
 * verification) can run against a scratch fixture without touching the
 * real file — see docs/fact-check.md and task-4-report.md for what those
 * proofs printed.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const FILE = process.argv[2] ?? 'content/fact-check.json'
const GEO_FILE = 'src/data/geo.json'
const PLACES_DIR = 'content/places'

// A descriptive, ordinary-browser-looking User-Agent. An empty or generic
// fetch UA returns 403 from several real, live government sources this file
// cites (asi.nic.in, incredibleindia.gov.in) even though `curl` with a
// browser UA reaches them fine — the same false-403 docs/fact-check.md's own
// preamble already found and named for Wikimedia. Getting this wrong here
// would make the gate cry wolf on live sources exactly the way the first
// pass cried wolf on india.gov.in.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 NamasteIndiaFactCheck/1.0 ' +
  '(+https://github.com/tkantk/India)'
const FETCH_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------- content

/** Every line id the app actually ships, from the same three files
 *  scripts/validate-content.mjs walks. A fact-check row whose `line` is not
 *  in this set is checking something nobody will ever hear. */
function contentLineIds() {
  const ids = new Set()
  const dir = PLACES_DIR
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : []
  for (const f of files) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    ids.add(p.intro.id)
    for (const l of Object.values(p.card)) ids.add(l.id)
    for (const lm of p.landmarks) ids.add(lm.line.id)
  }
  for (const [file, key] of [['content/tour.json', 'beats'], ['content/ui.json', 'lines']]) {
    if (!existsSync(file)) continue
    for (const l of JSON.parse(readFileSync(file, 'utf8'))[key]) ids.add(l.id)
  }
  return ids
}

// ----------------------------------------------------------- derived data

/** Signed shoelace area of one polygon ring. */
function ringArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Area of an SVG path `d` string built only from M/L/Z (every place in
 *  geo.json is). Split at each M into subpaths and sum SIGNED ring areas
 *  before taking one absolute value at the end, not per subpath — holes are
 *  wound opposite to their outer ring (mapbox/geojson-rewind), so summing
 *  signed areas first is what makes a hole subtract rather than add. */
function pathArea(d) {
  const subpaths = d.split(/(?=M)/).filter(Boolean)
  let total = 0
  for (const sp of subpaths) {
    const nums = sp.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
    const pts = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
    total += ringArea(pts)
  }
  return Math.abs(total)
}

function checkDerived(v, geo) {
  switch (v.check) {
    case 'neighbours': {
      const place = geo.places[v.place]
      if (!place) return { ok: false, why: `"${v.place}" is not a place in ${GEO_FILE}` }
      const missing = v.of.filter(n => !place.neighbours.includes(n))
      return missing.length
        ? { ok: false, why: `${GEO_FILE} lists ${v.place}'s neighbours as [${place.neighbours.join(', ')}] — missing ${missing.join(', ')}` }
        : { ok: true }
    }
    case 'placeCount': {
      const all = Object.values(geo.places)
      const n = v.kind === 'total' ? all.length : all.filter(p => p.type === v.kind).length
      return n === v.expect
        ? { ok: true }
        : { ok: false, why: `${GEO_FILE} has ${n} place(s) of kind "${v.kind}", expected ${v.expect}` }
    }
    case 'largestByArea': {
      const among = Object.entries(geo.places).filter(([, p]) => p.type === v.among)
      if (!among.length) return { ok: false, why: `no places of type "${v.among}" in ${GEO_FILE}` }
      const areas = among.map(([slug, p]) => [slug, pathArea(p.d)]).sort((a, b) => b[1] - a[1])
      const winner = areas[0][0]
      return winner === v.place
        ? { ok: true }
        : { ok: false, why: `computed geometry ranks "${winner}" largest, not "${v.place}" ` +
            `(top 3: ${areas.slice(0, 3).map(([s, a]) => `${s}=${a.toFixed(0)}`).join(', ')})` }
    }
    case 'palindrome': {
      const w = String(v.word ?? '').toLowerCase()
      const rev = [...w].reverse().join('')
      return w.length > 0 && w === rev ? { ok: true } : { ok: false, why: `"${v.word}" is not a palindrome` }
    }
    default:
      return { ok: false, why: `unknown derived check "${v.check}"` }
  }
}

// -------------------------------------------------------------- fetching

/** Strip tags/scripts/styles, decode the handful of entities these sources
 *  actually use, collapse whitespace, and — the part that matters — remove
 *  the space HTML tag-stripping leaves before punctuation whenever a
 *  citation marker or wikilink sits right before a comma or period (e.g.
 *  Wikipedia's "<a>territories</a><sup>[1]</sup>, for a total" becomes
 *  "territories , for" once tags are gone). Applied to both the fetched
 *  page and the `contains` string, so quotes can be written as normal prose
 *  without knowing which page structure they'll land next to. */
function normalise(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)\]])/g, '$1')
    .trim()
}

function stripHtml(html) {
  return normalise(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

async function fetchPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` }
    return { ok: true, text: stripHtml(await res.text()) }
  } catch (e) {
    return { ok: false, why: e?.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS}ms` : String(e?.message ?? e) }
  } finally {
    clearTimeout(timer)
  }
}

// -------------------------------------------------------------- row shape

/** Structural completeness only — "is this row well-formed", not "is it
 *  true". A row with no verification, or a verification of an unknown
 *  type, or a fetched/cited row missing a required field, fails here and
 *  is never counted toward the fetched/cited/derived mix. */
function rowProblems(row, ids) {
  const problems = []
  if (!row.id) problems.push('missing "id"')
  if (!row.line) problems.push('missing "line"')
  else if (!ids.has(row.line)) problems.push(`line id "${row.line}" does not exist in ${PLACES_DIR}, content/tour.json or content/ui.json`)
  if (!row.claim || !String(row.claim).trim()) problems.push('missing "claim"')

  const v = row.verification
  if (!v || !v.type) { problems.push('missing "verification" — a row with no verification must fail, not warn'); return problems }
  if (!['fetched', 'cited', 'derived'].includes(v.type)) {
    problems.push(`verification.type "${v.type}" is not one of fetched, cited, derived`)
    return problems
  }
  if (v.type === 'cited') {
    if (!v.source) problems.push('cited row missing "source"')
    if (!v.quote) problems.push('cited row missing "quote"')
    if (!v.location) problems.push('cited row missing "location"')
  }
  if (v.type === 'fetched') {
    if (!Array.isArray(v.sources) || v.sources.length === 0) problems.push('fetched row missing "sources" (non-empty array)')
    else for (const [i, s] of v.sources.entries()) {
      if (!s.url) problems.push(`fetched row sources[${i}] missing "url"`)
      if (!s.contains) problems.push(`fetched row sources[${i}] missing "contains"`)
    }
  }
  if (v.type === 'derived' && !v.check) problems.push('derived row missing "check"')
  return problems
}

// ------------------------------------------------------------------ main

if (!existsSync(FILE)) {
  console.error(`✗ ${FILE} does not exist`)
  process.exit(1)
}
if (!existsSync(GEO_FILE)) {
  console.error(`✗ ${GEO_FILE} does not exist — run npm run build:map first`)
  process.exit(1)
}

const data = JSON.parse(readFileSync(FILE, 'utf8'))
const geo = JSON.parse(readFileSync(GEO_FILE, 'utf8'))
const ids = contentLineIds()

if (!Array.isArray(data.rows) || data.rows.length === 0) {
  console.error(`✗ ${FILE}: "rows" must be a non-empty array`)
  process.exit(1)
}

const problems = []
const counts = { fetched: 0, cited: 0, derived: 0 }
const seenRowIds = new Set()
const toFetch = []

for (const [i, row] of data.rows.entries()) {
  const where = row.id || row.line || `rows[${i}]`
  if (row.id) {
    if (seenRowIds.has(row.id)) problems.push(`${where}: duplicate row id`)
    seenRowIds.add(row.id)
  }
  const rp = rowProblems(row, ids)
  if (rp.length) { for (const p of rp) problems.push(`${where}: ${p}`); continue }

  counts[row.verification.type]++
  if (row.verification.type === 'derived') {
    const r = checkDerived(row.verification, geo)
    if (!r.ok) problems.push(`${where}: derived check "${row.verification.check}" — ${r.why}`)
  }
  if (row.verification.type === 'fetched') {
    for (const src of row.verification.sources) toFetch.push({ where, ...src })
  }
}

// Fetches run in series, never in parallel — the same politeness policy
// scripts/lib/wiki.mjs already documents for Wikimedia, applied here to
// every host this file touches. A cache means a URL cited by more than one
// row (several Wikipedia pages back two or three claims each) is only
// fetched once.
if (toFetch.length) {
  const uniqueUrls = [...new Set(toFetch.map(t => t.url))]
  console.log(`Fetching ${uniqueUrls.length} source(s) for ${toFetch.length} fetched-type check(s)…`)
  const pages = new Map()
  for (const url of uniqueUrls) pages.set(url, await fetchPage(url))

  for (const t of toFetch) {
    const page = pages.get(t.url)
    if (!page.ok) { problems.push(`${t.where}: fetch ${t.url} — ${page.why}`); continue }
    if (!page.text.includes(normalise(t.contains))) {
      problems.push(`${t.where}: ${t.url} no longer contains "${t.contains}"`)
    }
  }
}

const total = counts.fetched + counts.cited + counts.derived
console.log(`\n${data.rows.length} rows: ${counts.fetched} fetched, ${counts.cited} cited, ${counts.derived} derived` +
  (total !== data.rows.length ? ` (${data.rows.length - total} malformed, see below)` : ''))

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log('fact-check OK')
