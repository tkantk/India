import { useEffect, useRef, useState } from 'react'
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
export function TourStage({ onPickState, onCue, children }: Props) {
  const map = useMapNodes()
  const [overlay, setOverlay] = useState<ReactNode | null>(null)

  // Through a ref, so a parent that hands over a fresh closure on every
  // render does not tear the engine's onCue down and rebuild it mid-beat.
  const heard = useRef(onCue)
  useEffect(() => { heard.current = onCue }, [onCue])

  useEffect(() => {
    const n = getNarrator()
    const api: CueApi = {
      map,
      camera: {
        flyTo(bbox) {
          // A handler fires the flight and moves on; it does not await one
          // landing. Task 6's flyTo already lands cleanly if the map is torn
          // down mid-flight, so there is nothing here to wait for.
          void camera.flyTo(bbox)
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
      setOverlay,
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
  }, [map])

  return (
    <div className="tour-stage">
      <MapStage onPick={onPickState ?? NOOP} />
      {overlay && <div className="tour-overlay">{overlay}</div>}
      {children}
    </div>
  )
}

const NOOP = () => {}
