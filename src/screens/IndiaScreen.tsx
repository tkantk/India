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
 * `onPickState` IS THE ONLY PROP, AND IT IS OPTIONAL ON PURPOSE. A child
 * tapping a state now turns to that state's own page (`PlaceScreen`), which
 * means a route change — but `useNavigate` cannot be called anywhere in this
 * subtree: `GrandTour`, `TourStage` and `MapStage` are all mounted with no
 * Router at all by this file's own tests and by both headless probes, and
 * `MapStage` uses a plain `<a href="#/credits">` rather than a `<Link>` for
 * exactly that reason. So the navigation is INJECTED, from `App.tsx`, which
 * is inside the Router; left out, this screen behaves exactly as it did
 * before — the tour stops, lights the state and flies to it, and nothing
 * else happens.
 */
export function IndiaScreen({ onPickState }: { onPickState?: (slug: string) => void }) {
  return (
    <main className="india">
      <h1 className="visually-hidden">Namaste India</h1>
      <GrandTour onPickState={onPickState} />
    </main>
  )
}
