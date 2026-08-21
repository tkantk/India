/**
 * "On the left of the map is the Arabian Sea. On the right is the Bay of
 * Bengal. And underneath them both is the Indian Ocean."
 *
 * Left, right and underneath are the information, so these are drawn in the
 * map's own coordinates and land on the actual water — the empty paper the
 * child can see round the coast — rather than on a card in the middle. The
 * name is written on the water the way it is on a real map, and the waves are
 * what a six-year-old reads before the letters.
 */
import { motion } from 'motion/react'
import { EASE_OUT, HOLD, Layer, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

type Water = {
  lines: [string, string]
  /** Where the name sits, in viewBox units, and how far the water spreads
   *  round it. Every one of these clears the coastlines either side of it and
   *  stays inside the 1000x1100 viewBox — check them against the bboxes in
   *  src/data/geo.json before moving one. */
  x: number
  y: number
  rx: number
  ry: number
  /** The three rows of waves, as offsets from the name. */
  waves: [number, number, number]
}

const WATERS: Record<string, Water> = {
  // West of Maharashtra and Goa, whose coast is at x≈165 this far south.
  'arabian-sea': { lines: ['Arabian', 'Sea'], x: 102, y: 672, rx: 96, ry: 200, waves: [82, 130, 178] },
  // Between Odisha's coast (x≈672) and the Andamans (x≈865).
  'bay-of-bengal': { lines: ['Bay of', 'Bengal'], x: 775, y: 664, rx: 100, ry: 200, waves: [82, 130, 178] },
  // Under the whole peninsula, and above the bottom of the map.
  'indian-ocean': { lines: ['Indian', 'Ocean'], x: 612, y: 918, rx: 170, ry: 110, waves: [72, 112, 152] },
}

/** A row of waves: one hump, then alternating reflections of it. */
function wave(cx: number, cy: number, width: number): string {
  const step = width / 4
  return `M${cx - width / 2},${cy} q${step / 2},-13 ${step},0 t${step},0 t${step},0 t${step},0`
}

function Sea({ water }: { water: Water }) {
  const still = useStill()
  const { x, y, rx, ry, lines, waves } = water
  const rows = waves.map((dy) => y + dy)
  return (
    <Layer hold={HOLD.sea}>
      <ellipse cx={x} cy={y + 52} rx={rx} ry={ry} fill={C.sea} opacity="0.13" />
      <motion.g
        initial={still ? false : { y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <text x={x} y={y} fontSize="46" textAnchor="middle" fill={C.deep}>{lines[0]}</text>
        <text x={x} y={y + 50} fontSize="46" textAnchor="middle" fill={C.deep}>{lines[1]}</text>
      </motion.g>
      <g fill="none" stroke={C.sea} strokeWidth="8" strokeLinecap="round">
        {rows.map((cy, i) => (
          <motion.path
            key={cy}
            d={wave(x, cy, i === 1 ? 148 : 112)}
            initial={still ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, delay: 0.15 + i * 0.09, ease: EASE_OUT }}
          />
        ))}
      </g>
    </Layer>
  )
}

export const ArabianSea = () => <Sea water={WATERS['arabian-sea']} />
export const BayOfBengal = () => <Sea water={WATERS['bay-of-bengal']} />
export const IndianOcean = () => <Sea water={WATERS['indian-ocean']} />
