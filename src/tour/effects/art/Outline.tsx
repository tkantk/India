/**
 * "That whole shape is India... Go on, trace the edge with your finger."
 *
 * A pencil line round the country, drawn in the map's own coordinates so it
 * lands exactly on the map underneath it, and drawn slowly enough that a
 * finger can keep up — and, since Task 6, an actual finger can: `Trace`
 * lights the traced portion gold as it goes, over the same coordinates.
 *
 * This is the one effect that is SKIPPED on slow hardware: dash-stroking a
 * four-hundred-point path every frame is the most expensive thing in the
 * tour, and on an A8X it is what would drop the frames. Cheap mode still
 * shows the outline — it just puts it there all at once, and `drawn` gates
 * `Trace` too: a device already caught missing frames should not also be
 * asked to redraw that same path on every touch.
 */
import { motion } from 'motion/react'
import { isCheap } from '../../../lib/cheapMode'
import { HOLD, Layer, useMapZoom, useStill } from '../Reveal'
import { Trace } from '../Trace'
import { INDIA_OUTLINE } from './geo'
import { PALETTE as C } from './palette'

/** Slow on purpose: a child is meant to be tracing it. */
const DRAW_S = 2.2

/**
 * `INDIA_OUTLINE` is the whole country: the mainland ring first, then a
 * handful of tiny island slivers too small for a fingertip to usefully trace
 * (see geo.ts's own "Biggest ring first" note). `Trace` measures progress in
 * arc length along whatever `d` it is given, so tracing the mainland alone —
 * up to the first `Z` — keeps that measurement meaningful; folding the
 * islands in would let a stray touch out in the Andamans silently eat into
 * the same fraction as the coastline itself.
 */
const MAINLAND = INDIA_OUTLINE.slice(0, INDIA_OUTLINE.indexOf('Z') + 1)

/** `hold` is the cue's derived lifetime, in ms; falls back to `HOLD.outline`
 *  when none reached this cue. */
export function Outline({ hold = HOLD.outline }: { hold?: number } = {}) {
  const drawn = !useStill() && !isCheap()
  // A pencil line keeps its weight while the country under it grows.
  const zoom = useMapZoom()
  return (
    <Layer hold={hold}>
      <motion.path
        d={INDIA_OUTLINE}
        fill="none"
        stroke={C.ink}
        strokeWidth={3.2 * zoom}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
        initial={drawn ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: DRAW_S, ease: 'linear' }}
      />
      {/* `Trace` gates itself on reduced motion; `drawn` folds in `isCheap()`
          too, so a slow device that skips the draw-on also skips tracing. */}
      {drawn && <Trace d={MAINLAND} />}
    </Layer>
  )
}
