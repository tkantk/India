#!/usr/bin/env node
/**
 * The three pieces of tour art that have to agree with the map: the country
 * outline a child traces with a finger, the Ganga, and the Himalayan summits.
 *
 * All three are drawn in the map's own viewBox (0 0 1000 1100) by running the
 * SAME projection `build-map.mjs` uses — same standard parallels, same
 * rotation, same `fitSize` against the same feature collection. That is the
 * only way a river drawn over the map lands on the states it actually flows
 * through: eyeballed coordinates would drift the moment the map data is
 * rebuilt, and nothing would notice.
 *
 * Output: src/tour/effects/art/geo.ts. Run `npm run build:art` after
 * `npm run build:map`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import rewind from '@mapbox/geojson-rewind'
import { geoConicConformal, geoPath } from 'd3-geo'

const W = 1000, H = 1100
const STATES = 'build/map/india-states.geojson'
const OUTLINE = 'build/map/india-outline.geojson'

if (!existsSync(STATES)) {
  console.error(`${STATES} does not exist. Run "npm run build:map" first.`)
  process.exit(1)
}

// 1. Dissolve the 36 states into the country, then simplify hard. This path is
//    dash-stroked frame by frame while it draws on, and that is the single
//    most expensive thing in the tour on an old iPad — so it is worth far more
//    simplification than the map itself gets. keep-shapes holds on to the
//    Andaman and Nicobar islands, which are visibly part of the country a
//    child is tracing.
//
//    STATES is unsimplified since Task 5 (build-map.mjs now simplifies its
//    own output per ring, in projected space, instead of leaning on
//    mapshaper here). This file's own simplification target is still a flat
//    mapshaper percentage — that is fine for a single decorative outline,
//    which unlike the map itself does not need cartographic fidelity down to
//    an atoll — but the percentage has to be retuned against the ~50x denser
//    input: 6% of the old (already 2%-simplified) points produced a 6.5 KB
//    outline; 6% of the raw ~1,034,000 points produced a 190 KB one. 0.1%
//    lands back in the same ballpark as before.
console.log('dissolving')
execFileSync('npx', [
  'mapshaper', STATES,
  '-dissolve',
  '-simplify', 'visvalingam', 'percentage=0.1%', 'keep-shapes',
  '-o', 'precision=0.001', OUTLINE, 'format=geojson',
], { stdio: 'inherit' })

// Rewind CW before any d3-geo spherical maths, for exactly the reason
// build-map.mjs spells out: fed CCW rings, d3-geo renders every polygon as
// its own complement.
const states = rewind(JSON.parse(readFileSync(STATES, 'utf8')), true)
const outline = rewind(JSON.parse(readFileSync(OUTLINE, 'utf8')), true)

// fitSize against the STATES collection, not the dissolved one: simplification
// moves the extreme vertices by a hair, and fitting to the moved ones would
// offset every projected point from the committed map by that hair.
const projection = geoConicConformal()
  .parallels([12.4729, 35.1728])
  .rotate([-80, 0])
  .precision(2)
  .fitSize([W, H], states)
const path = geoPath(projection)

const r1 = (n) => Math.round(n * 10) / 10

// 2. The outline, biggest ring first, so the draw-on starts with the mainland
//    and the islands come after rather than the other way round.
const rings = []
const geoms = outline.type === 'GeometryCollection'
  ? outline.geometries
  : outline.features.map((f) => f.geometry)
for (const geom of geoms) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map((c) => projection(c)).filter(Boolean)
      if (pts.length < 4) continue
      let a = 0
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
        a += x1 * y2 - x2 * y1
      }
      const area = Math.abs(a) / 2
      // Below half a square unit a ring is smaller than one screen pixel: it
      // costs dash-stroking and shows nothing. (The Lakshadweep atolls are
      // already gone by this point: -dissolve merges the 36 features into one,
      // so mapshaper's keep-shapes only protects a single ring of it. They are
      // about a pixel across on screen — the mainland is what a finger traces.)
      if (area >= 0.5) rings.push({ pts, area })
    }
  }
}
rings.sort((a, b) => b.area - a.area)
const outlineD = rings
  .map(({ pts }) => 'M' + pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L') + 'Z')
  .join('')

// 3. The Ganga: Gaumukh to the sea, down the Hooghly — the mouth the map can
//    show, since the Padma leaves India at Farakka.
const GANGA = [
  [78.94, 30.99], [78.60, 30.15], [78.16, 29.95], [78.08, 29.38],
  [78.10, 28.79], [79.10, 27.90], [79.58, 27.39], [80.35, 26.46],
  [81.09, 25.95], [81.85, 25.43], [83.01, 25.32], [83.98, 25.56],
  [85.14, 25.61], [86.47, 25.38], [87.00, 25.24], [87.92, 24.80],
  [88.28, 23.90], [88.37, 23.41], [88.35, 22.57], [88.05, 21.65],
]

/** Catmull-Rom through the projected points, as cubic beziers: a river is a
 *  curve, and twenty straight segments read as a bolt of lightning. */
function smooth(points) {
  const p = points.map(([x, y]) => [r1(x), r1(y)])
  let d = `M${p[0][0]},${p[0][1]}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] ?? p2
    const c1 = [r1(p1[0] + (p2[0] - p0[0]) / 6), r1(p1[1] + (p2[1] - p0[1]) / 6)]
    const c2 = [r1(p2[0] - (p3[0] - p1[0]) / 6), r1(p2[1] - (p3[1] - p1[1]) / 6)]
    d += `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}
const gangaD = smooth(GANGA.map((c) => projection(c)))

// 4. The summits, west to east. Everest, Dhaulagiri and Namcha Barwa are not
//    in India; the range they belong to runs along the top of it, which is
//    what the beat is about ("Along the top of India stand the Himalaya").
const PEAKS = [
  ['Nanga Parbat', 74.589, 35.238],
  ['K2', 76.513, 35.881],
  ['Nun Kun', 76.020, 33.980],
  ['Reo Purgyil', 78.678, 31.849],
  ['Nanda Devi', 79.970, 30.377],
  ['Dhaulagiri', 83.487, 28.697],
  ['Everest', 86.925, 27.988],
  ['Kangchenjunga', 88.147, 27.702],
  ['Kangto', 92.520, 27.850],
  ['Namcha Barwa', 95.055, 29.638],
]
// Sorted by PROJECTED x, not by longitude: the conic rotates the far
// north-west, so K2 lands east of Nun Kun on screen despite being west of it
// on the globe. The range has to rise left to right as a child sees it.
const peaks = PEAKS
  .map(([name, lon, lat]) => {
    const [x, y] = projection([lon, lat])
    return { name, x: r1(x), y: r1(y) }
  })
  .sort((a, b) => a.x - b.x)

const header = `/**
 * GENERATED by scripts/build-geo-art.mjs — do not edit by hand.
 *
 * Map-registered tour art, in the map's viewBox (0 0 ${W} ${H}), projected with
 * the same geoConicConformal the map itself is built with. Anything drawn from
 * these numbers lines up with src/data/geo.json to the tenth of a unit.
 */
`

writeFileSync('src/tour/effects/art/geo.ts', header +
  `\n/** India, dissolved from the 36 states and simplified for dash-stroking.\n *  Biggest ring first, so the draw-on starts with the mainland. */\n` +
  `export const INDIA_OUTLINE =\n  '${outlineD}'\n` +
  `\n/** The Ganga, Gaumukh to the Bay of Bengal down the Hooghly. */\n` +
  `export const GANGA =\n  '${gangaD}'\n` +
  `\n/** Himalayan summits, west to east as the map draws them. */\nexport const PEAKS = [\n` +
  peaks.map((p) => `  { name: '${p.name}', x: ${p.x}, y: ${p.y} },`).join('\n') +
  `\n] as const\n`)

console.log(`outline: ${rings.length} rings, ${(outlineD.length / 1024).toFixed(1)} KB`)
console.log(`ganga:   ${GANGA.length} points, ${gangaD.length} chars`)
console.log(`peaks:   ${peaks.map((p) => `${p.name} (${p.x},${p.y})`).join(', ')}`)
