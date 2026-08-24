#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import rewind from '@mapbox/geojson-rewind'
import { geoPath, geoBounds } from 'd3-geo'
import { slugify, classify, shareBorder, boundsOf, simplifyRing } from './lib/geo.mjs'
import { indiaProjection, W, H } from './lib/projection.mjs'

const RAW = 'build/map'
const BASE = 'https://raw.githubusercontent.com/datameet/maps/master/States/Admin2'
const ATTRIBUTION = 'India state boundaries by DataMeet India community (CC BY 4.0)'

mkdirSync(RAW, { recursive: true })
mkdirSync('src/data', { recursive: true })

// 1. Fetch. All five sidecar files are required or the shapefile will not open.
for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) {
  const out = `${RAW}/Admin2.${ext}`
  if (existsSync(out)) continue
  console.log(`fetching Admin2.${ext}`)
  const res = await fetch(`${BASE}.${ext}`)
  if (!res.ok) throw new Error(`Admin2.${ext}: HTTP ${res.status}`)
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
}

// 2. Clean only. Simplification used to happen right here, in mapshaper,
//    as a single "-simplify visvalingam percentage=2% keep-shapes" over all
//    36 features in lon/lat space. keep-shapes protects a FEATURE from
//    disappearing, not its rings, so the one area threshold sized to look
//    right on Rajasthan treated an atoll's entire coastline as noise:
//    Lakshadweep shipped 4 of its 35 islands, Andaman & Nicobar 52 of its
//    220. Simplification now happens per ring, in PROJECTED viewBox units,
//    after the projection below — see step 6. -clean alone fixes topology
//    (self-intersections, slivers) without touching point density.
console.log('cleaning')
execFileSync('npx', [
  'mapshaper', `${RAW}/Admin2.shp`,
  '-clean',
  '-o', 'precision=0.0001', `${RAW}/india-states.geojson`, 'format=geojson',
], { stdio: 'inherit' })

const raw = JSON.parse(readFileSync(`${RAW}/india-states.geojson`, 'utf8'))

// 4 (moved before 3). Rewind rings clockwise. MANDATORY, and MUST happen
//    before any d3-geo spherical math runs on this data — not just geoPath.
//    mapshaper emits RFC 7946 (CCW outer rings); d3-geo needs CW for both
//    its clipper and its pole-containment test. Feed it CCW and geoPath
//    renders every polygon as its own complement (one giant blob over the
//    viewBox), AND geoBounds silently reports the whole globe
//    ([[-180,-90],[180,90]]) for every feature instead of throwing — which
//    would make the depiction gate below pass unconditionally (90 >= 36.5
//    is always true), never catching a de-facto (35.5N) dataset. Verified
//    empirically: geoBounds(raw) here returns the full globe; only
//    geoBounds(fc) after rewind returns the true ~37.08N bound.
const fc = rewind(raw, true)

// 3. DEPICTION GATE. The official Survey of India rendering reaches 37.07N
//    (the tip of Gilgit-Baltistan). The de-facto rendering stops at 35.5N.
//    Verified by point-in-polygon: Muzaffarabad and Mirpur fall in
//    Jammu & Kashmir; Gilgit, Skardu, Aksai Chin and the Shaksgam Valley
//    fall in Ladakh. Do not remove this check.
const [, [, north]] = geoBounds(fc)
// Rounded to three places and written into geo.json below, so the committed
// map carries the evidence with it. This gate only runs when someone
// regenerates the file — build-map.test.mjs re-asserts the recorded value on
// every test run, including in CI, where the shapefile is never fetched.
const northernBound = Math.round(north * 1000) / 1000
console.log(`northern bound: ${north.toFixed(3)}N`)
if (north < 36.5) {
  throw new Error(
    `northern bound is ${north.toFixed(3)}N, expected ~37.07N. ` +
    `This dataset uses the de-facto depiction, not the official one. Rejected.`,
  )
}
if (fc.features.length !== 36) {
  throw new Error(`expected 36 states and union territories, got ${fc.features.length}`)
}

const projection = indiaProjection(fc)
const path = geoPath(projection)

const ringsOf = (geom) =>
  geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()

// 6. Per-ring, screen-space simplification. This is what step 2 used to do in
//    mapshaper, in lon/lat degrees, once, over every feature; it now runs
//    here, in the projected viewBox coordinates every path actually ships
//    in, the same way build-hitlayer.mjs already simplifies the (much
//    coarser) hit geometry.
//
//    A single ERROR TOLERANCE in screen-space units, rather than mapshaper's
//    area PERCENTAGE, is what makes this scale-fair: a wobble small enough to
//    be invisible on Rajasthan (0.3 units is 0.19px at the worst-case home
//    view — see build-hitlayer.mjs's TARGET_PIN_R comment for that 0.462
//    px/unit figure) is nearly the whole extent of an atoll, so the same
//    tolerance compresses a big state hard and barely touches a tiny one,
//    instead of erasing it.
const SIMPLIFY_ERROR = 0.3
// A pure error tolerance can still flatten a ring smaller than the tolerance
// itself down to its two furthest-apart points — a zero-area line, which is
// worse than the three-point triangles this task exists to fix, and would
// stay a line at any camera zoom (Task 6+ flies to every place, including
// these). This floor guarantees every ring keeps enough points to still read
// as a shape once the camera arrives, at the cost of very slightly
// undersimplifying the smallest islands.
const MIN_RING_POINTS = 6

// segDist2, rdp and simplifyRing (the closed-ring RDP primitive) live in
// lib/geo.mjs now — build-hitlayer.mjs needs the identical logic for its own
// point-budget simplification, and two copies of a recursive geometry
// algorithm is exactly the kind of thing that silently drifts apart under a
// future tweak.

/** simplifyRing at a stated error, except it never goes below `minPoints`
 *  (clamped to the ring's own original size). Reaching for the floor only
 *  ever happens on rings small enough that `capEps` alone would flatten them
 *  — real states never come close to it. */
function simplifyRingToError(ring, capEps, minPoints) {
  if (ring.length < 4) return ring
  const floor = Math.min(minPoints, ring.length)
  const atCap = simplifyRing(ring, capEps)
  if (atCap.length >= floor) return atCap
  let lo = 0, hi = capEps, best = ring
  for (let i = 0; i < 20; i++) {
    const eps = (lo + hi) / 2
    const candidate = simplifyRing(ring, eps)
    if (candidate.length >= floor) { best = candidate; lo = eps } else { hi = eps }
  }
  return best
}

const round = (v, decimals) => {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/**
 * 1 decimal place, same rounding build-hitlayer.mjs uses for its own paths:
 * enough precision that no join is visibly off, far more compact than full
 * float precision — for a ring the size of a state.
 *
 * For a ring smaller than that, 1 decimal is not a compactness choice, it is
 * data loss: an atoll can be a few hundredths of a unit across after
 * projection, and rounding every vertex to the nearest 0.1 collapses its
 * narrow axis to exactly 0 — erasing the very ring `simplifyRingToError`'s
 * point floor just fought to keep. So precision is per-ring, widened just
 * enough that the ring's own narrowest axis still rounds to something
 * nonzero, capped at 4 decimals as a backstop against pathological input.
 */
function precisionFor(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of ring) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  // Rounding the DELTA is not the same as the delta of the ROUNDINGS: a raw
  // gap of 0.08 rounds to "0.1" (looks fine) even though its own endpoints —
  // say 963.96 and 964.04 — both round to 964.0 independently, which is what
  // toPath actually does to every vertex. So this checks the thing that
  // actually happens: round each extreme, then see if either axis collapsed.
  let decimals = 1
  while (decimals < 4 &&
    (round(x1, decimals) - round(x0, decimals) <= 0 || round(y1, decimals) - round(y0, decimals) <= 0)
  ) decimals++
  return decimals
}

// toFixed + trim, not String(round(...)): dividing by a power of ten and
// letting String() render the result reliably introduces float noise once
// decimals goes past 1 (e.g. "0.06999999999999999"), which toFixed avoids.
const fmtNum = (v, decimals) => {
  const s = v.toFixed(decimals)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

const toPath = (rings) =>
  rings.map((r) => {
    const decimals = precisionFor(r)
    return `M${r.map(([x, y]) => `${fmtNum(x, decimals)},${fmtNum(y, decimals)}`).join('L')}Z`
  }).join('')

const places = {}
for (const f of fc.features) {
  const name = f.properties.ST_NM
  const slug = slugify(name)
  const rings = ringsOf(f.geometry)
    .map((ring) => ring.map(([lon, lat]) => projection([lon, lat])).filter(Boolean))
    .filter((r) => r.length >= 3)
    .map((r) => simplifyRingToError(r, SIMPLIFY_ERROR, MIN_RING_POINTS))
  const d = toPath(rings)
  places[slug] = {
    name,
    type: classify(name),
    d,
    centroid: path.centroid(f).map(n => Math.round(n * 10) / 10),
    bbox: boundsOf(d).map(n => Math.round(n * 10) / 10),
    neighbours: [],
  }
}

// 5. Neighbours, from shared boundary vertices in lon/lat space.
const rings = Object.fromEntries(fc.features.map(f => [slugify(f.properties.ST_NM), ringsOf(f.geometry)]))
const slugs = Object.keys(places)
for (let i = 0; i < slugs.length; i++) {
  for (let j = i + 1; j < slugs.length; j++) {
    if (shareBorder(rings[slugs[i]], rings[slugs[j]])) {
      places[slugs[i]].neighbours.push(slugs[j])
      places[slugs[j]].neighbours.push(slugs[i])
    }
  }
}
for (const p of Object.values(places)) p.neighbours.sort()

writeFileSync('src/data/geo.json',
  JSON.stringify({ viewBox: [0, 0, W, H], northernBound, attribution: ATTRIBUTION, places }))

const kb = (JSON.stringify(places).length / 1024).toFixed(0)
console.log(`wrote src/data/geo.json — ${slugs.length} places, ${kb} KB`)
console.log(`  rajasthan neighbours: ${places.rajasthan.neighbours.join(', ')}`)
for (const slug of ['lakshadweep', 'andaman-nicobar']) {
  const p = places[slug]
  const rings = p.d.split('M').filter((s) => s.trim())
  const points = (p.d.match(/,/g) ?? []).length
  console.log(`  ${slug}: ${rings.length} rings, ${points} points`)
}
