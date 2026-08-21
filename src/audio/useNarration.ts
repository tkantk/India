import { useSyncExternalStore } from 'react'
import { getNarrator } from './Narrator'

/**
 * The only subscription React makes to the narration engine: which word
 * index is being spoken right now, or -1 between clips.
 *
 * `getNarrator().subscribe` / `getSnapshot` are stable arrow properties on
 * the singleton engine, so passing them straight through keeps this a
 * primitive `useSyncExternalStore` selector — React re-renders only the
 * component that reads this hook, and only when the word actually changes.
 * The engine never calls `setState`; it only ever emits, and this hook is
 * the seam that turns that emission into a render.
 */
export function useCurrentWord(): number {
  const n = getNarrator()
  return useSyncExternalStore(n.subscribe, n.getSnapshot, () => -1)
}
