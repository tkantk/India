import { useEffect, useMemo, useRef } from 'react'
import type { PointerEvent } from 'react'
import geo from '../data/geo.json'
import hitData from '../data/hit.json'
import { bindMapNodes } from './useMapNodes'
import './map.css'

/**
 * The map: four layers, in DOM order, each one shaped by WebKit's legacy SVG
 * engine — the one on every iPad this has to run on.
 *
 *   1. `.stage`  an HTML <div>. The only element that is ever transformed.
 *                `LegacyRenderSVGModelObject` derives from `RenderElement`,
 *                not `RenderLayerModelObject`, so an SVG child can never own
 *                a compositor layer: a transform on a <g> is a main-thread
 *                repaint of all 36 paths, every frame. Task 6 flies the
 *                camera by transforming this div.
 *   2. `.base`   the visible art, with `pointer-events: none` on the group.
 *   3. `.hit`    coarse invisible geometry, `fill="none" stroke="none"
 *                pointer-events="fill"`, and one delegated pointerdown.
 *   4. `.glow`   one copy of the currently lit path. The CSS drop-shadow()
 *                goes on this <svg> root, which is a replaced element and can
 *                composite, never on the path inside it or on an SVG
 *                <filter> — both of those are WebKit's CPU three-pass blur.
 *
 * The two SVG bodies are strings injected once with `dangerouslySetInnerHTML`.
 * Written as JSX they would be 269 KB of path data for React's reconciler to
 * walk on every render; `<use>` would be worse still, since `SVGUseElement`
 * deep-clones its target into a shadow tree.
 */

const VIEW_BOX = geo.viewBox.join(' ')

/**
 * The eligibility threshold, in viewBox units: a shape with less room inside
 * it than this is too small for a child's fingertip and gets a pin. How big
 * that pin may be is a separate, per-place question the generator answers —
 * see `pinR`.
 */
const FINGERTIP_R = 22

type Place = { name: string; type: string; d: string }
type Hit = { d: string; pin: number[]; r: number; pinR: number }

const places: Record<string, Place> = geo.places
const hits: Record<string, Hit> = hitData.places

/**
 * Place names come from DataMeet's shapefile, so they are the one part of this
 * hand-written markup that this repository did not author — and "Jammu &
 * Kashmir" proves they are not already attribute-safe. The `d` strings beside
 * them are machine-generated coordinate lists (`M`, `L`, `Z`, digits, commas,
 * minus signs) with nothing escapable in them.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/**
 * The places that need an explicit circular tap target, derived from the
 * geometry rather than listed.
 *
 * `r` is the radius of the largest circle that fits inside the place. Where
 * that is smaller than a fingertip, the pin reaches past the real shape and
 * gives a child somewhere to land; where it is larger, the pin would sit
 * wholly inside a shape that is already easy to hit, and only cost a hit test.
 *
 * Bounding-box area cannot make this call: Puducherry's bbox is 245x221
 * viewBox units, larger than Punjab's, because it is four enclaves scattered
 * down the coast — and its actual land is 56 square units. Andaman & Nicobar
 * and Lakshadweep fail the same way.
 */
const pinned = (slug: string) => hits[slug].r < FINGERTIP_R

/**
 * How far a tap that hit nothing may be pulled onto a target, in CSS pixels.
 *
 * The hit outlines are simplified, so a thin crescent of every place — 0.91%
 * of the map's interior, measured over 13,908 sampled points in a real
 * browser — falls between the coarse outline and the visible art and answers
 * a tap with nothing at all. To a six-year-old that reads as the map ignoring
 * them. WCAG 2.5.8's Essential exception covers exactly this for map pins.
 *
 * In CSS pixels, not viewBox units, because it models a fingertip: it must
 * mean the same physical distance whether the camera is zoomed in or out.
 *
 * Measured, at the most zoomed-out realistic scale (0.383 px per unit, so
 * 60 px is 157 units), against the same 13,908 points plus 20,597 points of
 * sea and foreign land inside the viewBox:
 *
 *   radius   dead points recovered   sea that becomes a pick
 *      6 u              100%                     4.8%
 *     10 u              100%                      7.6%
 *    157 u              100%                     83.3%
 *
 * Every dead point is already recovered at six units — they are all slivers
 * a hair outside their own outline. Everything past that is pure fingertip
 * forgiveness: a tap in the shallows near Gujarat picks Gujarat. The open
 * ocean stays inert either way, because 16.7% of the water in frame is more
 * than 157 units from any coast. Lowering this is safe; it only makes the
 * map less forgiving of a near miss.
 */
const SNAP_PX = 60

type Outline = { slug: string; rings: number[][] }

/** Parsed on the first miss, not at startup: most sessions never need it. */
let outlines: Outline[] | null = null

const parseOutlines = (): Outline[] =>
  Object.entries(hits).map(([slug, h]) => ({
    slug,
    // Flat [x0, y0, x1, y1, ...] per ring — one allocation instead of 3,369.
    rings: h.d
      .split('M')
      .filter((chunk) => chunk.trim())
      .map((chunk) => chunk.match(/-?\d+(?:\.\d+)?/g)!.map(Number)),
  }))

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
 * Nearest *outline*, not nearest pin: a dead point is nearly always a sliver
 * a few units outside its own place's simplified boundary, and along a shared
 * border the neighbour's pin is routinely closer than the right one's. The
 * boundary is not — it is the thing the point is a few units away from.
 *
 * 3,369 segments, and only on a tap that hit nothing.
 *
 * Exported so it can be tested directly: jsdom implements no SVG coordinate
 * API at all, so the browser half of this cannot be exercised in a unit test.
 */
export function nearestPlace(x: number, y: number, within: number): string | null {
  const shapes = (outlines ??= parseOutlines())
  let best: string | null = null
  let bestD2 = within * within
  for (const { slug, rings } of shapes) {
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

let baseCache: string | null = null
function baseMarkup(): string {
  return (baseCache ??= Object.entries(places)
    .map(([slug, p]) => `<path data-slug="${slug}" data-type="${p.type}" d="${p.d}"/>`)
    .join(''))
}

let hitCache: string | null = null
function hitMarkup(): string {
  if (hitCache !== null) return hitCache
  // `pointer-events: fill` is the whole reason this layer is cheap. Per
  // WebKit's PointerEventsHitRules it sets canHitStroke=false, skipping
  // Path::strokeContains — which on CoreGraphics builds an entire new stroked
  // path with CGPathCreateStrokedPath on every hit test. It also sets
  // requireFill=false and requireVisible=false, so a path with no fill and no
  // stroke is still hit-testable, at zero rasterisation cost.
  const inert = 'fill="none" stroke="none" pointer-events="fill"'

  const outlines = Object.entries(hits).map(
    ([slug, h]) =>
      `<path data-slug="${slug}" data-testid="state-${slug}"` +
      ` aria-label="${esc(places[slug].name)}" d="${h.d}" ${inert}/>`,
  )

  // Pins come after every outline: SVG hit testing takes the topmost node,
  // and Delhi's pin necessarily overlaps Haryana, so painting order is what
  // decides who gets the tap. Among the pins themselves the place with the
  // least real estate of its own goes last, though the generator's neighbour
  // rule means no two pins can overlap in the first place.
  const pins = Object.entries(hits)
    .filter(([slug]) => pinned(slug))
    .sort(([, a], [, b]) => b.r - a.r)
    .map(
      ([slug, h]) =>
        `<circle data-slug="${slug}" data-testid="pin-${slug}"` +
        ` aria-label="${esc(places[slug].name)}"` +
        ` cx="${h.pin[0]}" cy="${h.pin[1]}" r="${h.pinR}" ${inert}/>`,
    )

  return (hitCache = outlines.concat(pins).join(''))
}

type Props = {
  /** Fires on pointerdown, not click: a child's finger moves, and waiting for
   *  a clean click costs the responsiveness that makes a map feel alive. */
  onPick: (slug: string) => void
}

export function MapStage({ onPick }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const base = useMemo(baseMarkup, [])
  const hit = useMemo(hitMarkup, [])

  useEffect(() => {
    bindMapNodes(root.current)
    return () => bindMapNodes(null)
  }, [])

  // One listener for the whole layer. 36 handlers in JSX would mean mapping
  // over the places in React, which is exactly what the injected markup avoids.
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const slug = (e.target as Element).closest('[data-slug]')?.getAttribute('data-slug')
    if (slug) {
      onPick(slug)
      return
    }

    // Hit nothing. Rather than ignore the child, snap to whatever is within a
    // fingertip's reach — and to nothing at all out in the open sea.
    const svg = e.currentTarget
    const ctm = svg.getScreenCTM?.()
    if (!ctm) return
    const point = svg.createSVGPoint()
    point.x = e.clientX
    point.y = e.clientY
    const local = point.matrixTransform(ctm.inverse())
    // sqrt of the determinant is the CTM's scale, so SNAP_PX becomes the same
    // physical distance at any zoom.
    const scale = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1
    const near = nearestPlace(local.x, local.y, SNAP_PX / scale)
    if (near) onPick(near)
  }

  return (
    <div className="map" ref={root}>
      <div className="stage">
        <svg className="base" viewBox={VIEW_BOX} aria-hidden="true">
          <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: base }} />
        </svg>
        <svg
          className="hit"
          viewBox={VIEW_BOX}
          onPointerDown={pick}
          dangerouslySetInnerHTML={{ __html: hit }}
        />
        <svg className="glow" viewBox={VIEW_BOX} aria-hidden="true">
          <path />
        </svg>
      </div>
      {/* CC BY 4.0 obliges us to credit the source, in the open. */}
      <p className="credit">{geo.attribution}</p>
    </div>
  )
}
