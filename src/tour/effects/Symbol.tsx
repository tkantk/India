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

/** Every entry takes the same `hold` prop `Symbol` is given, and falls back
 *  to its own constant when it is not, so this table stays uniform whether a
 *  cue carried a derived hold or not. */
type ArtProps = { hold?: number }
const ART: Record<string, (props: ArtProps) => ReactNode> = {
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

export function Symbol({ name, hold }: { name: string | undefined; hold?: number }) {
  const Art = name ? ART[name] : undefined
  return Art ? <Art hold={hold} /> : null
}
