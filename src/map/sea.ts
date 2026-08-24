/**
 * The sea layer's markup: neighbouring land, drawn once beneath everything
 * that is India, and never touched again.
 *
 * Pure and DOM-free, the same reason `hitLayer.ts` is: nothing here is
 * interactive (`svg.sea` is `pointer-events: none` in `map.css`, and stays
 * that way — this layer must never become a tap target), so unlike
 * `baseMarkup`/`hitMarkup` there is no probe that needs to drive a browser
 * over it. It is still a separate function, and a separate file, because
 * `MapStage.tsx` builds this markup exactly once, module-scoped, the same
 * way it builds the (much bigger) base and hit markup — see its own
 * docstring for why identity matters there.
 */

/** One neighbouring landmass, as `build-world.mjs` emits it. */
export type SeaPlace = { d: string }

/** The sea layer's paths: a country or two dozen, muted and flat, with no
 *  data this app ever reads back out of them — `data-slug` is here only so
 *  a human (or a test) can tell one shape from another while looking at the
 *  markup, not because anything is ever looked up by it. */
export function seaMarkup(places: Record<string, SeaPlace>): string {
  return Object.entries(places)
    .map(([slug, p]) => `<path data-slug="${slug}" d="${p.d}"/>`)
    .join('')
}
