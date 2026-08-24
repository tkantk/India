/**
 * A closed outline a finger can trace, lighting the traced portion as it
 * goes.
 *
 * Built for the tour's "trace the edge" invitation (`art/Outline.tsx`) but
 * not about India: everything below works over any single closed ring given
 * in the map's own coordinates, so a state screen that wants to trace its
 * own border gets the same gesture for free — hand it that state's `d` and
 * nothing else changes.
 *
 * WHY THIS DOES NOT FIGHT `.stage`'s PICK HANDLER (see MapStage.tsx,
 * hitLayer.ts's `PICK_ROOT`). That handler fires on whatever element the
 * browser's own hit test resolves a pointerdown to; this component is never
 * consulted about that choice; it is answered EACH TIME the browser
 * resolves it. `.tour-overlay` — where this renders, inside `Outline`'s
 * `Layer` — paints above `.map` but is a SIBLING of it, not an ancestor of
 * `.stage`, so an event whose target is one of the invisible circles below
 * never reaches `.stage`'s listener: it was never headed there, and nothing
 * here calls `stopPropagation`. Everywhere else on the map — every pixel not
 * within `TOLERANCE` of the path — has no circle over it, so the browser's
 * hit test falls straight through (`.cue-layer { pointer-events: none }`,
 * effects.css) to `.map` beneath, and tap-to-pick behaves exactly as if this
 * component were not mounted.
 *
 * THIS IS TRUE FOR TOUCH AS WELL AS MOUSE, AND IS DELIBERATE, NOT AN
 * OVERSIGHT. `start()` only bails on a non-touch pointer AFTER the browser
 * has already routed the event here instead of to `.stage` — the routing
 * itself is geometry, decided before either handler runs, and does not care
 * what device sent the event. So for as long as this is mounted (beat 2,
 * ~16s), a touch that lands within `TOLERANCE` of the coastline does NOT
 * pick the state under it, where it would everywhere else in the tour. This
 * is the accepted trade, not a mouse-only quirk: beat 2 is the one moment
 * the child is explicitly invited to put a finger on the coast, so a touch
 * there doing something tracing-shaped instead of picking a state is
 * defensible — see the engagement/monotonic rules below for why it now does
 * something tracing-SHAPED rather than something arbitrary.
 *
 * WHY CIRCLES, NOT A STROKED HIT PATH. `pointer-events: stroke` (or
 * `painted` with a stroke) makes WebKit call `CGPathCreateStrokedPath` on
 * every hit test — the exact cost `hitLayer.ts` avoids for the 36 states by
 * using `pointer-events: fill` on invisible shapes instead (see its own
 * docstring). A necklace of invisible, overlapping, fill-mode circles gets
 * the same cheap test along a path that a stroke would need the expensive
 * one for, and a fingertip does not need the corridor to be exactly the
 * width of the pencil line — see `tracePath.ts`'s `resamplePath`.
 *
 * WHY A TAP DOES NOTHING, AND WHY PROGRESS CANNOT JUMP. The first version of
 * this component wrote `pathLength` straight to `nearestOnPath(...).fraction`
 * on `pointerdown` — so one incidental tap anywhere on the coast drew a
 * large, arbitrary arc from the path's own fixed start point to wherever the
 * tap landed, instantly, and never took it back. That fails the brief's own
 * bar ("a control that responds sometimes is worse than one that was never
 * promised") worse than doing nothing would have. The fix: `start()` only
 * records an ANCHOR — nothing is drawn. `move()` measures how far the finger
 * has travelled from that anchor and does not reveal anything until it
 * passes `ENGAGE_UNITS`, a small but real distance (satisfies "a tap with no
 * movement must produce no visible change"). Once engaged, the revealed arc
 * is `[anchor, anchor + sweep]` (or `[anchor - sweep, anchor]`, going the
 * other way) — `pathOffset` pinned at the anchor, `pathLength` equal to
 * `sweep` — and `sweep` only ever grows to its own high-water mark within
 * one gesture (retracing shrinks the RAW sweep but never the drawn one,
 * which is what "monotonic … never jump backwards" means here). A single
 * pointer sample whose nearest point on the ring has moved further than
 * `MAX_STEP_UNITS` since the last one — a narrow strait putting two
 * far-apart fractions close in space, the exact shape `tracePath.test.ts`'s
 * STAPLE models — is treated as noise, not a leap forward, and ignored.
 *
 * WHY IT RESETS ON ITS OWN. Every ref and motion value here lives inside
 * this component's instance. `Outline`'s `Reveal` wrapper unmounts its
 * whole subtree — this component included — `FADE_MS` after its hold
 * expires, and `overlays.tsx` gives `revealSymbol:outline` a fresh React key
 * every time it fires (so "say it again" animates again); there is nothing
 * for this component to explicitly clear when the outline leaves the
 * screen, because nothing survives it to need clearing.
 *
 * WHY THE LIT PROGRESS IS A MOTION VALUE, NOT REACT STATE. A drag reports
 * pointermove at up to the display's own rate; routing that through
 * `useState` would re-render this tree on every one of them. `pathLength`
 * and `pathOffset` are written with `.set()`, which resolves to the path's
 * `stroke-dasharray`/`stroke-dashoffset` attributes (motion-dom's own
 * `buildSVGPath`) — never a `<g>` transform, never the viewBox: see
 * Reveal.tsx and this project's standing rule against re-rasterising the
 * map on every event. Same single-path repaint cost class as `Outline`'s own
 * time-based draw-on, just driven by a finger instead of a clock.
 *
 * WHY TOUCH ONLY. "Go on, trace the edge with your FINGER" — a mouse is not
 * one, and it is also the one input this project's own testing tools drive
 * (Playwright, `npm run tour:strip`), so gating on `pointerType === 'touch'`
 * is also what keeps this feature honestly unverified by anything other
 * than a real finger, rather than quietly "working" for a mouse-driven
 * check that proves nothing about a six-year-old's hand.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motion, useMotionValue, useReducedMotionConfig } from 'motion/react'
import { isCheap } from '../../lib/cheapMode'
import { useMapZoom } from './Reveal'
import { buildTracePath, nearestOnPath, resamplePath, ringDelta } from './tracePath'
import type { TracePath } from './tracePath'
import { setTracing } from './tracing'
import { PALETTE as C } from './art/palette'

/**
 * How many hit-circles the corridor is divided into, regardless of the
 * traced shape's own size.
 *
 * THIS USED TO BE A FLAT 40 RAW VIEWBOX UNITS, tuned for INDIA'S OWN
 * MAINLAND RING (~5184 units round) — "the map's home viewBox is ~1000
 * units across... this reads as 'tens of pixels'" (that reasoning is still
 * right; only WHERE it applies changed). `resamplePath` walks a path in
 * fixed-size strides, so a 40-unit stride against a country-sized ring
 * produced ~130 evenly-spaced, overlapping circles — generous, as
 * intended. The exact same 40-unit stride against DELHI'S 70-unit border
 * produced ONE OR TWO circles for the whole state: most of the loop was
 * further than a stride from either one, which reads as dead, not
 * generous, and Kerala's own longer-but-still-small coastline landed
 * between the two — patchy. `Trace({ d })` is deliberately general (see
 * this file's own top comment); a fixed number of RAW UNITS is not general
 * at all, it is India-shaped.
 *
 * The fix ties the stride to a FRACTION of the shape's OWN perimeter
 * instead, so the circle COUNT — not their raw-unit size — is what stays
 * constant. 130 reproduces ~39.9 raw units per circle for India's own
 * mainland ring specifically (5184 / 130), indistinguishable from the
 * constant it replaces, so beat 2 of the tour is unaffected; the same 130
 * circles spread over a small state's own (much shorter) border shrink
 * WITH it, and — because that state's own camera flight (see
 * `PlaceScreen.tsx`'s `ARRIVAL_MARGIN`) zooms in by roughly the same
 * proportion a smaller shape needs — the two effects cancel out on screen:
 * measured directly, Rajasthan, Kerala, Delhi, Goa and Sikkim all land
 * within roughly 40-70 CSS px of touch reach at their own settled camera
 * position, not the 0-2px stride Delhi's border got under the flat
 * constant.
 */
const SEGMENTS = 130

/**
 * The corridor's own reach for ONE traced path, in THAT path's own raw
 * units — exported so a test (or a future caller) computes the exact same
 * number `Trace` itself uses rather than hand-copying the formula above.
 */
export function toleranceFor(path: TracePath): number {
  return path.total / SEGMENTS
}

/** Wrap a fraction back into 0..1. `ringDelta` already keeps deltas short;
 *  this is only for turning an anchor-minus-sweep back into a valid
 *  `pathOffset` when the arc being revealed crosses back over the seam. */
const mod1 = (x: number) => ((x % 1) + 1) % 1

/** Resolve a pointer event to the path's own coordinate space via the SVG
 *  it landed in, or null if the browser cannot answer that (no SVG
 *  geometry — every jsdom test but the ones that stub it). */
function toPathPoint(e: ReactPointerEvent<SVGCircleElement>): { x: number; y: number } | null {
  const svg = (e.currentTarget as unknown as Element).closest('svg') as SVGSVGElement | null
  const ctm = svg?.getScreenCTM?.()
  if (!svg || !ctm || typeof svg.createSVGPoint !== 'function') return null
  const point = svg.createSVGPoint()
  point.x = e.clientX
  point.y = e.clientY
  return point.matrixTransform(ctm.inverse())
}

export function Trace({ d, strokeWidth = 10 }: { d: string; strokeWidth?: number }) {
  // `useReducedMotionConfig`, never `useReducedMotion` — this project's
  // standing rule (see Reveal.tsx's `useStill`). `pathLength`/`pathOffset`
  // are SVG attributes, not transforms, so Motion's own `reducedMotion=
  // "user"` handling (App.tsx) does not neuter them by itself; this
  // component must.
  const reduced = useReducedMotionConfig()
  // Same gate `Outline` uses for its own draw-on: a device already caught
  // dropping frames should not also be asked to redraw a 400-point path on
  // every pointermove.
  const enabled = reduced !== true && !isCheap()

  const zoom = useMapZoom()
  const length = useMotionValue(0)
  const offset = useMotionValue(0)

  // One gesture's worth of bookkeeping, none of it React state: nothing
  // here should cause a re-render, and nothing here needs to survive a
  // pointerup. See this file's own "WHY A TAP DOES NOT MOVE ANYTHING" note.
  const tracing = useRef(false)
  const anchor = useRef(0)
  const last = useRef(0)
  /** 0 = not yet engaged this gesture; +1/-1 = the direction that engaged
   *  it, locked for the rest of the gesture. */
  const direction = useRef<0 | 1 | -1>(0)
  /** The raw, current sweep from the anchor — can shrink as a finger
   *  retraces towards it. */
  const sweep = useRef(0)
  /** The high-water mark of `sweep` this gesture — never shrinks. This, not
   *  `sweep`, drives what is actually drawn. */
  const sweepHigh = useRef(0)

  const path = useMemo(() => buildTracePath(d), [d])
  // This shape's own corridor reach — see `toleranceFor`'s own comment.
  // Spacing equal to the radius is what guarantees no gap between
  // neighbouring circles (`tracePath.test.ts`'s "leaves no gap" test), the
  // same relationship the old flat constant kept, just now derived from
  // the path actually being traced instead of a number sized for India.
  const tolerance = useMemo(() => toleranceFor(path), [path])
  const hits = useMemo(() => resamplePath(path, tolerance), [path, tolerance])

  // The published half of "a finger is down" must not outlive this
  // component: `Outline`'s `Reveal` unmounts this whole subtree the moment
  // its hold expires, mid-gesture if a finger is still moving when it does
  // (exactly the Task 5 wall-clock interaction this file's own dwell-timer
  // consumer has to live with). Without this, an unmount mid-touch would
  // leave `isTracing()` stuck true forever — no `pointerup` is coming for a
  // pointer this component no longer has a listener on.
  useEffect(() => () => setTracing(false), [])

  if (!enabled) return null

  const start = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (e.pointerType !== 'touch') return
    const local = toPathPoint(e)
    if (!local) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    tracing.current = true
    setTracing(true)
    const { fraction } = nearestOnPath(path, local.x, local.y)
    anchor.current = fraction
    last.current = fraction
    direction.current = 0
    sweep.current = 0
    sweepHigh.current = 0
    // Deliberately nothing written to `length`/`offset` here: this is the
    // anchor, not a reveal. Whatever a previous gesture already drew (if
    // any) stays exactly as it was until THIS gesture actually moves.
  }

  const move = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!tracing.current) return
    const local = toPathPoint(e)
    if (!local) return
    const { distance, fraction } = nearestOnPath(path, local.x, local.y)

    const step = ringDelta(fraction, last.current)
    last.current = fraction

    // Off the corridor, or a single-sample jump too large to be a real
    // drag: this sample does not move the picture, but bookkeeping (`last`)
    // still advances above so the NEXT sample is judged against where the
    // finger actually is, not left comparing against a stale point forever.
    //
    // Neither check is scaled by live camera zoom (`useMapZoom`) any more —
    // `tolerance` is already sized for THIS shape at its own settled
    // camera position (see `toleranceFor`'s comment); multiplying by a
    // second, independently-varying zoom factor on top would decouple it
    // from `hits`' own spacing again, the exact bug this replaces.
    if (distance > tolerance) return
    if (Math.abs(step) * path.total > tolerance * 5) return

    if (direction.current === 0) {
      const fromAnchor = ringDelta(fraction, anchor.current)
      if (Math.abs(fromAnchor) * path.total < tolerance / 2) return
      direction.current = fromAnchor > 0 ? 1 : -1
      sweep.current = Math.abs(fromAnchor)
    } else if (Math.sign(step) === direction.current) {
      sweep.current = Math.min(1, sweep.current + Math.abs(step))
    } else {
      sweep.current = Math.max(0, sweep.current - Math.abs(step))
    }

    if (sweep.current > sweepHigh.current) {
      sweepHigh.current = sweep.current
      offset.set(direction.current === 1 ? anchor.current : mod1(anchor.current - sweepHigh.current))
      length.set(sweepHigh.current)
    }
  }

  const end = (e: ReactPointerEvent<SVGCircleElement>) => {
    tracing.current = false
    setTracing(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  return (
    <>
      {/* The lit portion. Never a tap target itself, same as every other
          piece of tour art (effects.css). */}
      <motion.path
        d={d}
        fill="none"
        stroke={C.gold}
        strokeWidth={strokeWidth * zoom}
        strokeLinecap="round"
        style={{ pathLength: length, pathOffset: offset }}
        pointerEvents="none"
      />
      {/* The corridor. `fill="none"` + `pointer-events="fill"` is
          hitLayer.ts's own inert pattern: hit-tested by fill geometry
          regardless of what is actually painted, so this costs nothing to
          rasterise. */}
      <g data-testid="trace-hits">
        {hits.map(([cx, cy], i) => (
          <circle
            key={i}
            data-testid="trace-hit"
            cx={cx}
            cy={cy}
            r={tolerance}
            fill="none"
            pointerEvents="fill"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </g>
    </>
  )
}
