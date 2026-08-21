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
 *   4. `.glow`   one copy of the currently lit path, carrying a CSS
 *                drop-shadow(). Never an SVG <filter>: WebKit blurs those on
 *                the CPU in three passes.
 *
 * The two SVG bodies are strings injected once with `dangerouslySetInnerHTML`.
 * Written as JSX they would be 269 KB of path data for React's reconciler to
 * walk on every render; `<use>` would be worse still, since `SVGUseElement`
 * deep-clones its target into a shadow tree.
 */

const VIEW_BOX = geo.viewBox.join(' ')

/** Pin radius, in viewBox units. See `pinned()`. */
const PIN_R = 22

type Place = { name: string; type: string; d: string }
type Hit = { d: string; pin: number[]; r: number }

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
 * that is smaller than the pin, the pin reaches past the real shape and gives
 * a child somewhere to land; where it is larger, the pin would sit wholly
 * inside a shape that is already easy to hit, and only cost a hit test.
 *
 * Bounding-box area cannot make this call: Puducherry's bbox is 245x221
 * viewBox units, larger than Punjab's, because it is four enclaves scattered
 * down the coast — and its actual land is 56 square units. Andaman & Nicobar
 * and Lakshadweep fail the same way.
 */
const pinned = (slug: string) => hits[slug].r < PIN_R

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

  // Pins come after every outline, and the smallest place's pin comes last of
  // all: SVG hit testing takes the topmost node, and Delhi's pin necessarily
  // overlaps Haryana. Painting order is what decides who gets the tap.
  const pins = Object.entries(hits)
    .filter(([slug]) => pinned(slug))
    .sort(([, a], [, b]) => b.r - a.r)
    .map(
      ([slug, h]) =>
        `<circle data-slug="${slug}" data-testid="pin-${slug}"` +
        ` aria-label="${esc(places[slug].name)}"` +
        ` cx="${h.pin[0]}" cy="${h.pin[1]}" r="${PIN_R}" ${inert}/>`,
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
    if (slug) onPick(slug)
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
