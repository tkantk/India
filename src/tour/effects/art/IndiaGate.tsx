/**
 * "Look down. That big stone arch is called India Gate."
 *
 * Big is the word doing the work, and a drawing has no scale of its own — so
 * there are two people standing at the foot of it.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

function Person({ x }: { x: number }) {
  return (
    <g fill={C.ink}>
      <circle cx={x} cy="97" r="2.2" />
      <path d={`M${x - 2.4},100 L${x + 2.4},100 L${x + 1.6},109 L${x - 1.6},109 Z`} />
    </g>
  )
}

export function IndiaGate({ hold }: { hold?: number } = {}) {
  const still = useStill()
  return (
    <Card hold={hold} tone="sun">
      {/* the lawns all round it */}
      <path d="M0,102 C30,97 90,97 120,102 L120,120 L0,120 Z" fill={C.leaf} />

      <motion.g
        initial={still ? false : { y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        {/* plinth, piers, cornice, attic, and the shallow bowl on top */}
        <rect x="16" y="98" width="88" height="8" fill={C.stoneDeep} />
        <rect x="26" y="30" width="68" height="68" fill={C.stone} />
        <rect x="20" y="20" width="80" height="10" fill={C.stoneDeep} />
        <rect x="36" y="10" width="48" height="10" fill={C.stone} />
        <ellipse cx="60" cy="9" rx="8" ry="3.5" fill={C.stoneDeep} />

        {/* the way through: you can see the sky on the other side */}
        <path d="M47,98 L47,52 A13,13 0 0 1 73,52 L73,98 Z" fill={C.paper} />
        <path
          d="M47,98 L47,52 A13,13 0 0 1 73,52 L73,98"
          fill="none"
          stroke={C.stoneDeep}
          strokeWidth="1.6"
        />
        {/* the courses of stone */}
        <g stroke={C.stoneDeep} strokeWidth="1.2" opacity="0.7">
          <path d="M26,44 L47,44 M73,44 L94,44" />
          <path d="M26,66 L47,66 M73,66 L94,66" />
          <path d="M26,86 L47,86 M73,86 L94,86" />
        </g>
      </motion.g>

      <Person x={16} />
      <Person x={104} />
    </Card>
  )
}
