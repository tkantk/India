/**
 * Rajasthan: "Much of it is desert... Most of this one is sand."
 *
 * Sand alone is a beige rectangle. A camel on the ridge is a desert, and the
 * camel is the animal the very next card in Rajasthan talks about.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

export function Dune() {
  const still = useStill()
  return (
    <Card>
      {/* the sun that beats down all day */}
      <circle cx="93" cy="26" r="11" fill={C.gold} />

      {/* three dunes, palest furthest away */}
      <path d="M0,70 C18,56 36,58 54,66 C72,74 90,62 120,56 L120,120 L0,120 Z" fill={C.sand} />
      <path d="M0,92 C22,76 44,82 62,90 C80,98 100,88 120,82 L120,120 L0,120 Z" fill={C.sandDeep} />
      <path d="M0,108 C26,98 48,102 72,108 C90,112 106,108 120,104 L120,120 L0,120 Z" fill={C.sandShade} />
      {/* the wind-blown crest of the near dune */}
      <path
        d="M0,106 C26,96 48,100 72,106"
        fill="none"
        stroke={C.sand}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.8"
      />

      {/* the camel. One hump, a long neck and a small head: without those
          three it is a dog. */}
      <motion.g
        initial={still ? false : { x: -16, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.55, delay: 0.2, ease: EASE_OUT }}
      >
        {/* body and the one hump — a dromedary, which is the camel Rajasthan
            actually has */}
        <path
          d="M32,79 C32,74 36,72 41,72 C42,60 49,54 55,54 C61,54 65,60 65,72
             C69,73 71,76 71,79 C71,83 68,85 64,85 L40,85 C35,85 32,83 32,79 Z"
          fill={C.ink}
        />
        {/* long legs. Short ones make a dog of him. */}
        <g stroke={C.ink} strokeWidth="3.2" strokeLinecap="round" fill="none">
          <path d="M38,83 L34,101" />
          <path d="M45,83 L46,101" />
          <path d="M61,83 L60,102" />
          <path d="M67,83 L71,102" />
        </g>
        {/* neck, head, ear */}
        <path d="M68,76 C75,72 79,64 80,54" fill="none" stroke={C.ink} strokeWidth="4.6" strokeLinecap="round" />
        <path d="M78,53 C78,47 83,44 88,46 C92,48 97,50 96,53 C95,56 89,55 84,57 Z" fill={C.ink} />
        <path d="M78,49 L77,43 L82,47 Z" fill={C.ink} />
        {/* tail, with the tuft on the end */}
        <path d="M33,73 C29,75 28,80 30,85" fill="none" stroke={C.ink} strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="30" cy="86" r="2" fill={C.ink} />
      </motion.g>
    </Card>
  )
}
