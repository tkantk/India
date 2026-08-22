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
import { useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motion, useMotionValue, useReducedMotionConfig } from 'motion/react'
import { isCheap } from '../../lib/cheapMode'
import { useMapZoom } from './Reveal'
import { buildTracePath, nearestOnPath, resamplePath, ringDelta } from './tracePath'
import { PALETTE as C } from './art/palette'

/**
 * Generous on purpose — a six-year-old's fingertip, not a stylus, and "the
 * feeling to aim for is it lights up when he moves his finger roughly along
 * the edge, not it rewards accuracy" (Task 6's brief). Raw viewBox units:
 * the map's home viewBox is ~1000 units across a screen that is itself
 * roughly that many CSS pixels wide in landscape, so this reads as "tens of
 * pixels" without a runtime CSS-to-viewBox conversion — and `useMapZoom`
 * keeps it that many CSS pixels at any camera position, the same trick
 * `Outline` and `River` use for their own stroke width.
 */
const TOLERANCE = 40

/** The invisible hit circles' spacing, equal to their own radius so two
 *  neighbours always overlap — no gap along the corridor a finger can fall
 *  through (see `tracePath.test.ts`'s "leaves no gap" test). */
const SPACING = TOLERANCE

/** How far, in raw path units, a finger must travel from where it first
 *  touched down before anything lights up. Well under `TOLERANCE`: this is
 *  "was that a deliberate small drag", not another helping of fingertip
 *  forgiveness — the fix for a stray, unmoving tap otherwise reading as a
 *  sudden mark on the map. */
const ENGAGE_UNITS = TOLERANCE / 2

/** The largest distance, in raw path units, the nearest point on the ring
 *  may plausibly move between two consecutive pointer samples. A single
 *  jump bigger than this is a geometry ambiguity, not a drag — two
 *  unconnected stretches of a convoluted coastline passing close in space,
 *  the shape `tracePath.test.ts`'s STAPLE models — and is ignored rather
 *  than lighting an arbitrary arc between two unrelated points. */
const MAX_STEP_UNITS = TOLERANCE * 5

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
  const hits = useMemo(() => resamplePath(path, SPACING), [path])

  if (!enabled) return null

  const start = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (e.pointerType !== 'touch') return
    const local = toPathPoint(e)
    if (!local) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    tracing.current = true
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
    if (distance > TOLERANCE * zoom) return
    if (Math.abs(step) * path.total > MAX_STEP_UNITS) return

    if (direction.current === 0) {
      const fromAnchor = ringDelta(fraction, anchor.current)
      if (Math.abs(fromAnchor) * path.total < ENGAGE_UNITS) return
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
            r={TOLERANCE * zoom}
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
