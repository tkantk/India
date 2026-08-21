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
import type { Bbox } from '../../types'
import { useCameraView } from '../../map/useCameraView'
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
  /** The "look down" ring at the end of a flight. Tuned to beat 5: the cue
   *  fires at 5.72s and India Gate rises at 11.86s, so the ring finishes
   *  fading exactly as the Gate arrives on the same spot. */
  here: 5600,
} as const

/** 500 ms in, gently. The brief's 400-600 ms, and no overshoot: a symbol that
 *  bounces reads as a notification, not a picture book. */
export const ENTER_S = 0.5
export const EASE_OUT = [0.22, 0.85, 0.3, 1] as const
/** How long an effect takes to fade back off stage once its hold is up.
 *  Exported because Mor's `showing` prop has to expire when the art it is
 *  presenting has actually gone, and the two must not drift apart. */
export const FADE_MS = 450

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
   * The two exceptions are the greetings card and the three seas, both of
   * which are meant to ACCUMULATE — cues a few words apart that belong in one
   * picture — so both live across several cues as one instance, and this is
   * what tells that instance it has been named again.
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
  children,
}: {
  viewBox?: string
  hold?: number
  children: ReactNode
}) {
  const [, , w, h] = viewBox.split(' ').map(Number)
  return (
    <Reveal hold={hold}>
      <svg className="cue-art" viewBox={viewBox} aria-hidden="true">
        {/* The card. Cream on the map's beige, so a flat drawing has
            something to be flat against. */}
        <rect x="0" y="0" width={w} height={h} rx={w / 12} fill={PALETTE.paper} />
        {children}
      </svg>
    </Reveal>
  )
}

/** The map's own rect — the one to draw against when there is no map to ask.
 *  That is the contact sheet, and any test that renders one effect alone. */
const HOME = geo.viewBox as Bbox

/**
 * Art drawn in the map's own coordinates, over the map.
 *
 * The viewBox is the camera's LIVE committed rect, not the static home one.
 * `.tour-overlay` is a sibling of `.map`, so the camera's commit — which
 * writes the new rect onto every `:scope > svg` of the stage — never reaches
 * this svg; without asking, a layer stays registered on wherever the map was
 * when the app started. `tour.json` zooms to Delhi at beat 5 and never comes
 * home, so by beat 10 that is the whole country against a view of Delhi: the
 * Ganga as a fat blue stub matching nothing underneath it.
 *
 * Asking makes the art correct at any camera position, rather than correct
 * as long as nobody adds a zoom to the content. See `camera.watch`.
 */
export function Layer({
  hold,
  restartOn,
  children,
}: {
  hold: number
  restartOn?: string
  children: ReactNode
}) {
  const view = useCameraView() ?? HOME
  return (
    <Reveal hold={hold} variant="layer" restartOn={restartOn}>
      <svg className="cue-map" viewBox={view.join(' ')} aria-hidden="true">
        {children}
      </svg>
    </Reveal>
  )
}

/**
 * How wide the camera's view is against the home view: 1 at home, 0.096 with
 * the camera on Delhi.
 *
 * A LINE drawn on the map — the outline a child traces, the Ganga — is a
 * line, not a place: it should keep its weight on screen while the geography
 * under it grows. Multiplying its stroke width by this does exactly what
 * `vector-effect: non-scaling-stroke` does for the state borders in map.css
 * ("the camera's 10.4x flight renders this 1.5-unit border at about 11 CSS
 * pixels"), and does it in geometry, so the art at home is unchanged to the
 * last decimal rather than being re-weighted by the browser.
 *
 * Filled geography is deliberately NOT scaled: a mountain and a body of
 * water are places, and a place grows with the map. Only the lines — the
 * outline, the river, the waves drawn on the water — hold their weight.
 */
export function useMapZoom(): number {
  const view = useCameraView()
  return view ? view[2] / HOME[2] : 1
}
