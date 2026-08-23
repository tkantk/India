/**
 * "It starts in the mud at the bottom of a pond and pushes all the way up
 * into the sunshine."
 *
 * So the picture is the whole journey, bottom to top: mud, water, stem,
 * flower, sun — and the flower opens last.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

/** One petal, drawn from the flower's middle and pointing straight up. */
const PETAL = 'M0,0 C-8,-13 -6,-25 0,-33 C6,-25 8,-13 0,0 Z'
const OUTER = [-72, -40, 0, 40, 72]
const INNER = [-26, 0, 26]
const HEART = { x: 60, y: 62 }

export function Lotus({ hold }: { hold?: number } = {}) {
  const still = useStill()
  /* The placing is a plain <g transform>, and only what is INSIDE it moves.
     Motion writes `style.transform`, which is the same CSS property the SVG
     `transform` attribute sets — animating a petal that placed itself with
     the attribute would throw the placement away on the first frame. */
  const petal = (angle: number, scale: number, fill: string, i: number) => (
    <g key={`${fill}${angle}`} transform={`translate(${HEART.x} ${HEART.y}) rotate(${angle}) scale(${scale})`}>
      <motion.path
        d={PETAL}
        fill={fill}
        initial={still ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.18 + i * 0.05, ease: EASE_OUT }}
      />
    </g>
  )

  return (
    <Card hold={hold} subject="lotus">
      {/* the sunshine it is pushing up into */}
      <circle cx="97" cy="22" r="10" fill={C.gold} />
      <g stroke={C.gold} strokeWidth="2.6" strokeLinecap="round">
        <path d="M97,6 L97,1" />
        <path d="M112,22 L118,22" />
        <path d="M108,11 L112,7" />
      </g>

      {/* the pond, and the mud at the bottom of it */}
      <path
        d="M0,84 C16,79 27,86 41,84 C55,82 68,89 82,85 C95,81 108,87 120,84 L120,120 L0,120 Z"
        fill={C.seaPale}
      />
      <path
        d="M0,106 C18,101 34,107 52,105 C72,103 92,108 120,104 L120,120 L0,120 Z"
        fill={C.bark}
      />
      {/* lily pads */}
      <path d="M14,88 A15,6 0 1 1 42,88 L34,88 L30,84 L26,88 Z" fill={C.leaf} />
      <ellipse cx="98" cy="91" rx="11" ry="4.5" fill={C.leafDeep} />

      {/* the stem, straight up out of the mud */}
      <path
        d="M60,110 C56,98 63,84 60,68"
        fill="none"
        stroke={C.leaf}
        strokeWidth="3.6"
        strokeLinecap="round"
      />

      {OUTER.map((a, i) => petal(a, 1, C.rosePale, i))}
      {INNER.map((a, i) => petal(a, 0.72, C.rose, i + OUTER.length))}
      <circle cx={HEART.x} cy={HEART.y - 4} r="6" fill={C.gold} />
      <circle cx={HEART.x - 2.5} cy={HEART.y - 5.5} r="1.2" fill={C.leafDeep} />
      <circle cx={HEART.x + 2.5} cy={HEART.y - 5.5} r="1.2" fill={C.leafDeep} />
      <circle cx={HEART.x} cy={HEART.y - 2} r="1.2" fill={C.leafDeep} />
    </Card>
  )
}
