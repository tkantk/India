import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import timingsJson from '../data/timings.json'
import photosJson from '../data/photo-credits.json'
import { forgetPlacesForTests, isWritten, loadPlace, placeState, WRITTEN } from './places'
import { SHARED_CLIPS } from './clips'
import type { Place } from '../../content/schema.ts'

/**
 * THE LOADER, AGAINST THE REAL SPLIT. Nothing here is a double: every
 * `loadPlace` below goes through `scripts/vite-place-data.mjs` exactly as the
 * built app does (Vitest runs the same plugins as `vite build`), and every
 * answer is checked against the generator's own whole files — the files that
 * split was cut FROM, which is the only honest thing to check a split
 * against.
 */
const TIMINGS = timingsJson as Record<string, unknown>
const PHOTOS = photosJson as Record<string, unknown>

/** Every place file, read the way `place-strip.mjs` reads them — from the
 *  directory, never a hand-kept list. */
const ON_DISK: Record<string, Place> = Object.fromEntries(
  readdirSync('content/places')
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(`content/places/${f}`, 'utf8'))]),
)
const SLUGS = Object.keys(ON_DISK).sort()

/** The ten clip ids a place's own page asks for — `PlaceScreen.tsx`'s
 *  `pagesFor`, read straight off the content. */
const pageClipIds = (p: Place) => [
  p.intro.id,
  p.card.animal.id, p.card.food.id, p.card.festival.id, p.card.hello.id,
  ...p.landmarks.map((l) => l.line.id),
]

beforeEach(() => forgetPlacesForTests())

describe('loadPlace', () => {
  it("brings one place's own page, its own clips and its own photo credits — and nothing of anyone else's", async () => {
    const kerala = await loadPlace('kerala')
    expect(kerala).toBeDefined()

    expect(kerala!.place).toEqual(ON_DISK.kerala)

    // Exactly the `kerala.*` keys of timings.json, each one the same clip.
    const own = Object.keys(TIMINGS).filter((k) => k.startsWith('kerala.')).sort()
    expect(Object.keys(kerala!.clips).sort()).toEqual(own)
    for (const id of own) expect(kerala!.clips[id]).toEqual(TIMINGS[id])
    // ...and not one clip of any other place, nor the shared tour/ui lines.
    for (const id of Object.keys(kerala!.clips)) expect(id.startsWith('kerala.')).toBe(true)

    // Its five landmarks, and its animal keyed by SPECIES — not Rajasthan's
    // camel, not anyone else's Hawa Mahal.
    const wanted = [...ON_DISK.kerala.landmarks.map((l) => l.id), ON_DISK.kerala.card.animal.species]
      .filter((k) => k in PHOTOS)
      .sort()
    expect(Object.keys(kerala!.photos).sort()).toEqual(wanted)
    expect(kerala!.photos['asian-elephant']).toEqual(PHOTOS['asian-elephant'])
    expect(kerala!.photos['rajasthan.hawa-mahal']).toBeUndefined()
  })

  it('carries every clip each place\'s own page will ask for, for all of them', async () => {
    // The convention the split rests on — every line a place authors is
    // `<slug>.…` — checked rather than trusted: a line id authored without
    // its slug would still PLAY (the screen falls back to the shared clips),
    // but it would ride in the main bundle, and this is where that shows.
    for (const slug of SLUGS) {
      const data = await loadPlace(slug)
      for (const id of pageClipIds(ON_DISK[slug])) {
        expect(data!.clips[id], `${slug}: ${id}`).toBeDefined()
      }
    }
  })

  it('loses nothing and duplicates nothing: every place\'s clips plus the shared ones are timings.json exactly', async () => {
    const seen = new Map<string, string>()
    for (const slug of SLUGS) {
      for (const id of Object.keys((await loadPlace(slug))!.clips)) {
        expect(seen.get(id), `${id} in two places`).toBeUndefined()
        seen.set(id, slug)
      }
    }
    for (const id of Object.keys(SHARED_CLIPS)) {
      expect(seen.get(id), `${id} is both shared and a place's`).toBeUndefined()
      seen.set(id, 'shared')
    }
    expect([...seen.keys()].sort()).toEqual(Object.keys(TIMINGS).sort())
  })

  it('keeps only what no place owns in the main bundle — the tour and the interface lines', () => {
    for (const id of Object.keys(SHARED_CLIPS)) {
      expect(SLUGS.includes(id.slice(0, id.indexOf('.'))), id).toBe(false)
    }
    // The three a place's page speaks from the shared half, by name.
    for (const id of ['ui.tap-state', 'ui.all-heard', 'ui.stamp']) expect(SHARED_CLIPS[id]).toBeDefined()
    expect(Object.keys(SHARED_CLIPS).some((id) => id.startsWith('tour.'))).toBe(true)
  })

  it('asks for a place once, however many callers want it at the same moment', async () => {
    // The tap's prefetch and the screen's own load must share ONE request.
    const a = loadPlace('goa')
    const b = loadPlace('goa')
    expect(a).toBe(b)
    expect(await a).toBe(await b)
    // And once it is in hand, a later caller gets the same object, not a refetch.
    expect(await loadPlace('goa')).toBe(await a)
  })

  it('reports loading until it lands, then ready — with the data already there on the first read', async () => {
    expect(placeState('assam')).toEqual({ status: 'loading' })
    const data = await loadPlace('assam')
    const state = placeState('assam')
    expect(state.status).toBe('ready')
    expect(state.status === 'ready' && state.data).toBe(data)
    // The same object every read: `useSyncExternalStore` compares by identity.
    expect(placeState('assam')).toBe(state)
  })
})

describe('a place with nothing written', () => {
  it('is known to be missing at once, with nothing to wait for', async () => {
    expect(isWritten('nowhereland')).toBe(false)
    expect(placeState('nowhereland')).toEqual({ status: 'missing' })
    await expect(loadPlace('nowhereland')).resolves.toBeUndefined()
  })

  it('never mistakes an object\'s own machinery for a place — a slug is whatever a URL says', async () => {
    // The old `BY_SLUG[slug]` lookup answered `/place/constructor` with a
    // function. `LOADERS` is a Map so this cannot happen.
    for (const slug of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '']) {
      expect(isWritten(slug), slug).toBe(false)
      expect(placeState(slug)).toEqual({ status: 'missing' })
      await expect(loadPlace(slug)).resolves.toBeUndefined()
    }
  })
})

describe('WRITTEN — the index the "not been here yet" page offers', () => {
  it('names every place that has a file, alphabetically by name, and carries nothing else', () => {
    expect(WRITTEN.map((p) => p.id).sort()).toEqual(SLUGS)
    for (const p of WRITTEN) expect(p.name).toBe(ON_DISK[p.id].name)
    const names = WRITTEN.map((p) => p.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    // Slug and name only: offering 36 places must not mean carrying 36 pages.
    for (const p of WRITTEN) expect(Object.keys(p).sort()).toEqual(['id', 'name'])
  })
})
