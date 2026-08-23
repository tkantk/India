/**
 * "Our fruit is the mango."
 *
 * One mango, close up, the way it is handed to you: gold, with the red cheek
 * it gets from the sun, a green shoulder by the stalk, and two leaves.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

export function Mango({ hold }: { hold?: number } = {}) {
  const still = useStill()
  return (
    <Card hold={hold} tone="teal">
      {/* stalk and leaves */}
      <path d="M60,30 C60,22 59,17 57,12" fill="none" stroke={C.bark} strokeWidth="3" strokeLinecap="round" />
      <motion.g
        initial={still ? false : { rotate: -14, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.45, delay: 0.15, ease: EASE_OUT }}
        style={{ originX: 0, originY: 1 }}
      >
        <path d="M58,14 C68,4 84,4 92,10 C82,20 66,22 58,14 Z" fill={C.leaf} />
        <path d="M60,14 C70,12 82,10 90,10" fill="none" stroke={C.leafDeep} strokeWidth="1.4" strokeLinecap="round" />
      </motion.g>

      {/* the fruit: fat shoulder top-right, the beak low on the left */}
      <path
        d="M62,26 C86,26 103,45 101,68 C99,90 80,105 58,105 C40,105 25,96 20,82
           C18,76 21,72 26,72 C34,71 39,64 41,53 C44,36 50,26 62,26 Z"
        fill={C.mango}
      />
      {/* the sunny cheek */}
      <path
        d="M70,28 C88,32 100,48 99,66 C98,80 90,92 78,99 C92,84 96,52 70,28 Z"
        fill={C.saffron}
      />
      {/* green by the stalk, where it ripened last */}
      <path d="M62,26 C52,27 46,33 43,44 C51,34 57,29 66,27 Z" fill={C.leafDeep} />
      {/* one soft highlight, so it reads as round rather than flat */}
      <ellipse cx="47" cy="58" rx="7" ry="12" transform="rotate(-24 47 58)" fill={C.paper} opacity="0.45" />
    </Card>
  )
}
