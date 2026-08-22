/**
 * "That whole shape is India... Go on, trace the edge with your finger."
 *
 * A pencil line round the country, drawn in the map's own coordinates so it
 * lands exactly on the map underneath it, and drawn slowly enough that a
 * finger can keep up.
 *
 * This is the one effect that is SKIPPED on slow hardware: dash-stroking a
 * four-hundred-point path every frame is the most expensive thing in the
 * tour, and on an A8X it is what would drop the frames. Cheap mode still
 * shows the outline — it just puts it there all at once.
 */
import { motion } from 'motion/react'
import { isCheap } from '../../../lib/cheapMode'
import { HOLD, Layer, useMapZoom, useStill } from '../Reveal'
import { INDIA_OUTLINE } from './geo'
import { PALETTE as C } from './palette'

/** Slow on purpose: a child is meant to be tracing it. */
const DRAW_S = 2.2

export function Outline() {
  const drawn = !useStill() && !isCheap()
  // A pencil line keeps its weight while the country under it grows.
  const zoom = useMapZoom()
  return (
    <Layer hold={HOLD.outline}>
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
    </Layer>
  )
}
