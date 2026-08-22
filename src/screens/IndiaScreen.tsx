import { GrandTour } from '../tour/GrandTour'

/**
 * The screen the whole app is for: a map of India, a peacock, and a button
 * that says "Show me India".
 *
 * It is deliberately thin. Everything that happens on it belongs to
 * `GrandTour` — the fourteen beats, the cues, the camera, the read-along and
 * the control bar — and everything about where those things sit belongs to
 * `src/tour/grandTour.css`. What is left here is the screen itself: the
 * `.india` element that the layout hangs off (see base.css and grandTour.css)
 * and one heading.
 *
 * THE HEADING IS FOR SCREEN READERS ONLY. A page needs one, and a child does
 * not need to be told in 32px type what they are looking at while a peacock
 * is telling them out loud. The map, the tour and Mor take the whole screen
 * instead.
 *
 * `onPickState` is not wired to anything yet: the tour already stops, lights
 * the state and flies to it, which is as far as Plan 2 goes. Plan 3 is what
 * turns arriving somewhere into the state card, the landmarks and the
 * passport.
 */
export function IndiaScreen() {
  return (
    <main className="india">
      <h1 className="visually-hidden">Namaste India</h1>
      <GrandTour />
    </main>
  )
}
