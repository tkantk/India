/**
 * Whether a finger is currently down on `Trace`'s own corridor.
 *
 * Published so `GrandTour`'s dwell timer (see its own top-of-file note on
 * the invitation that waits) can tell a live gesture from an idle one
 * without either file reaching into the other's internals — `Trace` writes
 * here on every `pointerdown`/`pointerup`/`pointercancel` that starts or
 * ends a gesture on the corridor, and nothing else in the app writes to it.
 *
 * THE SHAPE IS DELIBERATE: a `subscribe(fn)` plus a synchronous snapshot
 * getter, exactly the pair `Narrator` already publishes `playing` through —
 * `useSyncExternalStore(subscribeTracing, isTracing)` reads this the same
 * way `GrandTour` already reads `n.playing`.
 *
 * MODULE-SCOPED, NOT COMPONENT STATE — the same reason `tourPosition.ts` is.
 * `Trace` mounts and unmounts with the art it belongs to (a fresh instance
 * every time an outline is revealed, or torn down when its hold expires),
 * and a listener elsewhere must see "no finger is down" survive that
 * transition, not reset to some default the next mount happens to pick.
 */

let down = false
let listeners: (() => void)[] = []

/** `Trace`'s own two calls: the corridor gained a finger, or lost one. A
 *  same-value write is a no-op — nothing changed, so no listener needs
 *  waking for it. */
export function setTracing(value: boolean): void {
  if (value === down) return
  down = value
  for (const fn of [...listeners]) fn()
}

/** The synchronous snapshot `useSyncExternalStore` wants. */
export function isTracing(): boolean {
  return down
}

export function subscribeTracing(fn: () => void): () => void {
  listeners.push(fn)
  return () => { listeners = listeners.filter((l) => l !== fn) }
}
