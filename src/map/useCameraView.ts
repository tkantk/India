/**
 * Where the map is looking, as a React value.
 *
 * The camera writes `viewBox` straight onto the DOM — deliberately, because
 * putting 269 KB of path data behind React state would put the reconciler in
 * the hot path of every cue. Anything that draws in the map's coordinates
 * from OUTSIDE the map's own layers (the tour overlay is a sibling of `.map`,
 * so the commit never reaches it) therefore has no way to know the camera
 * moved unless it is told. `camera.watch` tells it; this turns that into a
 * value a component can render with.
 *
 * Null means no map is mounted. The caller decides what to draw against then
 * — the contact sheet renders every effect with no camera at all, and the
 * honest answer there is the map's home rect.
 *
 * Split out of `camera.ts` rather than added to it because
 * `scripts/probe-camera.mjs` loads that file into a real browser through
 * Node's type stripping, and it cannot import React.
 */
import { useEffect, useState } from 'react'
import type { Bbox } from '../types'
import { camera } from './camera'

const same = (a: Bbox | null, b: Bbox | null): boolean =>
  a === b || (a !== null && b !== null && a.every((n, i) => n === b[i]))

export function useCameraView(): Bbox | null {
  const [view, setView] = useState<Bbox | null>(() => camera.view())

  useEffect(() => {
    const update = (next: Bbox | null) =>
      // Same numbers, same array: a commit that did not move the camera must
      // not re-render every piece of art on the map.
      setView((prev) => (same(prev, next) ? prev : next))
    // A flight can land between this component's render and its effect —
    // MapStage binds the camera in its own effect, which runs first — so read
    // once here rather than waiting for the next commit to come along.
    update(camera.view())
    return camera.watch(update)
  }, [])

  return view
}
