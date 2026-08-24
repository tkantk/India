#!/usr/bin/env node
/**
 * Task 5: put India in an ocean that has other land in it.
 *
 * THE PROBLEM THIS FIXES. `build-map.mjs` draws India, alone, in unbroken
 * pale blue on every side. Nothing in the tour's narration ever names a
 * neighbour (verified against every beat — see task-5-brief.md), so the map
 * was never contradicting anything it said. It was making its own claim
 * instead: that there is nothing else out there. A six-year-old looking at
 * that reasonably concludes India is an island, and nothing corrects him.
 * This script draws the real land beyond the border — Pakistan, China,
 * Nepal, Bhutan, Bangladesh, Myanmar, Sri Lanka and a few more within a
 * generous box around India — muted and flat, so it reads as "there is more
 * world here" without ever competing with India itself.
 *
 * THE PROJECTION MUST MATCH build-map.mjs's EXACTLY, or this layer drifts
 * out from under India's own coastline the moment either map is rebuilt.
 * `lib/projection.mjs` is the one place that computes it; this script
 * imports `indiaProjection`, it does not re-fit its own.
 *
 * THE ERASE, NOT JUST A COUNTRY FILTER. Dropping the feature whose ISO_A3 is
 * "IND" is not enough to guarantee no neighbour polygon overlaps Indian
 * territory: Natural Earth's own India polygon reaches only 35.5N — the
 * de-facto Line of Control — the SAME de-facto figure `build-map.mjs`'s own
 * depiction gate exists to reject in favour of the official Survey of India
 * line at ~37.08N. And Natural Earth carries at least one separate
 * "Indeterminate" feature — Siachen Glacier, sovereignty "Kashmir",
 * ISO_A3 -99 — that an ISO filter would not touch at all. So every candidate
 * neighbour polygon is ERASED against India's own dissolved, OFFICIALLY
 * depicted boundary (the same 36-state feature collection the depiction gate
 * already verified), not merely filtered by name. What survives the erase is
 * land nobody would look at and call India.
 *
 * Run after `npm run build:map` (this script reads its cached
 * `build/map/india-states.geojson`, which `npm run build:map` writes en
 * route to `src/data/geo.json`).
 *
 * Output: `src/data/world.json`. `npm run build:world`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import rewind from '@mapbox/geojson-rewind'
import { geoBounds } from 'd3-geo'
import { slugify, simplifyRing } from './lib/geo.mjs'
import { indiaProjection, W, H } from './lib/projection.mjs'

const RAW = 'build/world'
const STATES = 'build/map/india-states.geojson'
const NE_URL = 'https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip'
const ATTRIBUTION = 'Neighbouring coastlines from Natural Earth (public domain)'

// A generous box around India, in lon/lat degrees — big enough to catch every
// bordering country whole or in comfortable part (Pakistan, Afghanistan's
// eastern tip, a slice of China/Tibet, Nepal, Bhutan, Bangladesh, Myanmar,
// Sri Lanka, the Maldives) and crop the huge ones (China, Myanmar) at the box
// edge rather than pull in their entire, much-larger extent. Measured against
// today's Natural Earth data: Pakistan/Afghanistan's western edge is ~60.5E,
// Myanmar's eastern edge is ~101.2E, the Maldives' southern tip is ~3.2N —
// this clears all three with margin to spare.
const BBOX = [58, -1, 102, 40]

if (!existsSync(STATES)) {
  console.error(`${STATES} does not exist. Run "npm run build:map" first.`)
  process.exit(1)
}

mkdirSync(RAW, { recursive: true })

// 1. Fetch and cache the Natural Earth 1:50m Admin 0 (Countries) shapefile,
//    zipped — the same "skip if already here" caching build-map.mjs uses for
//    the DataMeet shapefile, and for the same reason: it is 800 KB fetched
//    from a public CDN, not something to re-download on every build.
const zipPath = `${RAW}/ne_50m_admin_0_countries.zip`
if (!existsSync(zipPath)) {
  console.log('fetching ne_50m_admin_0_countries.zip')
  const res = await fetch(NE_URL)
  if (!res.ok) throw new Error(`Natural Earth fetch failed: HTTP ${res.status}`)
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
}

// mapshaper cannot be pointed at the .shp *inside* an unopened zip alongside
// its README/VERSION siblings and reliably pick the right file — tested, it
// does not. Unzipped once; re-unzipping every run is cheap and keeps this
// script idempotent regardless of what a previous run left behind.
execFileSync('unzip', ['-o', '-q', zipPath, '-d', RAW])
const SHP = `${RAW}/ne_50m_admin_0_countries.shp`

// 2. Dissolve India's own 36 states — unsimplified, the exact feature
//    collection the depiction gate below re-verifies — into one polygon.
//    This is the erase mask: whatever a neighbour shares with this is not
//    neighbour land, it is India's, and `svg.base` already draws it, opaque,
//    on top of this layer. Done in lon/lat degrees, before any projection —
//    much simpler and more numerically robust than clipping post-projection.
console.log('dissolving India\'s own depicted boundary (the erase mask)')
const maskPath = `${RAW}/india-dissolved.geojson`
execFileSync('npx', [
  'mapshaper', STATES,
  '-dissolve',
  '-o', 'precision=0.0001', maskPath, 'format=geojson',
], { stdio: 'inherit' })

// Same depiction gate build-map.mjs runs, re-checked here rather than trusted
// from the last time build:map ran: if STATES is ever regenerated from a
// de-facto (not official) source, this script must refuse to erase against
// the wrong line rather than silently draw a China that swallows Ladakh.
{
  const statesFc = rewind(JSON.parse(readFileSync(STATES, 'utf8')), true)
  const [, [, north]] = geoBounds(statesFc)
  if (north < 36.5) {
    throw new Error(
      `${STATES}'s northern bound is ${north.toFixed(3)}N, expected ~37.07N. ` +
      'This is the de-facto depiction, not the official one. Refusing to erase against it.',
    )
  }
}

// 3. Every country but India, cropped to the generous box, then erased
//    against India's own boundary — not just clipped to it, ERASED, so a
//    disputed sliver Natural Earth attributes to nobody in particular
//    (Siachen Glacier, ISO_A3 -99, sovereignty "Kashmir") is cut exactly
//    where it overlaps Indian territory as this app depicts it, the same as
//    every ordinary country.
console.log('filtering, clipping and erasing against India\'s depicted boundary')
const neighboursPath = `${RAW}/neighbours.geojson`
execFileSync('npx', [
  'mapshaper', SHP,
  '-filter', 'ISO_A3 != "IND"',
  '-clip', `bbox=${BBOX.join(',')}`,
  '-erase', `source=${maskPath}`, 'remove-slivers',
  '-o', 'precision=0.0001', neighboursPath, 'format=geojson',
], { stdio: 'inherit' })

const raw = JSON.parse(readFileSync(neighboursPath, 'utf8'))
const fc = rewind(raw, true)

// 4. THE SHARED PROJECTION, fitted against India's own states — not this
//    script's much larger neighbours extent. Fitting against a different
//    feature collection would derive a different scale and translate and
//    this whole layer would sit in the wrong place under `svg.base`.
const indiaFc = rewind(JSON.parse(readFileSync(STATES, 'utf8')), true)
const projection = indiaProjection(indiaFc)

const ringsOf = (geom) =>
  geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()

// Background art, never tapped and never zoomed to on its own — a screen-
// space error an order of magnitude looser than the 0.3 units build-map.mjs
// holds actual, interactive Indian states to.
const SIMPLIFY_ERROR = 1.0

/**
 * A ring whose projected fill area is smaller than this is invisible at any
 * size this map is ever shown at, and is dropped rather than kept as a
 * rounding-noise sliver.
 *
 * AREA, not bounding-box extent: a ring that `simplifyRing` has reduced to
 * two or three near-collinear points can still have a wide, thin bounding
 * box — a diagonal line reads as "3 units across" by extent while enclosing
 * almost no fill at all. Measured exactly this way: erasing against India's
 * boundary at 0.0001 precision left one leftover fragment of "Siachen
 * Glacier" (the erase above did not fully remove it — Natural Earth's own
 * polygon for it extends a hair past DataMeet's Ladakh edge) that
 * `simplifyRing` collapsed to `M338,61.6L341.3,62.3Z`: a 3.3-unit-wide
 * bounding box around a shape with zero real area. An extent check alone
 * would have kept it; an area check correctly drops it.
 *
 * Unlike `build-map.mjs`'s MIN_RING_POINTS floor — which exists specifically
 * to stop Lakshadweep and Andaman & Nicobar, real places a child can tap and
 * fly to, from being simplified out of existence — nothing here is ever
 * interactive, so nothing needs protecting from disappearing. That is what
 * lets an erase artifact like the one above vanish instead of shipping as
 * visible clutter.
 */
const MIN_AREA = 1.0

/** Shoelace formula, unsigned: the fill area a closed ring encloses, in
 *  viewBox units^2. */
function ringArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return Math.abs(a) / 2
}

const round1 = (v) => Math.round(v * 10) / 10
const fmtNum = (v) => {
  const s = round1(v).toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}
const toPath = (rings) =>
  rings.map((r) => `M${r.map(([x, y]) => `${fmtNum(x)},${fmtNum(y)}`).join('L')}Z`).join('')

const places = {}
let keptRings = 0, droppedRings = 0
for (const f of fc.features) {
  const iso = String(f.properties.ISO_A3 ?? '').toLowerCase()
  const slug = iso && iso !== '-99' ? iso : slugify(f.properties.ADMIN || f.properties.NAME || 'land')
  const name = f.properties.ADMIN || f.properties.NAME || slug

  const rings = ringsOf(f.geometry)
    .map((ring) => ring.map(([lon, lat]) => projection([lon, lat])).filter(Boolean))
    .filter((r) => r.length >= 3)
    .map((r) => simplifyRing(r, SIMPLIFY_ERROR))
    .filter((r) => {
      const visible = r.length >= 3 && ringArea(r) >= MIN_AREA
      if (visible) keptRings++; else droppedRings++
      return visible
    })

  if (!rings.length) continue
  // Two different countries in this bbox could plausibly slugify to the same
  // ISO code only if Natural Earth's own data repeated one, which it does
  // not — but a silent overwrite would be a worse failure than a loud one.
  if (places[slug]) throw new Error(`duplicate slug "${slug}" (${name} vs ${places[slug].name})`)
  places[slug] = { name, d: toPath(rings) }
}

writeFileSync('src/data/world.json',
  JSON.stringify({ viewBox: [0, 0, W, H], attribution: ATTRIBUTION, places }))

const bytes = readFileSync('src/data/world.json', 'utf8').length
console.log(`wrote src/data/world.json — ${Object.keys(places).length} places, ${(bytes / 1024).toFixed(1)} KB`)
console.log(`  rings kept: ${keptRings}, dropped as invisible (area < ${MIN_AREA} units^2): ${droppedRings}`)
console.log(`  places: ${Object.keys(places).sort().join(', ')}`)
