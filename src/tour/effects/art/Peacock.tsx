/**
 * "Our national bird is the peacock, and that is me. In the rainy season I
 * open my tail into a huge blue and green fan."
 *
 * So the fan OPENS. Every feather is drawn straight up from one pivot and
 * then rotated out to its place, which is the one arrangement where the whole
 * tail can swing open from a closed bundle: `originY: 1` is the bottom of
 * each feather's own fill-box, and the bottom of a feather drawn from the
 * pivot IS the pivot. Under reduced motion Motion jumps each rotation
 * straight to its target, so the fan is simply already open.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT } from '../Reveal'
import { PALETTE as C } from './palette'

const PIVOT_X = 60
const PIVOT_Y = 106
const COUNT = 9
const SPREAD = 75

const feathers = Array.from({ length: COUNT }, (_, i) => {
  const angle = -SPREAD + (i * (SPREAD * 2)) / (COUNT - 1)
  // Longest in the middle, so it is a fan and not a comb.
  const length = 48 + 14 * Math.cos((angle * Math.PI) / 180)
  return { angle, tip: PIVOT_Y - length }
})

export function Peacock() {
  return (
    <Card>
      {feathers.map((f, i) => (
        <motion.g
          key={f.angle}
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: f.angle, opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.05 + Math.abs(i - (COUNT - 1) / 2) * 0.02, ease: EASE_OUT }}
          style={{ originX: 0.5, originY: 1 }}
        >
          <line
            x1={PIVOT_X}
            y1={PIVOT_Y}
            x2={PIVOT_X}
            y2={f.tip}
            stroke={C.peacockTeal}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          {/* the eye on the tip: gold ring, blue iris, dark middle */}
          <circle cx={PIVOT_X} cy={f.tip} r="8" fill={C.gold} />
          <circle cx={PIVOT_X} cy={f.tip} r="5.2" fill={C.peacock} />
          <circle cx={PIVOT_X} cy={f.tip} r="2.4" fill={C.deep} />
        </motion.g>
      ))}

      {/* the bird himself, in front of his own tail. The long S of the neck
          is what stops a blue oval reading as a beetle. */}
      <ellipse cx="58" cy="100" rx="10" ry="11" fill={C.peacock} />
      <path
        d="M60,98 C64,90 63,80 59,72"
        fill="none"
        stroke={C.peacock}
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <circle cx="58" cy="68" r="7" fill={C.peacock} />
      <circle cx="61" cy="66.5" r="1.8" fill={C.snow} />
      <path d="M64,68.5 L74,70.5 L64,73 Z" fill={C.gold} />
      {/* the crest: three little pins with a bead on each */}
      <g stroke={C.peacock} strokeWidth="1.5" strokeLinecap="round" fill="none">
        <path d="M54,62 C53,58 52,56 51,54" />
        <path d="M58,61 C58,57 58,55 58,52" />
        <path d="M62,62 C63,58 64,56 65,54" />
      </g>
      <circle cx="51" cy="53" r="2.2" fill={C.peacockTeal} />
      <circle cx="58" cy="51" r="2.2" fill={C.peacockTeal} />
      <circle cx="65" cy="53" r="2.2" fill={C.peacockTeal} />
    </Card>
  )
}
