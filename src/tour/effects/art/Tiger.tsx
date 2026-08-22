/**
 * "Our national animal is the tiger... He is orange with black stripes."
 *
 * A face, not a body: at the size this lands on the map, a whole tiger is an
 * orange smudge, and it is the stripes and the eyes a child recognises.
 */
import { motion } from 'motion/react'
import { Card, EASE_OUT, useStill } from '../Reveal'
import { PALETTE as C } from './palette'

/** Forehead first, then the cheeks, outwards from the middle. */
const STRIPES = [
  'M60,29 C59,35 60,39 60,45',
  'M47,31 C48,37 50,41 52,46',
  'M73,31 C72,37 70,41 68,46',
  'M24,53 C29,55 33,56 38,56',
  'M22,64 C27,66 32,67 37,67',
  'M25,75 C30,76 34,77 39,78',
  'M96,53 C91,55 87,56 82,56',
  'M98,64 C93,66 88,67 83,67',
  'M95,75 C90,76 86,77 81,78',
]

export function Tiger() {
  const still = useStill()
  return (
    <Card>
      {/* ears */}
      <circle cx="30" cy="36" r="14" fill={C.saffron} />
      <circle cx="90" cy="36" r="14" fill={C.saffron} />
      <circle cx="30" cy="37" r="7" fill={C.rosePale} />
      <circle cx="90" cy="37" r="7" fill={C.rosePale} />

      {/* head */}
      <path
        d="M60,25 C83,25 99,42 99,62 C99,75 92,86 83,92 C75,98 68,101 60,101 C52,101 45,98 37,92 C28,86 21,75 21,62 C21,42 37,25 60,25 Z"
        fill={C.saffron}
      />
      {/* the pale mask a tiger has round its eyes and muzzle */}
      <ellipse cx="60" cy="83" rx="20" ry="14" fill={C.paper} />
      <circle cx="49" cy="79" r="12" fill={C.paper} />
      <circle cx="71" cy="79" r="12" fill={C.paper} />

      {/* eyes */}
      <ellipse cx="44" cy="57" rx="5.4" ry="6.2" fill={C.ink} />
      <ellipse cx="76" cy="57" rx="5.4" ry="6.2" fill={C.ink} />
      <circle cx="42.2" cy="55" r="1.8" fill={C.snow} />
      <circle cx="74.2" cy="55" r="1.8" fill={C.snow} />

      {/* nose and mouth */}
      <path d="M53,69 L67,69 C67,76 62.5,80 60,80 C57.5,80 53,76 53,69 Z" fill={C.rose} />
      <path
        d="M60,80 C60,85 56,88 51,87 M60,80 C60,85 64,88 69,87"
        fill="none"
        stroke={C.ink}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* whiskers */}
      <path
        d="M43,78 L20,73 M43,83 L19,84 M77,78 L100,73 M77,83 L101,84"
        fill="none"
        stroke={C.ink}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.75"
      />

      {/* stripes, painted on from the middle outwards */}
      <g fill="none" stroke={C.ink} strokeWidth="4.2" strokeLinecap="round">
        {STRIPES.map((d, i) => (
          <motion.path
            key={d}
            d={d}
            initial={still ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.28, delay: 0.12 + i * 0.035, ease: EASE_OUT }}
          />
        ))}
      </g>
    </Card>
  )
}
