/**
 * "This is our flag... In the white part there is a blue wheel with
 * twenty-four spokes. Count them with me."
 *
 * So there are twenty-four spokes, and a test counts them. The three colours
 * are the flag's own — this is the one place in the app where the palette
 * does not get a vote.
 *
 * It paints itself on: saffron, then white, then green, each band wiping out
 * from the pole, and then the Ashoka Chakra turns into place.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT, HOLD } from './Reveal'
import { PALETTE as C } from './art/palette'

const LEFT = 20
const RIGHT = 172
const TOP = 12
const BAND = (113 - TOP) / 3

const BANDS = [
  { fill: C.flagSaffron, y: TOP },
  { fill: C.snow, y: TOP + BAND },
  { fill: C.flagGreen, y: TOP + BAND * 2 },
]

const HUB = { x: (LEFT + RIGHT) / 2, y: TOP + BAND * 1.5 }
const SPOKES = Array.from({ length: 24 }, (_, i) => {
  const a = (i * Math.PI * 2) / 24
  return {
    x1: HUB.x + Math.sin(a) * 3.5,
    y1: HUB.y - Math.cos(a) * 3.5,
    x2: HUB.x + Math.sin(a) * 13.4,
    y2: HUB.y - Math.cos(a) * 13.4,
  }
})

/** `hold` is the cue's derived lifetime, in ms; falls back to `HOLD.flag`
 *  when none reached this cue (a single-effect test, or the draft-voice
 *  pipeline). */
export function Flag({ hold = HOLD.flag }: { hold?: number } = {}) {
  // THE ONE REVEAL THAT STAYS ON PLAIN PAPER. Every other page is tinted so
  // a drawing has a ground that is not its own family (see `TONES` in
  // Reveal.tsx) — but the middle band of the flag IS white, and a white band
  // on a coloured page stops being white. The tricolour outranks the set.
  return (
    <Card viewBox="0 0 180 120" hold={hold} tone="paper">
      {/* the pole. Without it this is a striped rectangle. */}
      <rect x="12" y="6" width="6" height="110" rx="3" fill={C.bark} />

      {BANDS.map((band, i) => (
        <motion.rect
          key={band.fill}
          x={LEFT}
          y={band.y}
          width={RIGHT - LEFT}
          height={BAND}
          fill={band.fill}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.45, delay: i * 0.09, ease: EASE_OUT }}
          style={{ originX: 0 }}
        />
      ))}

      <motion.g
        initial={{ rotate: -150, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.35, ease: EASE_OUT }}
      >
        <circle cx={HUB.x} cy={HUB.y} r="14.4" fill="none" stroke={C.flagNavy} strokeWidth="1.8" />
        <circle cx={HUB.x} cy={HUB.y} r="3.4" fill={C.flagNavy} />
        <g stroke={C.flagNavy} strokeWidth="1.1" strokeLinecap="round">
          {SPOKES.map((s) => (
            <line key={`${s.x2},${s.y2}`} className="chakra-spoke" {...s} />
          ))}
        </g>
      </motion.g>
    </Card>
  )
}
