/**
 * "Our tree is the banyan, which drops roots that hang down like ropes."
 *
 * The ropes are the whole point, so they are the thing that moves: the tree
 * arrives, and then the aerial roots grow downwards out of the canopy.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

/** Each rope starts under the canopy and hangs. Two of them reach the ground,
 *  which is how a banyan ends up standing on a dozen trunks. */
const ROPES = [
  { d: 'M20,54 C18,68 21,80 19,94' },
  { d: 'M32,58 C34,72 31,86 33,106', foot: 33 },
  { d: 'M44,57 C42,70 45,82 43,92' },
  { d: 'M78,57 C80,70 77,82 79,90' },
  { d: 'M90,58 C88,74 91,88 89,106', foot: 89 },
  { d: 'M102,54 C104,66 101,78 103,92' },
] as { d: string; foot?: number }[]

export function Banyan({ hold }: { hold?: number } = {}) {
  const still = useStill()
  return (
    <Card hold={hold} subject="banyan">
      {/* the ground it has stood on for two hundred years */}
      <ellipse cx="60" cy="108" rx="48" ry="6" fill={C.sand} />

      {/* canopy: a dark layer behind, a lighter one in front */}
      {/* a canopy with lumps in it: a flat green oval is a lollipop, not a
          two-hundred-year-old tree */}
      <path
        d="M11,42 C11,30 20,22 31,21 C34,13 44,9 52,13 C58,7 70,7 76,14
           C88,12 99,19 101,29 C110,33 113,44 108,51 C103,58 92,59 82,59
           L36,59 C22,59 11,53 11,42 Z"
        fill={C.leafDeep}
      />
      <path
        d="M22,42 C20,32 28,25 37,25 C41,19 50,17 56,21 C63,16 73,18 77,25
           C87,25 94,32 92,41 C97,46 95,54 86,55 L38,55 C26,55 23,50 22,42 Z"
        fill={C.leaf}
      />

      {/* trunk, with the flared foot of an old tree */}
      <path d="M52,50 L52,98 C52,103 47,105 43,108 L77,108 C73,105 68,103 68,98 L68,50 Z" fill={C.bark} />

      {ROPES.map((rope, i) => (
        <g key={rope.d}>
          <motion.path
            d={rope.d}
            fill="none"
            stroke={C.bark}
            strokeWidth="2.8"
            strokeLinecap="round"
            initial={still ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, delay: 0.15 + i * 0.06, ease: EASE_OUT }}
          />
          {/* where a rope has reached the ground it has become a trunk. */}
          {rope.foot !== undefined && (
            <ellipse cx={rope.foot} cy="108" rx="3.6" ry="2.4" fill={C.bark} />
          )}
        </g>
      ))}
    </Card>
  )
}
