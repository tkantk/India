/**
 * "India is made of twenty-eight states." — and then twenty-eight of them
 * light up while a number counts to it.
 *
 * The number is the information and the ticking is decoration, so a child who
 * has asked for less motion gets the number immediately. The count never
 * passes the target on the way up: a child counting along with the narrator
 * would hear "twenty-eight" and see 29.
 */
import { useEffect, useState } from 'react'
import { animate } from 'motion/react'
import { HOLD, Reveal, useStill } from './Reveal'
import { PALETTE as C } from './art/palette'

type Props = {
  to: number
  /** Roughly forty a second, so 28 lands in about the time it takes to say
   *  "twenty-eight states". */
  durationMs?: number
  /** How long the disc stays up, in ms. Derived from the cue (see
   *  `Cue.hold`); falls back to `HOLD.counter` when no derived hold reached
   *  this cue — a single-effect test, or the draft-voice pipeline. */
  hold?: number
}

export function Counter({ to, durationMs = 1300, hold = HOLD.counter }: Props) {
  const still = useStill()
  const target = Math.round(to)
  // The argument comes off authored content as a string. cues.ts guarantees
  // nothing about it, and NaN on stage is worse than no counter at all.
  const countable = Number.isFinite(target) && target > 0
  const [n, setN] = useState(() => (still || !countable ? target : 1))

  useEffect(() => {
    if (!countable) return
    if (still) {
      setN(target)
      return
    }
    setN(1)
    const run = animate(1, target, {
      duration: durationMs / 1000,
      ease: 'easeOut',
      onUpdate: (v) => setN(Math.min(target, Math.round(v))),
      onComplete: () => setN(target),
    })
    return () => run.stop()
  }, [target, durationMs, still, countable])

  if (!countable) return null

  return (
    <Reveal hold={hold}>
      <div className="cue-counter">
        <svg className="cue-counter__disc" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="56" fill={C.paper} />
          <circle cx="60" cy="60" r="56" fill="none" stroke={C.saffron} strokeWidth="5" />
        </svg>
        <span className="cue-counter__n">{n}</span>
      </div>
    </Reveal>
  )
}
