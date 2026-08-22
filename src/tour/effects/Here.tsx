/**
 * "Hold on, we are flying there now. **Look down.**"
 *
 * And until Task 10 there was nothing to look down at. The flight lands on
 * Delhi at word 20 and India Gate does not rise until word 36, and at that
 * zoom Delhi's own fill is the same beige as every other state — so for six
 * seconds a child was told to look at a featureless field.
 *
 * This is the answer to "look down": a soft ring where the camera has just
 * put them. Deliberately NOT a lit state — at a 10x zoom that floods the
 * whole screen with saffron, which is the thing the highlight release exists
 * to prevent — and deliberately not a pin drop. It is Mor's own peacock blue,
 * quiet, and it fades out exactly as India Gate rises from the same spot.
 *
 * IT WAITS OUT THE FLIGHT. `.tour-overlay` is a sibling of `.map`, so it is
 * not carried by the transform the camera flies with: a marker drawn before
 * the commit sits where Delhi USED to be on screen and jumps 400 ms later.
 * The delay on the group's opacity is what keeps it invisible until the
 * camera has landed and `useCameraView` has caught up.
 */
import { motion } from 'motion/react'
import { HOLD, Layer, useMapZoom, useStill } from './Reveal'
import { PALETTE as C } from './art/palette'

/**
 * Long enough to outlast the flight, short enough that the map is clear
 * again before the arrival animation starts. FLIGHT_MS is 400 (camera.ts),
 * 200 in cheap mode.
 */
const AFTER_THE_FLIGHT = 0.45

/**
 * How big the ring is, as a fraction of whatever the camera is showing.
 *
 * Multiplied by the zoom for the same reason `River` multiplies its stroke:
 * a marker is a thing drawn ON the map, not a place on it, so it should hold
 * its size on screen while the geography under it grows. 80 units against
 * the 1000-unit home view is 8% of the screen, at any zoom.
 */
const R = 80

/** `hold` is `zoomTo`'s own derived lifetime, in ms — `zoomTo` is an art
 *  verb precisely because it is what times this ring. Falls back to
 *  `HOLD.here` when none reached this cue. */
export function Here({ at, hold = HOLD.here }: { at: [number, number]; hold?: number }) {
  const zoom = useMapZoom()
  const still = useStill()
  const [cx, cy] = at
  const r = R * zoom

  return (
    <Layer hold={hold}>
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: AFTER_THE_FLIGHT, duration: 0.5 }}
      >
        {/* The breath. `r` is animated as an attribute rather than as a
            transform scale because an SVG child cannot own a compositor
            layer in WebKit's legacy engine either way — both are software
            repaints — and animating the radius needs no transform-origin to
            be right. Three breaths, not `repeat: Infinity`: it is on screen
            for six seconds and a permanent loop is a permanent tax. */}
        <motion.circle
          cx={cx}
          cy={cy}
          fill={C.peacock}
          fillOpacity={0.16}
          initial={{ r: r * 0.55 }}
          animate={{ r: still ? r : [r * 0.55, r * 1.15, r * 0.55] }}
          transition={{
            delay: AFTER_THE_FLIGHT,
            duration: 2.2,
            repeat: still ? 0 : 2,
            ease: 'easeInOut',
          }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r * 0.5}
          fill="none"
          stroke={C.peacock}
          strokeWidth={r * 0.09}
          strokeOpacity={0.75}
        />
        <circle cx={cx} cy={cy} r={r * 0.13} fill={C.peacock} />
      </motion.g>
    </Layer>
  )
}
