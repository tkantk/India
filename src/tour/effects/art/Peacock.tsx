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
 *
 * THE PIECES ARE EXPORTED because Mor — the guide in the corner, src/tour/Mor.tsx
 * — is this bird, not a second one drawn to look like him. The narration says
 * "that is me" over this very reveal, so a child has to recognise the two as
 * one peacock. Sharing the drawing is the only thing that actually guarantees
 * it: they differ in what they do with the same feathers, never in how the
 * feathers are made. `Mor.test.tsx` compares the two shape for shape.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Card, EASE_OUT } from '../Reveal'
import { PALETTE as C } from './palette'

/** Where the tail swings from, and where the bird sits on top of it. */
export const PIVOT = { x: 60, y: 106 } as const
/** How far the fully open fan reaches either side of upright, in degrees. */
export const FAN = 75
const COUNT = 9

/** The open fan: one entry per feather, in left-to-right order. `tip` is the
 *  y of its far end while it is still drawn straight up from the pivot. */
export const FEATHERS = Array.from({ length: COUNT }, (_, i) => {
  const angle = -FAN + (i * (FAN * 2)) / (COUNT - 1)
  // Longest in the middle, so it is a fan and not a comb.
  const length = 48 + 14 * Math.cos((angle * Math.PI) / 180)
  return { angle, tip: PIVOT.y - length }
})

/**
 * One feather, drawn straight UP from the pivot and never at its own angle:
 * a group around this has its fill-box bottom-centre exactly on the pivot,
 * so `originX: 0.5, originY: 1` rotates AND scales it about the pivot. That
 * is what lets the same feather swing open here and fold away for Mor.
 */
export function Feather({ tip }: { tip: number }) {
  return (
    <>
      <line
        x1={PIVOT.x}
        y1={PIVOT.y}
        x2={PIVOT.x}
        y2={tip}
        stroke={C.peacockTeal}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* the eye on the tip: gold ring, blue iris, dark middle */}
      <circle cx={PIVOT.x} cy={tip} r="8" fill={C.gold} />
      <circle cx={PIVOT.x} cy={tip} r="5.2" fill={C.peacock} />
      <circle cx={PIVOT.x} cy={tip} r="2.4" fill={C.deep} />
    </>
  )
}

/** The white dot on the blue head. Mor replaces it with one that blinks; the
 *  shape and the paint have to stay identical, so both take them from here. */
export const EYE = { x: 61, y: 66.5, r: 1.8 } as const

/**
 * The bird himself, in front of his own tail. The long S of the neck is what
 * stops a blue oval reading as a beetle.
 */
export function PeacockBody({ eye }: { eye?: ReactNode }) {
  return (
    <>
      <ellipse cx="58" cy="100" rx="10" ry="11" fill={C.peacock} />
      <path
        d="M60,98 C64,90 63,80 59,72"
        fill="none"
        stroke={C.peacock}
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <circle cx="58" cy="68" r="7" fill={C.peacock} />
      {eye ?? <circle cx={EYE.x} cy={EYE.y} r={EYE.r} fill={C.snow} />}
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
    </>
  )
}

export function Peacock({ hold }: { hold?: number } = {}) {
  return (
    <Card hold={hold}>
      {FEATHERS.map((f, i) => (
        <motion.g
          key={f.angle}
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: f.angle, opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.05 + Math.abs(i - (COUNT - 1) / 2) * 0.02, ease: EASE_OUT }}
          style={{ originX: 0.5, originY: 1 }}
        >
          <Feather tip={f.tip} />
        </motion.g>
      ))}
      <PeacockBody />
    </Card>
  )
}
