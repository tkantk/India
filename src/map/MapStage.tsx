import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import geo from '../data/geo.json'
import hitData from '../data/hit.json'
import world from '../data/world.json'
import { isCheap } from '../lib/cheapMode'
import { bindCamera, camera } from './camera'
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
  /**
   * May a finger drag and pinch this map? Off by default, and opt-in per
   * screen rather than global, because the two screens want opposite things.
   *
   * The PLACE screen wants it: it arrives zoomed onto one state, which by
   * construction pushes the rest of the country off the edges — fly to
   * Kerala and everything north of it is simply gone, with no way back to it
   * short of leaving the screen. That is the report this was built for.
   *
   * The TOUR does not: it is a narrated sequence that flies the camera on
   * cue, and a child who drags mid-beat would be fighting the narration for
   * control of the same viewBox — the next cue would yank it back anyway,
   * which reads as the map snatching itself away rather than as an
   * interaction.
   */
  explorable?: boolean
}

export function MapStage({ onPick, explorable = false }: Props) {
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
   * WHERE ON THE MAP EACH FINGER FIRST LANDED, in viewBox units, kept only
   * while `explorable`. The model is "the land under your finger stays under
   * your finger": every move recomputes the view that would put this anchor
   * back beneath the live pointer, rather than accumulating deltas. That is
   * what makes a clamped drag self-correcting — once `clampView` refuses to
   * go further, an accumulating drag would keep banking movement the map
   * never made and the country would slide out from under the fingertip the
   * moment the child dragged back.
   */
  const anchors = useRef(new Map<number, { x: number; y: number }>())
  /** Live client positions, so a two-finger gesture can read the OTHER
   *  finger's current position during this finger's move event. */
  const live = useRef(new Map<number, { x: number; y: number }>())
  /** Did this gesture actually move the camera? A pan already fails
   *  `describeTap`'s 20px slop, but a PINCH can zoom the map a long way
   *  while either finger individually stays inside it, and that must not
   *  also count as a tap on whatever was underneath. Cleared when the last
   *  finger lifts, not on each one, or the second lift would pick. */
  const explored = useRef(false)

  /** A client point in the map's own viewBox coordinates, via the same hit
   *  layer CTM `pick` uses — not a ratio of the stage's box, because the
   *  layers letterbox by `preserveAspectRatio` and a ratio would drift by
   *  the letterbox on any screen whose shape is not the viewBox's. */
  const toMap = (clientX: number, clientY: number) => {
    const svg = hitSvg.current
    const ctm = svg?.getScreenCTM?.()
    if (!svg || !ctm) return null
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    return point.matrixTransform(ctm.inverse())
  }

  /**
   * One finger drags, two fingers pinch. Both are solved the same way: find
   * the view that puts the anchors back under the fingers.
   *
   * For a drag that is a straight translation. For a pinch, the scale is how
   * much the gap between the two anchors has to shrink to match the gap
   * between the live fingers, and the position then places the anchors'
   * midpoint under the fingers' midpoint. Positions are expressed as a
   * FRACTION of the current view before being re-applied at the new size,
   * which is what keeps the zoom centred between the fingers instead of on
   * the middle of the screen.
   */
  const explore = () => {
    if (!explorable) return
    const view = camera.view()
    if (!view) return
    const ids = [...anchors.current.keys()].filter((id) => live.current.has(id))
    if (ids.length === 0) return

    const at = (id: number) => {
      const l = live.current.get(id)!
      return toMap(l.x, l.y)
    }

    if (ids.length === 1) {
      const a = anchors.current.get(ids[0])!
      const q = at(ids[0])
      if (!q) return
      if (camera.setView([view[0] + (a.x - q.x), view[1] + (a.y - q.y), view[2], view[3]])) {
        explored.current = true
      }
      return
    }

    const [i, j] = ids
    const a1 = anchors.current.get(i)!, a2 = anchors.current.get(j)!
    const q1 = at(i), q2 = at(j)
    if (!q1 || !q2) return
    const spread = Math.hypot(q1.x - q2.x, q1.y - q2.y)
    // Two fingers on the same pixel would divide by zero and throw the view
    // to infinity; there is nothing sensible to do with that gesture anyway.
    if (spread < 1e-6) return
    const scale = Math.hypot(a1.x - a2.x, a1.y - a2.y) / spread
    const w = view[2] * scale
    const h = view[3] * scale
    const qMid = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 }
    const aMid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 }
    const fx = (qMid.x - view[0]) / view[2]
    const fy = (qMid.y - view[1]) / view[3]
    if (camera.setView([aMid.x - fx * w, aMid.y - fy * h, w, h])) explored.current = true
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
    if (!explorable) return
    live.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const q = toMap(e.clientX, e.clientY)
    if (q) anchors.current.set(e.pointerId, { x: q.x, y: q.y })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!explorable || !live.current.has(e.pointerId)) return
    live.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    explore()
  }

  /** The other half of the gate. A pick only ever fires from here, once the
   *  full gesture is in hand and `describeTap` has judged it a deliberate
   *  tap rather than an accidental brush or the first frames of a scroll —
   *  and only the entry for the pointer that actually lifted is ever
   *  touched; every other finger still on the map is left exactly as it was. */
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const started = down.current.get(e.pointerId)
    down.current.delete(e.pointerId)
    const wasExploring = forget(e.pointerId)
    if (!started) return
    // A gesture that moved the camera is never also a tap on what was under
    // it. Checked BEFORE describeTap because a pinch can leave either finger
    // well inside the tap slop while having zoomed the map a long way.
    if (wasExploring) return
    const verdict = describeTap(started, sample(e))
    if (verdict.tap) pick(e)
  }

  /** Drop one finger from the gesture and report whether the gesture it
   *  belonged to had moved the camera. The `explored` flag is only cleared
   *  once the LAST finger is up: clearing it per finger would let the second
   *  lift of a pinch register as a tap. */
  const forget = (pointerId: number): boolean => {
    const moved = explored.current
    anchors.current.delete(pointerId)
    live.current.delete(pointerId)
    if (live.current.size === 0) explored.current = false
    return moved
  }

  /** The browser cancels ONE gesture out from under us — a native scroll
   *  taking over is the common case — and only that pointer's entry is
   *  forgotten; a second finger still down is untouched. Either way it is
   *  not a tap, and there is no `pointerup` coming to say so for this one. */
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    down.current.delete(e.pointerId)
    forget(e.pointerId)
  }

  return (
    <>
      <div className="map" ref={root}>
        <div
          className={PICK_ROOT}
          ref={stage}
          // `touch-action: none` (map.css) only where the map is explorable:
          // without it the browser claims the drag as a page scroll and the
          // pan never gets its move events, and WITH it on a screen that
          // does not pan the child would lose the page scroll for nothing.
          data-explorable={explorable ? 'true' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
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
