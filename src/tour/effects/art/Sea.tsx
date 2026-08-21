/**
 * "Water touches India on three sides. On the left of the map is the Arabian
 * Sea. On the right is the Bay of Bengal. And underneath them both is the
 * Indian Ocean."
 *
 * Two things that sentence decides.
 *
 * NO WRITING. This beat teaches POSITION — left, right, underneath — to a
 * child who cannot yet read fluently, which is the one audience assumption
 * the whole site rests on. The narrator says the names; the art says where.
 * So each sea is a body of water on the real paper the child can see round
 * the coast, with waves moving on it, and not a caption.
 *
 * ALL THREE STAY. "Three sides" is the picture, and nobody sees three of
 * anything if each reveal wipes out the last. The three cues arrive seven
 * words apart into one overlay slot, so `overlays.tsx` gives them a stable
 * key — one mounted instance across all three — exactly as it does for the
 * three greetings. The one being named comes forward; the other two sit back
 * rather than leaving.
 *
 * Every body is checked against the real coastline: sampled across each
 * ellipse, not one point of it touches any of the 36 states, the islands, or
 * the edge of the viewBox. `overlays.test.tsx` keeps them on their own side
 * of the country.
 */
import { motion } from 'motion/react'
import { isCheap } from '../../../lib/cheapMode'
import { EASE_OUT, HOLD, Layer, useMapZoom, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

export type Water = {
  id: string
  /** The middle of the water, in the map's own viewBox units. */
  cx: number
  cy: number
  rx: number
  ry: number
}

/** The order the tour names them in, and the order they are painted in. */
export const WATERS: Water[] = [
  // West of Gujarat's southern coast and of the whole Konkan, clear of the
  // Kachchh peninsula, which reaches out to x≈20 further north.
  { id: 'arabian-sea', cx: 82, cy: 780, rx: 72, ry: 155 },
  // Off Odisha and Andhra, inside the Andamans, below the Hooghly mouth.
  { id: 'bay-of-bengal', cx: 780, cy: 740, rx: 95, ry: 175 },
  // Below both of them. There is no room directly under the southern tip —
  // it reaches y≈1075 of an 1100-unit map — so the widest water of the three
  // lies south-east of it, where the open paper is.
  { id: 'indian-ocean', cx: 620, cy: 1000, rx: 195, ry: 78 },
]

/** Where the rows of waves sit, as a fraction of the body's half-height. */
const ROWS = [-0.68, -0.34, 0, 0.34, 0.68]

/** How far a row drifts sideways, in viewBox units at the home view. Small:
 *  this is water breathing, not a wave machine. */
const DRIFT = 7

/** A row of waves: one hump, then alternating reflections of it. */
function wave(cx: number, cy: number, width: number): string {
  const step = width / 4
  const lift = -step * 0.34
  return `M${cx - width / 2},${cy} q${step / 2},${lift} ${step},0 t${step},0 t${step},0 t${step},0`
}

/** The rows across one body, narrowing towards its ends — a chord of the
 *  ellipse, so the waves describe the shape of the water they are on. */
function rows(w: Water) {
  return ROWS.map((t) => ({
    y: w.cy + t * w.ry,
    width: 2 * w.rx * Math.sqrt(1 - t * t) * 0.74,
  }))
}

function Body({ water, now, zoom }: { water: Water; now: boolean; zoom: number }) {
  const still = useStill()
  /** Water that never moves is a puddle. But this is the only animation in
   *  the tour that runs for the whole hold rather than landing and stopping,
   *  and every frame of it is a software repaint on WebKit's legacy SVG
   *  engine — so a slow iPad gets still water, drawn whole. */
  const moving = !still && !isCheap()
  const drift = DRIFT * zoom

  return (
    <motion.g
      className={now ? 'cue-water is-now' : 'cue-water'}
      data-sea={water.id}
      /* Arriving gently, and never leaving: the two that are not being named
         fall back rather than going away. */
      initial={still ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: now ? 1 : 0.5, y: 0 }}
      transition={{ duration: 0.55, ease: EASE_OUT }}
    >
      {/* Two overlapping bodies rather than one flat fill: the middle of the
          water is deeper than its edge, which is the whole of what makes a
          blue shape read as a sea instead of a sticker. */}
      <ellipse cx={water.cx} cy={water.cy} rx={water.rx} ry={water.ry} fill={C.seaPale} opacity="0.5" />
      <ellipse
        cx={water.cx}
        cy={water.cy}
        rx={water.rx * 0.78}
        ry={water.ry * 0.82}
        fill={C.seaPale}
        opacity="0.5"
      />
      <g fill="none" stroke={C.sea} strokeLinecap="round" strokeWidth={7 * zoom}>
        {rows(water).map((row, i) => (
          <motion.path
            key={row.y}
            d={wave(water.cx, row.y, row.width)}
            initial={still ? false : { pathLength: 0 }}
            animate={moving ? { pathLength: 1, x: [0, drift, 0, -drift, 0] } : { pathLength: 1 }}
            transition={{
              pathLength: { duration: 0.5, delay: 0.12 + i * 0.07, ease: EASE_OUT },
              // Each row on its own clock, or five rows slide as one board.
              x: { duration: 5.4 + i * 0.6, repeat: Infinity, ease: 'easeInOut' },
            }}
          />
        ))}
      </g>
    </motion.g>
  )
}

/**
 * The three waters, with the one being named brought forward.
 *
 * `nonce` changes on every cue and does the same job it does for the
 * greetings card: this component deliberately does NOT remount between the
 * three seas — that is what lets them accumulate — so it is what tells the
 * layer it is wanted again and restarts its hold.
 */
export function Seas({ named, nonce }: { named?: string; nonce?: string }) {
  const zoom = useMapZoom()
  return (
    <Layer hold={HOLD.sea} restartOn={`${named ?? ''}:${nonce ?? ''}`}>
      {WATERS.map((water) => (
        <Body key={water.id} water={water} now={water.id === named} zoom={zoom} />
      ))}
    </Layer>
  )
}

/** For `Symbol`, which maps a bare vocabulary name to art. The tour reaches
 *  these through `overlays.tsx` instead, so that the three share one slot. */
export const ArabianSea = () => <Seas named="arabian-sea" />
export const BayOfBengal = () => <Seas named="bay-of-bengal" />
export const IndianOcean = () => <Seas named="indian-ocean" />
