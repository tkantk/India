/**
 * "Watch this line of water. It is the river Ganga. It begins high up in the
 * snowy mountains, then it runs and runs across the country until it pours
 * itself out into the sea."
 *
 * Which is exactly what it does: the line is the real course of the river,
 * projected with the map's own projection (see scripts/build-geo-art.mjs), so
 * it starts in Uttarakhand, crosses the plains and reaches the Bay of Bengal
 * over the states it actually flows through. It draws for a good second and a
 * half, because "runs and runs" is the point.
 */
import { motion } from 'motion/react'
import { HOLD, Layer, useMapZoom, useStill } from './Reveal'
import { GANGA } from './art/geo'
import { PALETTE as C } from './art/palette'
import { subjectOf } from './subject'

const RIVERS: Record<string, string> = { ganga: GANGA }
const DRAW_S = 1.8

export function River({ name, hold = HOLD.river }: { name: string | undefined; hold?: number }) {
  const still = useStill()
  // The river's COURSE is geography and grows with the map; the width of the
  // line that draws it is not. Without this, the camera on Delhi renders a
  // 16-unit casing as a sixth of the screen.
  const zoom = useMapZoom()
  const d = name ? RIVERS[name] : undefined
  if (!d || !name) return null

  const draw = {
    initial: still ? false : ({ pathLength: 0 } as const),
    animate: { pathLength: 1 },
    transition: { duration: DRAW_S, ease: 'linear' as const },
  }

  // The water itself is the river's own accent (`subject.ts`) — the same
  // colour the read-along strip takes while this line is narrated. The pale
  // casing either side is incidental shading, not the subject, and stays a
  // plain palette literal.
  const { accent } = subjectOf(name)

  return (
    <Layer hold={hold}>
      {/* the shallows either side, then the water itself */}
      <motion.path
        d={d}
        fill="none"
        stroke={C.seaPale}
        strokeWidth={16 * zoom}
        strokeLinecap="round"
        {...draw}
      />
      <motion.path
        d={d}
        fill="none"
        stroke={accent}
        strokeWidth={6 * zoom}
        strokeLinecap="round"
        {...draw}
      />
    </Layer>
  )
}
