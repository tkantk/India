/**
 * One state's own border, drawn on the map it is drawn on — and traceable
 * with a finger, exactly the way India's is at beat 2 of the tour.
 *
 * This is `art/Outline.tsx` with the country swapped for a state, and
 * nothing else: same `Layer` (so it registers against the camera's LIVE
 * committed viewBox rather than wherever the map was at startup), same
 * `useMapZoom` (so a pencil line keeps its weight on screen while the
 * geography under it grows), same `useStill`/`isCheap` gate, same `Trace`.
 * `Trace` was written general on purpose — "not about India: everything
 * below works over any single closed ring given in the map's own
 * coordinates" — and this is the caller that was promised.
 *
 * WHY THE FIRST RING ONLY, for the traceable half. `Trace` measures progress
 * as arc length along whatever `d` it is given, so folding a state's
 * offshore islands into the same path would let a stray touch out at sea eat
 * into the same fraction as the mainland coast. `Outline` slices `INDIA_
 * OUTLINE` at its first `Z` for that reason; a state is the same problem at
 * a smaller scale — Kerala's own `d` carries two rings, Rajasthan's one.
 * The DRAWN line still uses the whole path: a child should see all of their
 * state, and only trace the part of it a fingertip can follow.
 */
import { motion } from 'motion/react'
import { isCheap } from '../../lib/cheapMode'
import { Layer, useMapZoom, useStill } from './Reveal'
import { Trace } from './Trace'
import { subjectOf } from './subject'

/** Slow on purpose — a child is meant to be able to follow it round. The
 *  same 2.2s `Outline` draws the whole country in; a state is a shorter
 *  path, so the same duration reads as a slower, more deliberate pencil. */
const DRAW_S = 2.2

/**
 * Longer than any visit, in ms.
 *
 * `Layer` self-dismisses after its hold, because everything it was built for
 * is a CUE — a picture that answers one sentence and then gets out of the
 * way. A state's own border is not that: it is the page the child is on, and
 * it has to still be there after the ninth tap. The hold is a media-clock
 * deadline (`Narrator.scheduleAfter`), so this is an hour of NARRATION, not
 * an hour of sitting still: at ~200 seconds of audio per place a child would
 * have to hear every line of it eighteen times over.
 */
const FOR_THE_WHOLE_VISIT = 60 * 60 * 1000

/** The ring a finger is offered, up to and including the first `Z`. Falls
 *  back to the whole path for a `d` with no `Z` at all, which geo.json does
 *  not currently produce and which must not throw if it ever does. */
function firstRing(d: string): string {
  const z = d.indexOf('Z')
  return z === -1 ? d : d.slice(0, z + 1)
}

export function StateShape({ d, subject }: { d: string; subject?: string }) {
  // Same gate `Outline` uses: a device already caught dropping frames should
  // not be asked to dash-stroke a thousand-point path on every pointermove.
  const drawn = !useStill() && !isCheap()
  const zoom = useMapZoom()
  const { accent, ink } = subjectOf(subject)

  return (
    <Layer hold={FOR_THE_WHOLE_VISIT}>
      {/* TWO STROKES, NOT ONE, and the reason is measured rather than
          decorative. A state on this screen is already flood-filled
          `--lit-state` saffron by `highlightState` and already carries
          map.css's own 1.5px `--land-edge` border, so a single 2.4px line
          in the subject's accent — `Outline`'s recipe, which works because
          India's coastline runs against pale water — was invisible against
          it in the first photograph of this screen.

          So the accent goes UNDER, wide and soft, straddling the edge: it
          reads as the state being lit in its own colour rather than as a
          second border competing with the one already there. The ink line
          on top is the book's one ink at the book's own weight (`--rule` is
          3px; 4 x zoom lands at ~3 CSS px at any camera position), which is
          what makes the shape read as DRAWN rather than as filled.

          Both are `stroke-width` on a single path, never a filter — WebKit's
          legacy SVG engine runs a filter as a three-pass CPU blur, and this
          sits over the one composited layer the camera flies. */}
      <motion.path
        d={d}
        fill="none"
        stroke={accent}
        strokeWidth={11 * zoom}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
        initial={drawn ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: DRAW_S, ease: 'linear' }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke={ink}
        strokeWidth={4 * zoom}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={drawn ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: DRAW_S, ease: 'linear' }}
      />
      {drawn && <Trace d={firstRing(d)} />}
    </Layer>
  )
}
