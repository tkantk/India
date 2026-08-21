import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getNarrator } from '../audio/Narrator'
import { camera } from '../map/camera'
import { useMapNodes } from '../map/useMapNodes'
import { MapStage } from '../map/MapStage'
import { dispatch } from './cues'
import type { CueApi } from './cues'
import './tourStage.css'

type Props = {
  /** Fires when a child taps a state on the map. Defaults to a no-op: this
   *  task only wires the map up so it is visible and cues reach it. Task 10's
   *  tour sequencer decides what "picking a state" means (it abandons the
   *  tour and navigates there). */
  onPickState?: (slug: string) => void
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
export function TourStage({ onPickState }: Props) {
  const map = useMapNodes()
  const [overlay, setOverlay] = useState<ReactNode | null>(null)

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
    n.onCue = (cue) => dispatch(cue, api)
    return () => {
      n.onCue = () => {}
    }
  }, [map])

  return (
    <div className="tour-stage">
      <MapStage onPick={onPickState ?? NOOP} />
      {overlay && <div className="tour-overlay">{overlay}</div>}
    </div>
  )
}

const NOOP = () => {}
