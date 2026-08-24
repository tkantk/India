import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Task 5: put India in an ocean that has other land in it. This is the
// generator's own contract, over its committed output — the same pattern
// build-map.test.mjs holds geo.json to, since neither file is rebuilt by
// `npm test` (no network in CI, and the shapefile fetches are cached
// locally): what is asserted here is the property of the map that actually
// ships, not a property of the build running fresh.
const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))
const hit = JSON.parse(readFileSync('src/data/hit.json', 'utf8'))
const world = JSON.parse(readFileSync('src/data/world.json', 'utf8'))
const mapCss = readFileSync('src/map/map.css', 'utf8')

const ringsOf = (d) => d.split('M').filter((s) => s.trim()).map((chunk) => {
  const nums = chunk.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  const ring = []
  for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]])
  return ring
})

/** Standard ray-casting point-in-polygon, the same algorithm
 *  `probe-map-hits.mjs`'s own `inRing` uses. */
const inRing = ([px, py], ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Every ring in every neighbouring place, flattened once — what an
 *  overlap check tests a point against. */
const neighbourRings = Object.entries(world.places).flatMap(([slug, p]) =>
  ringsOf(p.d).map((ring) => ({ slug, ring })))

const insideAnyNeighbour = (pt) => neighbourRings.find(({ ring }) => inRing(pt, ring))?.slug ?? null

describe('generated world.json', () => {
  it('exists and is not trivially empty', () => {
    expect(Object.keys(world.places).length).toBeGreaterThan(5)
  })

  it('shares the exact viewBox geo.json ships, or the two layers will not register', () => {
    expect(world.viewBox).toEqual(geo.viewBox)
  })

  it('credits Natural Earth as the source, public domain though it is', () => {
    expect(world.attribution).toMatch(/natural earth/i)
  })

  it('never draws India itself a second time', () => {
    expect(world.places.ind).toBeUndefined()
    for (const p of Object.values(world.places)) {
      expect(p.name).not.toMatch(/^india$/i)
    }
  })

  it('gives every place a non-trivial path', () => {
    for (const [slug, p] of Object.entries(world.places)) {
      expect(p.d.length, `${slug} has no path data`).toBeGreaterThan(10)
    }
  })

  // The brief's own acceptance test: the sea is real land, not a second
  // interactive map. `.map .sea` is a separate rule from `.map .hit`'s
  // "pointer-events: none, then opt back in per child" pair on purpose —
  // there is no child here that ever opts back in.
  it('is not interactive: svg.sea is pointer-events: none in map.css', () => {
    const rule = mapCss.match(/\.map \.sea\s*\{([^}]*)\}/)
    expect(rule, 'no .map .sea rule in map.css').not.toBeNull()
    expect(rule[1]).toMatch(/pointer-events:\s*none\s*;/)
  })

  it('carries no SVG filter and no gradient — flat fill only', () => {
    const seaRules = [...mapCss.matchAll(/(\.map \.sea[^{]*)\{([^}]*)\}/g)]
    expect(seaRules.length).toBeGreaterThan(0)
    for (const [, selector, body] of seaRules) {
      expect(body, `${selector.trim()} has a filter`).not.toMatch(/(^|[^-\w])filter\s*:/)
      expect(body, `${selector.trim()} has a gradient fill`).not.toMatch(/gradient/i)
    }
    // Belt and braces: no <filter>/<linearGradient>/<radialGradient> element
    // could ever appear in the generated markup either, since nothing in
    // sea.ts or build-world.mjs emits one — but this is what would catch it
    // if something started to.
    for (const p of Object.values(world.places)) {
      expect(p.d).not.toMatch(/filter|gradient/i)
    }
  })

  /**
   * THE CORE CORRECTNESS PROPERTY. `build-world.mjs` erases every neighbour
   * polygon against India's own dissolved, OFFICIALLY depicted boundary (the
   * same 36-state feature collection `build-map.mjs`'s depiction gate
   * verifies reaches ~37.08N) before this file is ever written — not merely
   * filters by country name, which Natural Earth's own de-facto India
   * polygon (measured: it stops at 35.5N) and its unattributed disputed
   * slivers (Siachen Glacier, ISO_A3 -99) would both survive.
   *
   * Every state's POLE OF INACCESSIBILITY (`hit.json`'s `pin` — the point
   * furthest from that state's own edge, so guaranteed interior, unlike a
   * bare geometric centroid on a concave shape) must fall inside no
   * neighbour polygon at all. This is the DEEP-INTERIOR half of the check —
   * the one a failed or skipped erase would blow wide open. The BORDER-
   * ADJACENT half is a separate test below, for a reason explained there.
   */
  it('erases every neighbour polygon against India\'s own depicted boundary: no state pole falls inside one', () => {
    const offenders = []
    for (const [slug, h] of Object.entries(hit.places)) {
      const hitSlug = insideAnyNeighbour(h.pin)
      if (hitSlug) offenders.push(`${slug}'s pole (${h.pin}) is inside neighbour "${hitSlug}"`)
    }
    expect(offenders, offenders.join('; ')).toEqual([])
  })

  /**
   * THE BORDER-ADJACENT HALF, done as a real AREA overlap rather than
   * point-in-polygon on individual vertices.
   *
   * A per-vertex check was tried first and rejected: geo.json and world.json
   * are simplified INDEPENDENTLY (RDP at 0.3 viewBox units for interactive
   * Indian states, 1.0 for decorative background neighbours — each
   * generator's own SIMPLIFY_ERROR), from two different source datasets
   * (DataMeet, Natural Earth) that were never going to agree on a shared
   * border to the vertex. Insetting each sampled vertex toward its state's
   * interior before testing it does not fix this either — a straight line
   * from an arbitrary boundary point toward an interior point is not
   * guaranteed to stay inside a non-convex polygon (and most Indian states
   * along this border, hugging the Himalaya, are exactly that), so the
   * inset itself produced false positives no matter how far it reached.
   *
   * What both attempts were really trying to measure is AREA — "how much of
   * India, if any, is something a neighbour polygon also claims" — so this
   * measures that directly, with a real geometry engine instead of a
   * hand-rolled heuristic: mapshaper (already a project dependency) dissolves
   * India's own places into one shape, clips it against every neighbour
   * polygon, and what survives the clip IS the overlap. Both inputs are the
   * exact shipped, already-projected, already-simplified viewBox coordinates
   * — this measures the real committed files, not a re-run of the generator.
   *
   * Measured on today's data: 0.075% of India's total area — a thin seam
   * along the long, complex borders (Ladakh/China, Ladakh/Pakistan, West
   * Bengal/Bangladesh) where the two datasets' independently-simplified
   * lines do not land on each other exactly. A skipped or wrongly-masked
   * erase would not produce a thin seam, it would produce whole neighbour
   * countries' worth of area — orders of magnitude more than this floor.
   */
  it('erases every neighbour polygon against India\'s own depicted boundary: overlap area is a thin seam, not a swallowed state', () => {
    const shoelace = (ring) => {
      let a = 0
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
      return Math.abs(a) / 2
    }
    const areaOfGeom = (geom) => {
      const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates]
      return polys.reduce((s, poly) => s + shoelace(poly[0]), 0)
    }
    const areaOf = (doc) => {
      if (doc.type === 'FeatureCollection') return doc.features.reduce((s, f) => s + areaOfGeom(f.geometry), 0)
      if (doc.type === 'GeometryCollection') return doc.geometries.reduce((s, g) => s + areaOfGeom(g), 0)
      return areaOfGeom(doc)
    }
    // GeoJSON needs each ring closed (first point repeated last); the `d`
    // strings never bother, since SVG's own `Z` closes it implicitly.
    const closed = (ring) => {
      const [x0, y0] = ring[0], [x1, y1] = ring[ring.length - 1]
      return x0 === x1 && y0 === y1 ? ring : [...ring, ring[0]]
    }
    const toFC = (places) => ({
      type: 'FeatureCollection',
      features: Object.entries(places).flatMap(([slug, p]) =>
        ringsOf(p.d).filter((r) => r.length >= 3).map((r) => ({
          type: 'Feature', properties: { slug }, geometry: { type: 'Polygon', coordinates: [closed(r)] },
        }))),
    })

    mkdirSync('build/world-test', { recursive: true })
    const indiaPath = 'build/world-test/india.geojson'
    const neighboursPath = 'build/world-test/neighbours.geojson'
    const overlapPath = 'build/world-test/overlap.geojson'
    writeFileSync(indiaPath, JSON.stringify(toFC(geo.places)))
    writeFileSync(neighboursPath, JSON.stringify(toFC(world.places)))
    execFileSync('npx', [
      'mapshaper', indiaPath, '-dissolve', '-clip', `source=${neighboursPath}`,
      '-o', overlapPath, 'format=geojson',
    ], { stdio: 'ignore' })

    const indiaArea = areaOf(JSON.parse(readFileSync(indiaPath, 'utf8')))
    const overlapArea = areaOf(JSON.parse(readFileSync(overlapPath, 'utf8')))
    const pct = (100 * overlapArea) / indiaArea
    // eslint-disable-next-line no-console
    console.log(`    overlap area: ${overlapArea.toFixed(2)} viewBox units^2, ${pct.toFixed(4)}% of India's ${indiaArea.toFixed(0)}`)
    expect(pct).toBeLessThan(0.5)
  }, 30000)
})
