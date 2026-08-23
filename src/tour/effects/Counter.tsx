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
import { subjectOf } from './subject'

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

  const { page, ink, accent } = subjectOf('countTo')

  return (
    <Reveal hold={hold}>
      <div className="cue-counter">
        {/* A round page, printed like every other one: a tinted ground (the
            `page` of `subject.ts`'s own `countTo` row), the app's one ink
            round the outside, and — because this page is a NUMBER and
            nothing else — a band in the subject's own `accent` inside the
            rule to carry the counting. Both rules are `non-scaling-stroke`,
            so they are the same weight on screen as the rule round the
            tiger's page rather than a second number scaled out of the same
            constant. */}
        <svg className="cue-counter__disc" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="56" fill={page} />
          <circle cx="60" cy="60" r="50" fill="none" stroke={accent} strokeWidth="5" />
          <circle
            cx="60"
            cy="60"
            r="56"
            fill="none"
            stroke={ink}
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="cue-counter__n">{n}</span>
      </div>
    </Reveal>
  )
}
