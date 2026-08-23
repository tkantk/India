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
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotionConfig } from 'motion/react'
import geo from '../../data/geo.json'
import type { Bbox } from '../../types'
import { useCameraView } from '../../map/useCameraView'
import { PALETTE } from './art/palette'
import './effects.css'

/**
 * How a hold's countdown is scheduled — the MEDIA clock cues themselves
 * fire on (`Narrator.scheduleAfter`), never the wall clock. `hold` is
 * authored (or derived, `Cue.hold`) in nominal media seconds: the cue that
 * put a picture up and the timer that takes it down have to agree on what a
 * second is, or a slower playback rate or a pause leaves the two adrift —
 * exactly Task 5's bug, `Reveal.tsx:105-106`'s old plain `setTimeout(hold)`
 * counting wall-clock ms while the cue that mounted this effect fired off
 * rate-scaled, pausable media time.
 *
 * Defaults to a real wall-clock timer: rendered on its own — every test in
 * this directory, a symbol, a river, one accumulating sea — there is no
 * narrator to ask, and a plain `setTimeout` is exactly as timed as this
 * always was. Only `TourStage`, the seam that actually owns a `Narrator`,
 * provides the real one, via `MediaClockProvider`.
 */
type MediaClock = (seconds: number, cb: () => void) => () => void

const wallClock: MediaClock = (seconds, cb) => {
  const t = setTimeout(cb, seconds * 1000)
  return () => clearTimeout(t)
}

const MediaClockContext = createContext<MediaClock>(wallClock)

/** `TourStage`'s own seam into every `Reveal` under it: hand it
 *  `Narrator.scheduleAfter` (bound, stable across renders — see that
 *  method's own note) so a hold means media seconds, not wall ones, for
 *  real playback. */
export const MediaClockProvider = MediaClockContext.Provider

/**
 * FALLBACK constants, in ms — not the primary source of an effect's
 * lifetime.
 *
 * The real hold is `Cue.hold`, derived once at build time
 * (`scripts/lib/words.mjs`'s `cueTimes`) from the clip's own duration and
 * the cue that follows: how long a picture actually needs to stay depends on
 * how long the sentence spends describing it, which these numbers cannot
 * know. Every effect below takes `hold` as a prop and defaults it to the
 * matching constant here, so this table is only ever read when no derived
 * hold reached the effect — the draft-voice pipeline (no rendered audio to
 * derive from yet) and a test that renders one effect alone.
 *
 * They used to be tuned by hand against `content/tour.json`, on the
 * assumption that "the next cue" would cut each one short in practice. It
 * did not: watched end to end, the tiger's card closed six seconds into a
 * fourteen-second sentence still describing it, and the Delhi ring in
 * particular fell three seconds short of the India Gate cue it was tuned to
 * meet (see `Here.tsx`). That gap is what `Cue.hold` exists to close.
 */
export const HOLD = {
  symbol: 6000,
  sea: 7000,
  outline: 9000,
  river: 9000,
  mountains: 9000,
  script: 8000,
  counter: 5000,
  flag: 12000,
  /** The "look down" ring at the end of a flight — see `Here.tsx`. */
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
  const scheduleAfter = useContext(MediaClockContext)

  // The hold: `leaving` starts once the clock says `hold` MEDIA seconds
  // have passed since this cue fired — scaled by the playback rate, frozen
  // across a pause, and however far past the clip's own end an authored
  // `invite` extends it. See `MediaClockContext`'s own note for what "the
  // clock" is here and why it is not wall time.
  //
  // The fade-out that follows is a different clock on purpose: FADE_MS is
  // how long Motion's own opacity animation actually takes, over real,
  // un-rate-scaled time, regardless of what the media clock is doing — so
  // `off` is a plain wall-clock timer, started the instant `leaving`
  // actually fires rather than a fixed offset from mount (at a slower rate
  // that lands later in wall time than `hold` alone would suggest). It is
  // armed here, directly inside the hold's own callback, rather than from a
  // second effect reacting to `leaving` turning true: a `setTimeout` chained
  // off a REACT RE-RENDER cannot be relied on to exist yet the instant a
  // single `vi.advanceTimersByTime` call fires the first one and keeps
  // draining its queue — every existing test in this directory jumps both
  // thresholds in one such call, and read as "gone" long before its second
  // effect's render round-trip would have scheduled anything to find.
  useEffect(() => {
    setLeaving(false)
    setGone(false)
    let off: ReturnType<typeof setTimeout> | null = null
    const cancelHold = scheduleAfter(hold / 1000, () => {
      setLeaving(true)
      off = setTimeout(() => setGone(true), FADE_MS)
    })
    return () => {
      cancelHold()
      if (off) clearTimeout(off)
    }
  }, [hold, restartOn, scheduleAfter])

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
