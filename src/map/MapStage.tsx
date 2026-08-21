import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import geo from '../data/geo.json'
import hitData from '../data/hit.json'
import { isCheap } from '../lib/cheapMode'
import { bindCamera } from './camera'
import { bindMapNodes } from './useMapNodes'
import {
  PICK_ROOT, SNAP_PX,
  baseMarkup, hitMarkup, buildOutlines, nearestOutline,
  type HitPlace, type Outline,
} from './hitLayer'
import './map.css'

/**
 * The map: four layers, in DOM order, each one shaped by WebKit's legacy SVG
 * engine — the one on every iPad this has to run on.
 *
 *   1. `.stage`  an HTML <div>. The only element that is ever transformed.
 *                `LegacyRenderSVGModelObject` derives from `RenderElement`,
 *                not `RenderLayerModelObject`, so an SVG child can never own
 *                a compositor layer: a transform on a <g> is a main-thread
 *                repaint of all 36 paths, every frame. The camera flies by
 *                transforming this div, and this component hands the element
 *                itself to `bindCamera` rather than letting the camera look
 *                it up by class. It also owns the one delegated pointerdown
 *                — see PICK_ROOT in hitLayer.ts.
 *   2. `.base`   the visible art, with `pointer-events: none` on the group.
 *   3. `.hit`    coarse invisible geometry, `fill="none" stroke="none"
 *                pointer-events="fill"`.
 *   4. `.glow`   one copy of the currently lit path. The CSS drop-shadow()
 *                goes on this <svg> root, which is a replaced element and can
 *                composite, never on the path inside it or on an SVG
 *                <filter> — both of those are WebKit's CPU three-pass blur.
 *
 * The two SVG bodies are strings injected once with `dangerouslySetInnerHTML`.
 * Written as JSX they would be 269 KB of path data for React's reconciler to
 * walk on every render; `<use>` would be worse still, since `SVGUseElement`
 * deep-clones its target into a shadow tree.
 *
 * The markup and the snapping both live in `hitLayer.ts`, so the headless
 * browser probe (`npm run probe:map`) measures this map and not a copy of it.
 */

const VIEW_BOX = geo.viewBox.join(' ')

const hits: Record<string, HitPlace> = hitData.places
const names: Record<string, string> = Object.fromEntries(
  Object.entries(geo.places).map(([slug, p]) => [slug, p.name]),
)

// Built once for the life of the module: 269 KB of path data must never be
// rebuilt on a render, and StrictMode mounts every component twice.
let baseCache: string | null = null
let hitCache: string | null = null
let outlines: Outline[] | null = null

/**
 * The place whose outline is nearest to (x, y) in viewBox units, or null.
 * Parsed on the first miss, not at startup: most sessions never need it.
 */
export function nearestPlace(x: number, y: number, within: number): string | null {
  return nearestOutline((outlines ??= buildOutlines(hits)), x, y, within)
}

type Props = {
  /** Fires on pointerdown, not click: a child's finger moves, and waiting for
   *  a clean click costs the responsiveness that makes a map feel alive. */
  onPick: (slug: string) => void
}

export function MapStage({ onPick }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const hitSvg = useRef<SVGSVGElement>(null)
  const base = useMemo(() => (baseCache ??= baseMarkup(geo.places)), [])
  const hit = useMemo(() => (hitCache ??= hitMarkup(hits, names)), [])

  /**
   * Whether this iPad gets the glow at all, decided once at mount.
   *
   * The layer is cheap while it is dark, but the filter that lights it forces
   * a full-screen composited layer — about 12.6 MB on a 2048x1536 iPad. On
   * hardware that cannot afford that, the layer should not be there to be lit.
   * Read once rather than subscribed to: a map that grew a fourth layer
   * halfway through a sentence would be worse than either answer.
   */
  const [glowing] = useState(() => !isCheap())

  useEffect(() => {
    bindMapNodes(root.current)
    bindCamera(stage.current)
    return () => {
      bindMapNodes(null)
      bindCamera(null)
    }
  }, [])

  /**
   * One listener for the whole map. It sits on the stage, an ancestor of all
   * three layers, and not on the hit layer: the hit layer's root is
   * `pointer-events: none` so that its children can be `fill`, so a tap that
   * lands on no place never targets anything inside it. 36 handlers in JSX
   * would mean mapping over the places in React, which is exactly what the
   * injected markup avoids.
   */
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const slug = (e.target as Element).closest?.('[data-slug]')?.getAttribute('data-slug')
    if (slug) {
      onPick(slug)
      return
    }

    // Hit nothing. Rather than ignore the child, snap to whatever is within a
    // fingertip's reach — and to nothing at all out in the open sea.
    const svg = hitSvg.current
    const ctm = svg?.getScreenCTM?.()
    if (!svg || !ctm) return
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
      <div className={PICK_ROOT} ref={stage} onPointerDown={pick}>
        <svg className="base" viewBox={VIEW_BOX} aria-hidden="true">
          <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: base }} />
        </svg>
        <svg
          className="hit"
          viewBox={VIEW_BOX}
          ref={hitSvg}
          dangerouslySetInnerHTML={{ __html: hit }}
        />
        {glowing && (
          <svg className="glow" viewBox={VIEW_BOX} aria-hidden="true">
            <path />
          </svg>
        )}
      </div>
      {/* CC BY 4.0 obliges us to credit the source, in the open. */}
      <p className="credit">{geo.attribution}</p>
    </div>
  )
}
