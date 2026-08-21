#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import rewind from '@mapbox/geojson-rewind'
import { geoConicConformal, geoPath, geoBounds } from 'd3-geo'
import { slugify, classify, shareBorder, boundsOf } from './lib/geo.mjs'

const W = 1000, H = 1100
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

// 2. Clean, then simplify. ORDER MATTERS: "-simplify ... -clean" silently
//    DISCARDS the simplification and writes an 18 MB file. keep-shapes stops
//    mapshaper deleting Lakshadweep and the smaller Andaman islands.
console.log('simplifying')
execFileSync('npx', [
  'mapshaper', `${RAW}/Admin2.shp`,
  '-clean',
  '-simplify', 'visvalingam', 'percentage=2%', 'keep-shapes',
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

const projection = geoConicConformal()
  .parallels([12.4729, 35.1728])   // Survey of India LCC standard parallels
  .rotate([-80, 0])                // central meridian 80E
  .precision(2)
  .fitSize([W, H], fc)
const path = geoPath(projection)

const ringsOf = (geom) =>
  geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()

const places = {}
for (const f of fc.features) {
  const name = f.properties.ST_NM
  const slug = slugify(name)
  // 1 decimal place: 345 KB of path data becomes 262 KB, with no visible change.
  const d = path(f).replace(/(-?\d+\.\d)\d+/g, '$1')
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
  JSON.stringify({ viewBox: [0, 0, W, H], attribution: ATTRIBUTION, places }))

const kb = (JSON.stringify(places).length / 1024).toFixed(0)
console.log(`wrote src/data/geo.json — ${slugs.length} places, ${kb} KB`)
console.log(`  rajasthan neighbours: ${places.rajasthan.neighbours.join(', ')}`)
