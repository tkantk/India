/// <reference path="./virtual.d.ts" />
/**
 * The authored content for a place, looked up by slug — and, since the app
 * outgrew one script, FETCHED by slug, at the moment it is wanted.
 *
 * WHY IT IS LOADED, NOT IMPORTED. This file's old header said the eager glob
 * over `content/places/*.json` was "correct at 4 files and wants revisiting
 * at 36". At 36, a place's page was the smallest part of the problem: its
 * ten clips' word timings and its photo credits rode along too, inside
 * `timings.json` and `photo-credits.json`, and the whole lot was parsed
 * before the start gate could draw — 1.5 MB of script on an old iPad, which
 * is the exact risk the design spec (§11) answers with "lazy per-state
 * loading". So `scripts/vite-place-data.mjs` now cuts each place into its
 * own chunk at build time, and this file is the only door to them.
 *
 * WHAT ONE PLACE IS NOW: `{ place, clips, photos }` — its authored page, its
 * own ten clips, and the photo credits its page shows. One request, about
 * 30 KB before compression, arriving together so the screen never has a
 * page whose words have no timings or whose landmark has no credit.
 *
 * "NOT WRITTEN" IS STILL A FIRST-CLASS ANSWER, AND IT IS STILL SYNCHRONOUS.
 * The index (`WRITTEN`, below) names every place that has a file, so a slug
 * with no file is known to be missing on the first render, with nothing to
 * wait for — `PlaceScreen` goes straight to its "We have not been to …
 * yet" page exactly as before. The tour tells every child "tap any state"
 * (`content/tour.json`, beat 14) and that promise has to survive being taken
 * up on a state nobody has written.
 *
 * STILL DERIVED FROM THE DIRECTORY, NEVER HAND-LISTED. The reason the old
 * glob was a glob (`ART_VERBS`; the `SUBJECTS` coverage check) still holds:
 * the plugin reads `content/places/` itself, so adding `assam.json` makes
 * Assam's page — and its chunk — exist with no second edit anywhere.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { LOADERS, WRITTEN as INDEX } from 'virtual:place-data'
import type { Place } from '../../content/schema.ts'
import type { Clip } from '../types'

/** The three things `PlaceScreen` reads off a photo credit. The generated
 *  record carries more (`Credits.tsx` reads all of it); these are all the
 *  page itself needs. */
export type PhotoCredit = {
  file: string
  attributionRequired: boolean
  attributionHtml: string
}

/** One place, as its chunk delivers it. */
export type PlaceData = {
  place: Place
  /** Its own clips — every `<slug>.*` key in `timings.json`, and only those.
   *  The interface lines a page also speaks (`ui.*`) are `SHARED_CLIPS`. */
  clips: Record<string, Clip>
  /** Keyed by landmark id, and by SPECIES for the animal card. */
  photos: Record<string, PhotoCredit>
}

/**
 * Where a place's page has got to. Four answers, because the screen does a
 * different, honest thing for each:
 *
 *  - `loading`  a written place whose chunk has not arrived yet;
 *  - `ready`    arrived;
 *  - `missing`  no file at all — known at once, never "loading" first;
 *  - `failed`   the chunk would not load. On GitHub Pages the likeliest
 *               cause is a new deploy having replaced the hashed chunk names
 *               under a tab that was opened before it — see `reopen`.
 */
export type PlaceState =
  | { status: 'loading' }
  | { status: 'ready'; data: PlaceData }
  | { status: 'missing' }
  | { status: 'failed' }

/** Every place with a written page, in the order a child would meet them —
 *  alphabetical by name, because nothing better is available and stable
 *  beats clever. Used by the "we have not been here yet" page to offer the
 *  ones that do exist rather than leaving a child at a dead end.
 *
 *  Slug and name only, and built at build time from the files themselves:
 *  offering 36 names must never mean fetching 36 places. */
export const WRITTEN: readonly { id: string; name: string }[] = INDEX

/** Whether a slug has a written page. Never throws: a slug is whatever a
 *  finger, or a URL, landed on — `LOADERS` is a Map precisely so that
 *  `/place/constructor` is simply not a place. */
export function isWritten(slug: string | undefined): boolean {
  return slug !== undefined && LOADERS.has(slug)
}

// ------------------------------------------------------------ the cache

/**
 * One state object per answer, reused, never rebuilt: `useSyncExternalStore`
 * compares snapshots by identity, and a fresh `{ status: 'loading' }` on
 * every read would re-render the screen for ever.
 */
const LOADING: PlaceState = { status: 'loading' }
const MISSING: PlaceState = { status: 'missing' }
const FAILED: PlaceState = { status: 'failed' }

/** Settled answers, by slug — `ready` or `failed`. Absent means loading. */
const settled = new Map<string, PlaceState>()
/** Requests in flight, so a prefetch and the screen's own load share ONE. */
const inflight = new Map<string, Promise<PlaceData | undefined>>()
const listeners = new Set<() => void>()

const settle = (slug: string, state: PlaceState) => {
  settled.set(slug, state)
  for (const fn of [...listeners]) fn()
}

/**
 * Fetch one place — or hand back the fetch already under way, or the answer
 * already in hand. Resolves `undefined` for a slug with no page; rejects only
 * if the chunk itself would not load (and records that as `failed`).
 *
 * A FAILURE IS REMEMBERED FOR THE LIFE OF THE PAGE, deliberately. The HTML
 * spec caches a failed module fetch in the document's module map, so asking
 * `import()` again in the same page can return the same failure without
 * touching the network — retrying here would look like a retry and not be
 * one. `reopen` is the retry that actually works.
 */
export function loadPlace(slug: string): Promise<PlaceData | undefined> {
  const load = LOADERS.get(slug)
  if (!load) return Promise.resolve(undefined)
  const known = settled.get(slug)
  if (known?.status === 'ready') return Promise.resolve(known.data)
  if (known?.status === 'failed') return Promise.reject(new Error(`${slug}: failed to load`))
  let request = inflight.get(slug)
  if (!request) {
    request = load().then(
      (module) => {
        inflight.delete(slug)
        const data = module.default as PlaceData
        settle(slug, { status: 'ready', data })
        return data
      },
      (error: unknown) => {
        inflight.delete(slug)
        settle(slug, FAILED)
        throw error
      },
    )
    inflight.set(slug, request)
  }
  return request
}

/**
 * Start fetching a place the child is about to open, and forget about it.
 * Called the instant a tap becomes a navigation (`App.tsx`), before the
 * place's screen has even rendered — so the request is already in the air
 * while React builds the page and the arrival flight starts, and the screen's
 * own `loadPlace` simply joins it. Never throws, never rejects unhandled: a
 * failure is recorded for the screen to show, not thrown at whoever tapped.
 */
export function prefetchPlace(slug: string): void {
  loadPlace(slug).catch(() => { /* recorded as `failed`; the screen shows it */ })
}

/** The current answer for a slug, without starting anything. */
export function placeState(slug: string): PlaceState {
  if (!isWritten(slug)) return MISSING
  return settled.get(slug) ?? LOADING
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * A place's state, kept current, for a component. Starts the load if nothing
 * has yet — the deep-link path, `#/place/kerala` typed or reloaded, where no
 * tap came first to prefetch it.
 *
 * Already arrived means arrived ON THE FIRST RENDER: a place fetched earlier
 * in the session (or prefetched and landed before the screen mounted)
 * renders complete, with no loading frame in between.
 */
export function usePlace(slug: string): PlaceState {
  const state = useSyncExternalStore(subscribe, () => placeState(slug))
  useEffect(() => {
    if (placeState(slug).status === 'loading') prefetchPlace(slug)
  }, [slug])
  return state
}

/**
 * Try a failed place again, the only way that reliably works: load the page
 * afresh. A new `index.html` brings the chunk names of whatever is deployed
 * NOW, which is the fix for a tab left open across a deploy; and the
 * HashRouter keeps `#/place/<slug>` across the reload, so the child lands
 * back on the same place. The screen already supports arriving cold (see
 * `PlaceScreen`'s `unlocked`): nothing plays until the next real tap.
 */
export function reopen(): void {
  window.location.reload()
}

/** Tests only: forget every place fetched so far, so each test starts as a
 *  fresh page would. The same convention as `resetPassportForTests`. */
export function forgetPlacesForTests(): void {
  settled.clear()
  inflight.clear()
}
