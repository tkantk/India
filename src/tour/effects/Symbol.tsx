/**
 * The eleven things the narrator can name.
 *
 * `revealSymbol` carries an authored string; `content/vocab.json` declares
 * which strings are allowed, and `Symbol.test.tsx` walks that list and
 * insists each one draws something. An argument nobody drew art for renders
 * nothing at all, rather than throwing in the middle of a child's tour.
 */
import type { ReactNode } from 'react'
import { Tiger } from './art/Tiger'
import { Peacock } from './art/Peacock'
import { Lotus } from './art/Lotus'
import { Banyan } from './art/Banyan'
import { Mango } from './art/Mango'
import { Dune } from './art/Dune'
import { IndiaGate } from './art/IndiaGate'
import { Outline } from './art/Outline'
import { ArabianSea, BayOfBengal, IndianOcean } from './art/Sea'

const ART: Record<string, () => ReactNode> = {
  'arabian-sea': ArabianSea,
  banyan: Banyan,
  'bay-of-bengal': BayOfBengal,
  dune: Dune,
  'india-gate': IndiaGate,
  'indian-ocean': IndianOcean,
  lotus: Lotus,
  mango: Mango,
  outline: Outline,
  peacock: Peacock,
  tiger: Tiger,
}

export function Symbol({ name }: { name: string | undefined }) {
  const Art = name ? ART[name] : undefined
  return Art ? <Art /> : null
}
