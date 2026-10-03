/// <reference path="./virtual.d.ts" />
/**
 * THE CLIPS EVERY SCREEN NEEDS BEFORE ANY PLACE IS OPENED: the tour's
 * fourteen beats (`tour.*`) and the interface lines (`ui.*` — "Tap a state
 * to visit it", the passport's own words, "You have heard everything here").
 *
 * The tour plays the first of these within a second of the start gate, and
 * the passport and every place page speak the `ui.*` ones, so they stay in
 * the main bundle. They used to arrive as the whole of `timings.json` —
 * every place's clips too, 375 KB of word timings for 36 places the child
 * had not tapped yet. `scripts/vite-place-data.mjs` now hands this file only
 * the clips no place owns, and each place's own clips travel with that
 * place (`places.ts`).
 *
 * "No place owns" rather than "tour or ui" — see that plugin's header: a clip
 * under a prefix nobody has thought of yet lands HERE and keeps working,
 * rather than vanishing between the two halves.
 */
import shared from 'virtual:shared-clips'
import type { Clip } from '../types'

export const SHARED_CLIPS = shared as Record<string, Clip>
