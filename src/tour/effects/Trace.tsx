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
 * component were not mounted. The corridor is geometry, decided once by the
 * browser, never a JS pass/fail choice this component makes about someone
 * else's event.
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
 * WHY THE LIT PROGRESS IS A MOTION VALUE, NOT REACT STATE. A drag reports
 * pointermove at up to the display's own rate; routing that through
 * `useState` would re-render this tree on every one of them. `progress` is
 * written with `.set()`, which — same as `initial`/`animate` on every other
 * `pathLength` draw-on in this codebase (`Outline`, `River`, `Tiger`) —
 * touches only the path's own `pathLength` attribute. Never a `<g>`
 * transform, never the viewBox: see Reveal.tsx and this project's standing
 * rule against re-rasterising the map on every event.
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
import { buildTracePath, nearestOnPath, resamplePath } from './tracePath'
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
  // standing rule (see Reveal.tsx's `useStill`). `pathLength` is an SVG
  // attribute, not a transform, so Motion's own `reducedMotion="user"`
  // handling (App.tsx) does not neuter it by itself; this component must.
  const reduced = useReducedMotionConfig()
  // Same gate `Outline` uses for its own draw-on: a device already caught
  // dropping frames should not also be asked to redraw a 400-point path on
  // every pointermove.
  const enabled = reduced !== true && !isCheap()

  const zoom = useMapZoom()
  const progress = useMotionValue(0)
  const tracing = useRef(false)

  const path = useMemo(() => buildTracePath(d), [d])
  const hits = useMemo(() => resamplePath(path, SPACING), [path])

  if (!enabled) return null

  const start = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (e.pointerType !== 'touch') return
    const local = toPathPoint(e)
    if (!local) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    tracing.current = true
    progress.set(nearestOnPath(path, local.x, local.y).fraction)
  }

  const move = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!tracing.current) return
    const local = toPathPoint(e)
    if (!local) return
    const { distance, fraction } = nearestOnPath(path, local.x, local.y)
    // Off the corridor: a finger that wandered away mid-drag stops adding to
    // the picture rather than lighting whatever happens to be nearest.
    if (distance <= TOLERANCE * zoom) progress.set(fraction)
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
        style={{ pathLength: progress }}
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
