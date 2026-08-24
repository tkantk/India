import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import geo from '../data/geo.json'
import hitData from '../data/hit.json'
import world from '../data/world.json'
import { isCheap } from '../lib/cheapMode'
import { recordTapRejection } from '../audio/diagnostics'
import { bindCamera } from './camera'
import { bindMapNodes } from './useMapNodes'
import {
  PICK_ROOT, SNAP_PX, describeTap,
  baseMarkup, hitMarkup, buildOutlines, nearestOutline,
  type HitPlace, type Outline, type PointerSample,
} from './hitLayer'
import { seaMarkup } from './sea'
import './map.css'

/**
 * The map: five layers, in DOM order, each one shaped by WebKit's legacy SVG
 * engine — the one on every iPad this has to run on.
 *
 *   1. `.stage`  an HTML <div>. The only element that is ever transformed.
 *                `LegacyRenderSVGModelObject` derives from `RenderElement`,
 *                not `RenderLayerModelObject`, so an SVG child can never own
 *                a compositor layer: a transform on a <g> is a main-thread
 *                repaint of all 36 paths, every frame. The camera flies by
 *                transforming this div, and this component hands the element
 *                itself to `bindCamera` rather than letting the camera look
 *                it up by class. It also owns the one delegated tap — see
 *                PICK_ROOT in hitLayer.ts.
 *   2. `.sea`    Task 5: the neighbouring land beyond India's own border —
 *                Pakistan, China, Nepal, Bhutan, Bangladesh, Myanmar, Sri
 *                Lanka and a few more within a generous box, muted and flat,
 *                `pointer-events: none`. It exists so the map stops making a
 *                claim it cannot back up: unbroken pale blue on every side of
 *                India reads, to a six-year-old, as "India is an island",
 *                which is false and which nothing in the narration corrects.
 *                Beneath `.base` in DOM order — SVG paints later siblings on
 *                top — so India's own opaque land always wins where the two
 *                would otherwise overlap; `build-world.mjs` also erases every
 *                neighbour polygon against India's depicted boundary before
 *                this ever reaches the browser, so that overlap should not
 *                exist in the first place. It shares `.base`/`.hit`/`.glow`'s
 *                viewBox and is a child of `.stage` for the same reason they
 *                are: the camera commits a new viewBox onto every svg child
 *                of the stage on a flight (see `camera.ts`'s `flyTo`), and a
 *                layer outside that loop would drift out from under the
 *                coastline the moment the child zoomed in.
 *   3. `.base`   the visible art, with `pointer-events: none` on the group.
 *   4. `.hit`    coarse invisible geometry, `fill="none" stroke="none"
 *                pointer-events="fill"`.
 *   5. `.glow`   one copy of the currently lit path. The CSS drop-shadow()
 *                goes on this <svg> root, which is a replaced element and can
 *                composite, never on the path inside it or on an SVG
 *                <filter> — both of those are WebKit's CPU three-pass blur.
 *
 * The SVG bodies are strings injected once with `dangerouslySetInnerHTML`.
 * Written as JSX they would be hundreds of KB of path data for React's
 * reconciler to walk on every render; `<use>` would be worse still, since
 * `SVGUseElement` deep-clones its target into a shadow tree.
 *
 * The markup and the snapping both live in `hitLayer.ts` (and, for the sea,
 * `sea.ts`), so the headless browser probe (`npm run probe:map`) measures
 * this map and not a copy of it.
 */

const VIEW_BOX = geo.viewBox.join(' ')

const hits: Record<string, HitPlace> = hitData.places
const names: Record<string, string> = Object.fromEntries(
  Object.entries(geo.places).map(([slug, p]) => [slug, p.name]),
)

/**
 * Built once for the life of the module: 269 KB of path data must never be
 * rebuilt on a render, and StrictMode mounts every component twice.
 *
 * THE PROP OBJECTS, not the strings, and that is not tidiness. React 19
 * compares `dangerouslySetInnerHTML` by IDENTITY — `updateProperties` only
 * looks at `nextProp !== lastProp` and then writes — so a fresh
 * `{ __html: base }` literal on every render re-parses all 36 visible paths
 * and all 50 hit shapes, and hands the DOM a completely new set of elements.
 * The elements `useMapNodes` cached are then detached, and every highlight
 * after the first re-render silently lands on a node nobody can see.
 *
 * Nothing re-rendered this component before Task 10; the tour re-renders it
 * on every beat.
 */
let baseCache: { __html: string } | null = null
let hitCache: { __html: string } | null = null
let seaCache: { __html: string } | null = null
let outlines: Outline[] | null = null

/**
 * The place whose outline is nearest to (x, y) in viewBox units, or null.
 * Parsed on the first miss, not at startup: most sessions never need it.
 */
export function nearestPlace(x: number, y: number, within: number): string | null {
  return nearestOutline((outlines ??= buildOutlines(hits)), x, y, within)
}

type Props = {
  /** Fires on a tap — `pointerdown` paired with a `pointerup` that has not
   *  travelled far or taken long (`isTap` in `hitLayer.ts`) — not on
   *  `pointerdown` alone and not on the browser's own `click`. `pointerdown`
   *  alone used to fire this on the very first frame of a drag, which meant
   *  a child could not touch the map to scroll or explore it without ending
   *  whatever was playing; `click` would cost the responsiveness that makes
   *  a map feel alive, and still would not tell a scroll attempt from a tap. */
  onPick: (slug: string) => void
}

export function MapStage({ onPick }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const hitSvg = useRef<SVGSVGElement>(null)
  // Module-scoped, not merely memoised: React may throw a useMemo cache away,
  // and a new object here means a new DOM.
  const base = useMemo(() => (baseCache ??= { __html: baseMarkup(geo.places) }), [])
  const hit = useMemo(() => (hitCache ??= { __html: hitMarkup(hits, names) }), [])
  const sea = useMemo(() => (seaCache ??= { __html: seaMarkup(world.places) }), [])

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
   *
   * Called only once `describeTap` has already said this pointerdown/pointerup
   * pair IS a tap — see below. It reads `e.target` off the pointerup, which
   * for an ordinary tap has barely moved from wherever `pointerdown` hit.
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

  /**
   * Every gesture currently down, keyed by its own `pointerId` — NOT one
   * slot. Children rest a palm on the map and use two hands constantly, so
   * a second finger landing before the first lifts is routine, not an edge
   * case. A single ref slot got this wrong twice over: a second pointerdown
   * overwrote the first finger's sample, and `onPointerUp` cleared that one
   * slot unconditionally even when the lifting pointer did not match it —
   * so BOTH fingers' lifts went silently unrecognised, not just the second
   * one's. It fails closed (no wrong picks), but the symptom a child sees is
   * a map that stops answering taps for no visible reason.
   */
  const down = useRef(new Map<number, PointerSample>())

  const sample = (e: PointerEvent<HTMLDivElement>): PointerSample =>
    ({ pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp })

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    down.current.set(e.pointerId, sample(e))
  }

  /** The other half of the gate. A pick only ever fires from here, once the
   *  full gesture is in hand and `describeTap` has judged it a deliberate
   *  tap rather than an accidental brush or the first frames of a scroll —
   *  and only the entry for the pointer that actually lifted is ever
   *  touched; every other finger still on the map is left exactly as it was. */
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const started = down.current.get(e.pointerId)
    down.current.delete(e.pointerId)
    if (!started) return
    const verdict = describeTap(started, sample(e))
    if (verdict.tap) { pick(e); return }
    // Not a repair — see `recordTapRejection`'s own docstring — only a
    // record, for whoever is watching `?debug=audio` on the device where a
    // real child's tap just missed the gate.
    recordTapRejection(verdict.reason, verdict.distancePx, verdict.durationMs)
  }

  /** The browser cancels ONE gesture out from under us — a native scroll
   *  taking over is the common case — and only that pointer's entry is
   *  forgotten; a second finger still down is untouched. Either way it is
   *  not a tap, and there is no `pointerup` coming to say so for this one. */
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    down.current.delete(e.pointerId)
  }

  return (
    <>
      <div className="map" ref={root}>
        <div
          className={PICK_ROOT}
          ref={stage}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <svg className="sea" viewBox={VIEW_BOX} aria-hidden="true" dangerouslySetInnerHTML={sea} />
          <svg className="base" viewBox={VIEW_BOX} aria-hidden="true">
            <g pointerEvents="none" dangerouslySetInnerHTML={base} />
          </svg>
          <svg
            className="hit"
            viewBox={VIEW_BOX}
            ref={hitSvg}
            dangerouslySetInnerHTML={hit}
          />
          {glowing && (
            <svg className="glow" viewBox={VIEW_BOX} aria-hidden="true">
              <path />
            </svg>
          )}
        </div>
      </div>
      {/* CC BY 4.0 obliges us to credit the source, in the open.

          A SIBLING of `.map`, not a child — `.map + .credit` in map.css —
          on purpose. Task 4 frames `.map` narrower than the stage it stands
          in, to leave the read-along room at the bottom, and `.map` is
          `overflow: hidden` besides: a child positioned against that shorter
          box is measured from the wrong edge and dragged up into the middle
          of the country. A sibling is measured from whatever full-height box
          the caller wraps the two of them in — `.tour-stage`, today.

          And the boundaries are only one of 32 third-party assets: 20
          photographs and 11 sounds ship with this app too, 25 of them under
          licences that require the author named and the licence linked. They
          cannot all sit on the map, so the credit line is also the door to
          the page that does carry them. A small link on a line that is
          already about licensing — not a sixth 104px button beside the five
          a child actually uses.

          `<span>` around the attribution, not bare text: the required
          wording has to stay one findable string now that it has a
          neighbour. */}
      <p className="credit">
        <span>{geo.attribution}</span>
        {' · '}
        <a className="credit__more" href="#/credits">Credits</a>
      </p>
    </>
  )
}
