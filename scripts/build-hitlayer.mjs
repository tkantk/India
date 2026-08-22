#!/usr/bin/env node
/**
 * Build the invisible hit layer from the visible map.
 *
 * The visible geometry in `geo.json` is 269 KB of several-thousand-point
 * paths. Safari has no spatial index for SVG hit testing and is roughly 80x
 * slower than Chrome at it (measured elsewhere: 500 ms vs 6 ms at 10k nodes),
 * so a child's tap must never be tested against that geometry. This script
 * emits a second, coarse copy — about 100 points per place — that is drawn
 * with no fill and no stroke and does all the hit testing.
 *
 * It also emits, per place, the **pole of inaccessibility**: the point
 * furthest from the boundary, i.e. the centre of the largest circle that fits
 * inside the shape, together with that circle's radius. Several Indian states
 * are concave (Gujarat wraps the Gulf of Khambhat; Meghalaya is a crescent),
 * and a centroid can fall outside a concave shape entirely — so the centroid
 * in `geo.json` is not usable as a tap point. The radius is what tells the map
 * which places are too small for a child's fingertip and need an explicit
 * circular pin on top of their outline.
 *
 * Output: src/data/hit.json
 *   { places: { [slug]: { d, pin: [x, y], r: number, pinR: number } } }
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { segDist2, simplifyRing } from './lib/geo.mjs'

/** Points per place, across all its rings. 36 x ~100 x ~12 chars is ~43 KB,
 *  a sixth of the visible geometry. At this density the largest state's
 *  outline is accurate to a few viewBox units — a fraction of a fingertip. */
const POINT_BUDGET = 100
/** Samples per axis, per refinement pass, in the pole-of-inaccessibility
 *  search. 25x25 over six passes narrows the window by 12x each time, which
 *  resolves the pole to well under a thousandth of a viewBox unit. */
const GRID = 24
const PASSES = 6

/**
 * The ideal pin radius, in viewBox units.
 *
 * Nielsen Norman Group's figure for under-nines is 2cm square, which is
 * 104 CSS px on a 264 ppi iPad. The map's worst realistic scale — landscape,
 * with the control bar and the read-along line taking their share of the
 * height — is 0.462 CSS px per viewBox unit, so 104 px of diameter is
 * 104 / 0.462 = 225.1 units, and half of that is the radius.
 *
 * Almost nothing gets it: it is clamped hard by the neighbour rule below.
 */
const TARGET_PIN_R = Math.round((104 / 0.462 / 2) * 10) / 10   // 112.6

// ---------------------------------------------------------------- geometry

/** `geo.json`'s paths are pure `M x,y L x,y ... Z` — one subpath per ring,
 *  the closing point implied by Z rather than repeated. */
function parseRings(d) {
  return d.split('M').filter((s) => s.trim()).map((chunk) => {
    const nums = chunk.match(/-?\d+(?:\.\d+)?/g).map(Number)
    const ring = []
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]])
    return ring
  })
}

/** Shoelace. In this data (screen coords, y down, rings rewound clockwise by
 *  build-map.mjs) an outer ring is positive and a hole is negative. Six places
 *  really do have holes: Puducherry and Karaikal sit inside Tamil Nadu, Mahe
 *  inside Kerala, Yanam inside Andhra Pradesh. */
function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return a / 2
}

const bboxOf = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of ring) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [x0, y0, x1 - x0, y1 - y0]
}

// segDist2 and simplifyRing (the closed-ring RDP primitive, used below by
// simplifyPlace) now live in lib/geo.mjs, shared with build-map.mjs's own
// per-ring simplification — see the import at the top of this file.

/**
 * Simplify every ring of one place under a shared point budget, by binary
 * searching the smallest tolerance that fits — i.e. keeping as much detail as
 * the budget allows. Rings that collapse below a triangle are dropped: they
 * are specks a fingertip could never land on, and the pin covers them.
 */
function simplifyPlace(rings) {
  const biggest = rings.reduce((a, b) => (Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b))
  const count = (rs) => rs.reduce((n, r) => n + r.length, 0)

  // Three-way, not two: past some tolerance every ring collapses below a
  // triangle and the place disappears entirely. That is *too coarse*, and
  // must push the search down like an over-budget result pushes it up — read
  // as "not under budget" it sends the search the wrong way, and a thin
  // crescent like Meghalaya never finds a tolerance at all.
  let lo = 0, hi = 64, kept = null
  for (let i = 0; i < 32; i++) {
    const eps = (lo + hi) / 2
    const out = rings.map((r) => simplifyRing(r, eps)).filter((r) => r.length >= 3)
    if (!out.length) hi = eps
    else if (count(out) > POINT_BUDGET) lo = eps
    else {
      if (!kept || count(out) > count(kept)) kept = out
      hi = eps
    }
  }
  // Only reachable if every ring collapses at every tolerance, which the
  // `length < 4` early return in simplifyRing makes impossible for real data.
  // Kept so a future geometry change degrades to "coarse" rather than "empty".
  return kept ?? [biggest]
}

const fmt = (v) => String(Math.round(v * 10) / 10)
const toPath = (rings) =>
  rings.map((r) => `M${r.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join('L')}Z`).join('')

// ------------------------------------------------ pole of inaccessibility

/** Ray casting. Rings are implicitly closed, so j wraps to the last point. */
function inRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance from p to the shape's boundary: positive inside, negative
 *  outside. A point inside a hole counts as outside. */
function clearance(p, outer, holes) {
  let inside = inRing(p, outer)
  for (const h of holes) if (inRing(p, h)) inside = false
  let d2 = Infinity
  for (const ring of [outer, ...holes]) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const d = segDist2(p, ring[j], ring[i])
      if (d < d2) d2 = d
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(d2)
}

/**
 * The point furthest from the boundary, by grid search with successive
 * refinement — the same idea as Mapbox's polylabel, minus the priority queue,
 * which is not worth its code at 36 shapes of 100 points.
 */
function pole(outer, holes) {
  const [x0, y0, w, h] = bboxOf(outer)
  let cx = x0 + w / 2, cy = y0 + h / 2, rx = w / 2, ry = h / 2
  let best = { p: [cx, cy], d: -Infinity }
  for (let pass = 0; pass < PASSES; pass++) {
    for (let i = 0; i <= GRID; i++) {
      for (let j = 0; j <= GRID; j++) {
        const p = [cx - rx + (2 * rx * i) / GRID, cy - ry + (2 * ry * j) / GRID]
        const d = clearance(p, outer, holes)
        if (d > best.d) best = { p, d }
      }
    }
    // Zoom the window onto the winner: one grid cell either side of it.
    cx = best.p[0]; cy = best.p[1]
    rx = (2 * rx) / GRID; ry = (2 * ry) / GRID
  }
  return best
}

// ------------------------------------------------------------------ build

const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))
const places = {}

for (const [slug, place] of Object.entries(geo.places)) {
  const rings = simplifyPlace(parseRings(place.d))
  const outers = rings.filter((r) => signedArea(r) > 0)
  const holes = rings.filter((r) => signedArea(r) < 0)
  // Largest island, for a place that is an archipelago (Lakshadweep is four
  // specks; Andaman & Nicobar is 52 islands; Puducherry is four enclaves).
  const main = (outers.length ? outers : rings)
    .reduce((a, b) => (Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b))
  const inside = holes.filter((hole) => inRing(hole[0], main))
  const found = pole(main, inside)

  // Clamp into the recorded bbox. geo.json rounds its bbox to one decimal,
  // which can pull an edge inwards by up to 0.05 units; the pole is many
  // units from any edge, so this only ever fixes that rounding.
  const [bx, by, bw, bh] = place.bbox
  const clamp = (v, lo, hi) => Math.min(Math.max(Math.round(v * 10) / 10, lo), hi)

  places[slug] = {
    d: toPath(rings),
    pin: [clamp(found.p[0], bx, bx + bw), clamp(found.p[1], by, by + bh)],
    // Radius of the largest circle that fits inside the shape. The map uses
    // this to decide which places are too small to tap and need a pin.
    r: Math.round(found.d * 10) / 10,
  }
}

/**
 * How big each pin may be: as close to a child-sized target as it can get
 * without reaching another place's pole.
 *
 * A pole is a place's tap point of last resort — the one spot in it that is
 * furthest from every edge. A pin that swallowed a neighbour's pole would
 * make that neighbour genuinely unreachable, so half the distance to the
 * nearest other pole is the ceiling. Because every pin obeys it, no two pins
 * can overlap either: each is at most half the distance between them.
 *
 * A single radius for everyone cannot work. Andaman & Nicobar is 406 units
 * from its nearest neighbour and can afford a pin eight times the size of
 * Delhi's, which sits 32 units from Haryana's pole — and Andaman is exactly
 * the territory a child cannot find, while Delhi is the one whose oversized
 * pin was eating a quarter of Haryana.
 */
const slugs = Object.keys(places)
for (const slug of slugs) {
  let nearest = Infinity
  for (const other of slugs) {
    if (other === slug) continue
    const dx = places[other].pin[0] - places[slug].pin[0]
    const dy = places[other].pin[1] - places[slug].pin[1]
    const d = Math.hypot(dx, dy)
    if (d < nearest) nearest = d
  }
  places[slug].pinR = Math.round(Math.min(TARGET_PIN_R, nearest / 2) * 10) / 10
}

writeFileSync('src/data/hit.json', JSON.stringify({ places }))

const visible = Object.values(geo.places).reduce((a, p) => a + p.d.length, 0)
const hits = Object.values(places).reduce((a, p) => a + p.d.length, 0)
const points = Object.values(places).reduce((a, p) => a + (p.d.match(/,/g)?.length ?? 0), 0)
console.log(`wrote src/data/hit.json — ${Object.keys(places).length} places, ${points} points`)
console.log(`  hit geometry is ${((hits / visible) * 100).toFixed(1)}% of the visible geometry`)
const tiny = Object.entries(places).filter(([, p]) => p.r < 22)
console.log(`  ${tiny.length} places too small for a fingertip, with pin radii:`)
for (const [slug, p] of tiny.sort((a, b) => b[1].pinR - a[1].pinR)) {
  console.log(`    ${slug.padEnd(42)} room ${String(p.r).padStart(5)}  pin ${String(p.pinR).padStart(6)}`)
}
