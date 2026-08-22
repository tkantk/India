/**
 * "Along the top of India stand the Himalaya mountains... the snow there
 * never melts away."
 *
 * Ten summits, each one at its real place on the map (see
 * scripts/build-geo-art.mjs), rising west to east — Nanga Parbat first,
 * Namcha Barwa last. Every one keeps its snow.
 */
import { motion } from 'motion/react'
import { EASE_OUT, HOLD, Layer } from './Reveal'
import { PEAKS } from './art/geo'
import { PALETTE as C } from './art/palette'

/** Wide enough that ten summits overlap into a range rather than standing
 *  about as ten separate triangles. */
const HALF = 74
const HEIGHT = 108
const SNOW = 0.38

/** Furthest north is furthest away, so it is drawn first and the nearer peaks
 *  overlap it. Sorting a copy: PEAKS is the generated west-to-east order and
 *  the stagger below still wants that one. */
const BACK_TO_FRONT = [...PEAKS].sort((a, b) => a.y - b.y)

/** `hold` is the cue's derived lifetime, in ms; falls back to
 *  `HOLD.mountains` when none reached this cue. */
export function Mountains({ hold = HOLD.mountains }: { hold?: number } = {}) {
  return (
    <Layer hold={hold}>
      {BACK_TO_FRONT.map((peak) => {
        const base = peak.y + HEIGHT
        const sx = HALF * SNOW
        const sy = HEIGHT * SNOW
        // West to east, whatever order they are painted in.
        const order = PEAKS.findIndex((p) => p.name === peak.name)
        return (
          <motion.g
            key={peak.name}
            className="peak"
            initial={{ scaleY: 0.12, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: order * 0.06, ease: EASE_OUT }}
            style={{ originX: 0.5, originY: 1 }}
          >
            <path
              d={`M${peak.x - HALF},${base} L${peak.x},${peak.y} L${peak.x + HALF},${base} Z`}
              /* Brown rock, not stone: --stone is within a shade of the map's
                 own --land, and a mountain the colour of the ground it stands
                 on is not a mountain. */
              fill={order % 2 ? C.stoneDeep : C.bark}
            />
            <path
              d={`M${peak.x - sx},${peak.y + sy}
                  L${peak.x - sx * 0.5},${peak.y + sy * 0.72}
                  L${peak.x - sx * 0.15},${peak.y + sy * 1.05}
                  L${peak.x + sx * 0.35},${peak.y + sy * 0.7}
                  L${peak.x + sx},${peak.y + sy}
                  L${peak.x},${peak.y} Z`}
              fill={C.snow}
            />
          </motion.g>
        )
      })}
    </Layer>
  )
}
