/**
 * The map's geometry, with no React and no DOM in it.
 *
 * Everything here is a pure function over the generated data, for one reason:
 * `scripts/probe-map-hits.mjs` drives a real browser over the *same* markup
 * and the *same* snapping that ship, by importing this file directly through
 * Node's type stripping. A probe that rebuilt either would only be measuring
 * itself. That is also why nothing in this file imports JSON — the caller
 * supplies the data, so Node and Vite can each load it their own way.
 */

/** One place's hit geometry, as `build-hitlayer.mjs` emits it. */
export type HitPlace = {
  /** Simplified outline, `M x,y L x,y ... Z` per ring. */
  d: string
  /** Pole of inaccessibility: the point furthest from every edge. */
  pin: number[]
  /** Radius of the largest circle that fits inside the shape. */
  r: number
  /** Radius the pin is actually drawn at, if the place gets one. */
  pinR: number
}

/**
 * The class on the element that owns the delegated `pointerdown`.
 *
 * It must be an ANCESTOR of every layer, not one of them. A tap that lands on
 * no place at all is not targeted at the hit layer — the hit layer's root is
 * `pointer-events: none` so that its children can be `fill` — it falls
 * through to whichever layer below is still targetable. Measured in Chrome:
 * of 13,761 taps that hit no place, 13,761 targeted `svg.base` and 0 reached
 * `svg.hit`. With the listener on the hit layer, the snap below could never
 * run at all.
 */
export const PICK_ROOT = 'stage'

/**
 * The eligibility threshold, in viewBox units: a shape with less room inside
 * it than this is too small for a child's fingertip and gets a pin. How big
 * that pin may be is a separate, per-place question the generator answers.
 */
export const FINGERTIP_R = 22

/**
 * How far a tap that hit nothing may be pulled onto a target, in CSS pixels.
 *
 * The hit outlines are simplified, so a thin crescent of every place falls
 * between the coarse outline and the visible art and answers a tap with
 * nothing at all. To a six-year-old that reads as the map ignoring them.
 * WCAG 2.5.8's Essential exception covers exactly this for map pins.
 *
 * In CSS pixels, not viewBox units, because it models a fingertip: it must
 * mean the same physical distance whether the camera is zoomed in or out.
 *
 * Measured by `npm run probe:map`, every dead point is already recovered at
 * about six viewBox units — they are slivers a hair outside their own
 * outline. Everything past that is pure fingertip forgiveness: a tap in the
 * shallows near Gujarat picks Gujarat. The open ocean stays inert either way.
 * Lowering this is safe; it only makes the map less forgiving of a near miss.
 */
export const SNAP_PX = 60

/** "Jammu & Kashmir" is a real place name, and this markup is written by hand.
 *  The `d` strings beside the names are machine-generated coordinate lists
 *  with nothing escapable in them, and a test asserts that stays true. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/**
 * The places that need an explicit circular tap target, derived from the
 * geometry rather than listed.
 *
 * Where `r` is smaller than a fingertip, a pin reaches past the real shape and
 * gives a child somewhere to land; where it is larger, the pin would sit
 * wholly inside a shape that is already easy to hit, and only cost a hit test.
 *
 * Bounding-box area cannot make this call: Puducherry's bbox is 245x221
 * viewBox units, larger than Punjab's, because it is four enclaves scattered
 * down the coast — and its actual land is 56 square units. Andaman & Nicobar
 * and Lakshadweep fail the same way.
 */
export const needsPin = (place: HitPlace) => place.r < FINGERTIP_R

/** The visible layer's paths: 36 of them, several thousand points each. */
export function baseMarkup(places: Record<string, { type: string; d: string }>): string {
  return Object.entries(places)
    .map(([slug, p]) => `<path data-slug="${slug}" data-type="${p.type}" d="${p.d}"/>`)
    .join('')
}

/**
 * The hit layer's body: one coarse outline per place, then the pins.
 *
 * `pointer-events: fill` is the whole reason this layer is cheap. Per WebKit's
 * PointerEventsHitRules it sets canHitStroke=false, skipping
 * Path::strokeContains — which on CoreGraphics builds an entire new stroked
 * path with CGPathCreateStrokedPath on every hit test. It also sets
 * requireFill=false and requireVisible=false, so a path with no fill and no
 * stroke is still hit-testable, at zero rasterisation cost.
 */
export function hitMarkup(
  hits: Record<string, HitPlace>,
  names: Record<string, string>,
): string {
  const inert = 'fill="none" stroke="none" pointer-events="fill"'

  const outlines = Object.entries(hits).map(
    ([slug, h]) =>
      `<path data-slug="${slug}" data-testid="state-${slug}"` +
      ` aria-label="${esc(names[slug])}" d="${h.d}" ${inert}/>`,
  )

  // Pins come after every outline: SVG hit testing takes the topmost node, and
  // Delhi's pin necessarily overlaps Haryana, so painting order is what decides
  // who gets the tap. Among the pins themselves the place with the least real
  // estate of its own goes last, though the generator's neighbour rule means no
  // two pins can overlap in the first place.
  const pins = Object.entries(hits)
    .filter(([, h]) => needsPin(h))
    .sort(([, a], [, b]) => b.r - a.r)
    .map(
      ([slug, h]) =>
        `<circle data-slug="${slug}" data-testid="pin-${slug}"` +
        ` aria-label="${esc(names[slug])}"` +
        ` cx="${h.pin[0]}" cy="${h.pin[1]}" r="${h.pinR}" ${inert}/>`,
    )

  return outlines.concat(pins).join('')
}

// --------------------------------------------------------------- snapping

export type Outline = { slug: string; rings: number[][] }

/** Flat [x0, y0, x1, y1, ...] per ring — one allocation instead of 3,369. */
export function buildOutlines(hits: Record<string, HitPlace>): Outline[] {
  return Object.entries(hits).map(([slug, h]) => ({
    slug,
    rings: h.d
      .split('M')
      .filter((chunk) => chunk.trim())
      .map((chunk) => chunk.match(/-?\d+(?:\.\d+)?/g)!.map(Number)),
  }))
}

/** Squared distance from a point to a segment. Squared, so no sqrt in a loop
 *  that runs over every segment on the map. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  let t = len === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx - px
  const qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/**
 * The place whose outline is nearest to (x, y), or null if nothing is within
 * `within` viewBox units. Coordinates are viewBox units.
 *
 * Nearest *outline*, not nearest pin: a dead point is nearly always a sliver a
 * few units outside its own place's simplified boundary, and along a shared
 * border the neighbour's pin is routinely closer than the right one's. The
 * boundary is not — it is the thing the point is a few units away from.
 * Measured over the same dead points, nearest-pin scores 212 correct / 152
 * wrong / 123 still dead where this scores 487 / 0 / 0.
 *
 * 3,369 segments, and only on a tap that hit nothing.
 */
export function nearestOutline(
  outlines: Outline[],
  x: number,
  y: number,
  within: number,
): string | null {
  let best: string | null = null
  let bestD2 = within * within
  for (const { slug, rings } of outlines) {
    for (const r of rings) {
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const d2 = segDist2(x, y, r[j], r[j + 1], r[i], r[i + 1])
        if (d2 < bestD2) {
          bestD2 = d2
          best = slug
        }
      }
    }
  }
  return best
}
