import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getNarrator } from '../audio/Narrator'
import { camera } from '../map/camera'
import { useMapNodes } from '../map/useMapNodes'
import { MapStage } from '../map/MapStage'
import { dispatch } from './cues'
import type { CueApi } from './cues'
import type { Cue } from '../types'
import './tourStage.css'

type Props = {
  /** Fires when a child taps a state on the map. Defaults to a no-op: this
   *  component only wires the map up so it is visible and cues reach it.
   *  Task 10's tour sequencer decides what "picking a state" means (it
   *  abandons the tour and goes there). */
  onPickState?: (slug: string) => void
  /**
   * Every cue, after the registry has dispatched it.
   *
   * The engine has exactly ONE `onCue` slot and this component owns it, so
   * anything else that needs to hear a cue has to ask here rather than
   * quietly taking the slot away. `GrandTour` uses it for the one thing the
   * overlay seam cannot tell it: that a cue just put a picture on stage, so
   * Mor can turn and present it.
   *
   * Called after `dispatch`, and guarded: nothing on the cue path may throw.
   */
  onCue?: (cue: Cue) => void
  /**
   * What is on stage now. Change it and the stage is swept: whatever art is
   * up fades out and is unmounted.
   *
   * The tour passes the beat id, because art from one beat must not bleed
   * into the next. Every effect dismisses itself after its own hold, and
   * those holds deliberately outrun the gap between cues so nothing
   * flickers — but `HOLD.script` is 8s and beat 13's last greeting fires
   * 3.3s before the beat ends, so "Now it is your turn, tap any state" was
   * delivered with the greetings card sitting over the map for its first
   * four and a half seconds.
   *
   * A fade rather than a cut, so the tiger does not vanish the instant beat
   * 8 begins — but a short one, so that by the time a new beat's first word
   * is spoken the last beat's picture has gone.
   */
  scene?: string
  /**
   * Anything that stands ON the stage — Mor, the read-along, the play button.
   *
   * Rendered as the last children of `.tour-stage`, after `.tour-overlay`, so
   * they are in front of the art rather than behind it, and inside the same
   * positioned box as the map, so "the bottom corner" means the bottom corner
   * of the map a child is looking at. `mor.css` depends on exactly that.
   */
  children?: ReactNode
}

/**
 * The seam between the narration engine and everything visible.
 *
 * Renders the map (first time it appears anywhere in the app), owns the
 * overlay slot Task 8's art lands in, and sets the engine's one and only
 * `onCue` to the registry's `dispatch` — so a cue fired off the audio clock
 * reaches the map, the camera and the overlay without any of `cues.ts`'s
 * handlers touching React state directly.
 *
 * `CueApi` is assembled once, in an effect, from stable references
 * (`useMapNodes()` and the `camera` singleton never change identity; the
 * `sfx` and `setOverlay` closures are rebuilt only if `map` itself somehow
 * did). On unmount `onCue` is handed back to a no-op, mirroring the
 * `bindMapNodes(null)` / `bindCamera(null)` teardown `MapStage` already does
 * for the same reason: a cue arriving after this component is gone must not
 * touch a stale `setOverlay` or a map nobody is showing.
 */
export function TourStage({ onPickState, onCue, scene, children }: Props) {
  const map = useMapNodes()
  const [overlay, setOverlay] = useState<ReactNode | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const sweep = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** The cue registry's only door into this component. It also cancels a
   *  sweep in flight: a new picture arriving is the end of the old one, and
   *  nothing may null the slot out from under it a moment later. */
  const show = useCallback((node: ReactNode | null) => {
    if (sweep.current) clearTimeout(sweep.current)
    sweep.current = null
    setSweeping(false)
    setOverlay(node)
  }, [])

  // Sweep the stage when the scene changes. Guarded on there being anything
  // to sweep, so this is inert on mount and on every render where the tour
  // is not running.
  const hasArt = overlay !== null
  useEffect(() => {
    if (!hasArt) return
    setSweeping(true)
    sweep.current = setTimeout(() => {
      sweep.current = null
      setSweeping(false)
      setOverlay(null)
    }, SWEEP_MS)
    return () => {
      if (sweep.current) clearTimeout(sweep.current)
      sweep.current = null
    }
    // Deliberately NOT on `hasArt`: this fires when the scene changes, and
    // reading whether there is art to sweep is not the same as watching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // Through a ref, so a parent that hands over a fresh closure on every
  // render does not tear the engine's onCue down and rebuild it mid-beat.
  const heard = useRef(onCue)
  useEffect(() => { heard.current = onCue }, [onCue])

  useEffect(() => {
    const n = getNarrator()
    const api: CueApi = {
      map,
      camera: {
        flyTo(bbox, opts) {
          // A handler fires the flight and moves on; it does not await one
          // landing. Task 6's flyTo already lands cleanly if the map is torn
          // down mid-flight, so there is nothing here to wait for. `opts` is
          // forwarded as-is — cues.ts already resolved the padding a
          // particular place needs; this layer has no opinion of its own.
          void camera.flyTo(bbox, opts)
        },
        home() {
          void camera.home()
        },
      },
      sfx(name) {
        // The engine's sfx() already resolves a missing file to silence and
        // swallows its own decode errors; this catch is only for the one
        // path it does not guard itself (a closed AudioContext), so a cue
        // handler can never produce an unhandled rejection either.
        void n.sfx(name).catch(() => {})
      },
      setOverlay: show,
    }
    n.onCue = (cue) => {
      dispatch(cue, api)
      // `dispatch` never throws; a listener is not held to that contract by
      // anything but this, so it is held to it here.
      try {
        heard.current?.(cue)
      } catch (err) {
        console.debug('[tour] a cue listener threw', err)
      }
    }
    return () => {
      n.onCue = () => {}
    }
  }, [map, show])

  return (
    <div className="tour-stage">
      <MapStage onPick={onPickState ?? NOOP} />
      {overlay && (
        <div className="tour-overlay" data-sweeping={sweeping ? 'true' : undefined}>
          {overlay}
        </div>
      )}
      {children}
    </div>
  )
}

/** How long the outgoing picture takes to leave. Shorter than the earliest
 *  art cue in any beat (beat 6's flag, at 663 ms), so a sweep can never eat
 *  the picture the new beat is about to draw. */
const SWEEP_MS = 350

const NOOP = () => {}
