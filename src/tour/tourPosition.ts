/**
 * Where something was, if a session ended before it was finished.
 *
 * Module-scoped, not component state — and that is the whole reason this
 * file exists rather than a `useState` in `GrandTour`. Component state dies
 * with the component, and the tour is torn down and rebuilt by ordinary
 * navigation: the credits link at the bottom of the map (`MapStage.tsx`)
 * changes the route today, which unmounts `GrandTour` and mounts a fresh one
 * when the child comes back (`Credits.tsx`'s "Back to the map"). A position
 * kept in React state cannot survive that trip. A position kept here does,
 * for as long as the page itself is open.
 *
 * IT KNOWS NOTHING ABOUT BEATS. Only a plain index into whatever ordered
 * sequence the caller happens to be walking through — the tour's fourteen
 * beats today, and the next plan's 32 per-state screens tomorrow, which will
 * want the exact same "where was I when something pulled me away" and can
 * reuse this as-is rather than growing a second copy of it.
 */

let at: number | null = null

/** Remember a position — the thing that was in the air when something took
 *  the child away from it. */
export function park(position: number): void {
  at = position
}

/** The remembered position, or null when nothing is parked. */
export function parked(): number | null {
  return at
}

/** Forget it. For wherever "starting over" is the documented behaviour —
 *  going home, or finishing the thing being walked through. */
export function clearPark(): void {
  at = null
}
