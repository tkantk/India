/**
 * The frame every tour effect arrives in.
 *
 * Two shapes of art: a FIGURE, which is a small drawing on a warm card in the
 * middle of the map (the tiger, the mango, the flag), and a LAYER, which is
 * drawn in the map's own viewBox and lands on the geography it belongs to
 * (the outline a child traces, the Ganga, the Himalaya, the three seas).
 *
 * Both SELF-DISMISS. Nothing clears the overlay slot: cues are driven by the
 * audio clock and the seam in `overlays.tsx` has no `onDone`, so an effect
 * that did not end itself would sit on the map for the rest of the tour.
 *
 * Motion notes that matter here:
 *  - `MotionConfig reducedMotion="user"` (App.tsx) already makes Motion drop
 *    the transform half of these animations by itself. Opacity stays, which
 *    is the intent: a child who asked for less motion still sees the tiger.
 *  - A LAYER never scales. It is registered against the map underneath it to
 *    the tenth of a viewBox unit, and a scale-in would slide the Ganga off
 *    its own valley for half a second.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotionConfig } from 'motion/react'
import geo from '../../data/geo.json'
import { PALETTE } from './art/palette'
import './effects.css'

/** How long each kind of art stays before it takes itself off, in ms.
 *  Tuned against the beats in content/tour.json: long enough to look at,
 *  short enough that the map is clear again before the next sentence needs
 *  it. Every one of them is cut short in practice by the next cue. */
export const HOLD = {
  symbol: 6000,
  sea: 7000,
  outline: 9000,
  river: 9000,
  mountains: 9000,
  script: 8000,
  counter: 5000,
  flag: 12000,
} as const

/** 500 ms in, gently. The brief's 400-600 ms, and no overshoot: a symbol that
 *  bounces reads as a notification, not a picture book. */
export const ENTER_S = 0.5
export const EASE_OUT = [0.22, 0.85, 0.3, 1] as const
const FADE_MS = 450

/** True when the child (or the test) has asked for no motion at all. Motion
 *  handles transforms and opacity itself; this is for the animations it
 *  cannot know about — a `pathLength` draw-on is an SVG attribute, not a
 *  transform, and would keep running. */
export function useStill(): boolean {
  return useReducedMotionConfig() === true
}

type RevealProps = {
  hold: number
  variant?: 'figure' | 'layer'
  /**
   * Change this and the effect starts its life again — back on stage if it had
   * already left, with a fresh hold.
   *
   * Most effects never need it: `overlays.tsx` gives each cue a key nobody has
   * used before, so a second `revealSymbol` is a new component with new state.
   * `Script` is the exception, because the three greetings arrive a second
   * apart and are meant to accumulate on one card rather than replace each
   * other, which means one component instance living across three cues.
   */
  restartOn?: string
  children: ReactNode
}

export function Reveal({ hold, variant = 'figure', restartOn, children }: RevealProps) {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    setLeaving(false)
    setGone(false)
    const fade = setTimeout(() => setLeaving(true), hold)
    const off = setTimeout(() => setGone(true), hold + FADE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(off)
    }
  }, [hold, restartOn])

  if (gone) return null

  const scaled = variant === 'figure'
  return (
    <motion.div
      className={scaled ? 'cue-figure' : 'cue-layer'}
      initial={{ opacity: 0, ...(scaled ? { scale: 0.88 } : null) }}
      animate={
        leaving
          ? { opacity: 0, ...(scaled ? { scale: 0.97 } : null) }
          : { opacity: 1, ...(scaled ? { scale: 1 } : null) }
      }
      transition={{ duration: leaving ? FADE_MS / 1000 : ENTER_S, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}

/** A drawing on a card, in the middle of the map. */
export function Card({
  viewBox = '0 0 120 120',
  hold = HOLD.symbol,
  restartOn,
  children,
}: {
  viewBox?: string
  hold?: number
  restartOn?: string
  children: ReactNode
}) {
  const [, , w, h] = viewBox.split(' ').map(Number)
  return (
    <Reveal hold={hold} restartOn={restartOn}>
      <svg className="cue-art" viewBox={viewBox} aria-hidden="true">
        {/* The card. Cream on the map's beige, so a flat drawing has
            something to be flat against. */}
        <rect x="0" y="0" width={w} height={h} rx={w / 12} fill={PALETTE.paper} />
        {children}
      </svg>
    </Reveal>
  )
}

/** Art drawn in the map's own coordinates, over the map. */
export function Layer({ hold, children }: { hold: number; children: ReactNode }) {
  return (
    <Reveal hold={hold} variant="layer">
      <svg className="cue-map" viewBox={geo.viewBox.join(' ')} aria-hidden="true">
        {children}
      </svg>
    </Reveal>
  )
}
