import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlaceScreen } from './PlaceScreen'
import geo from '../data/geo.json'
import photoCredits from '../data/photo-credits.json'
import rajasthan from '../../content/places/rajasthan.json'
import type { Bbox, Clip, Cue } from '../types'

/**
 * THE DOUBLES ARE FAITHFUL, which on this screen means three specific
 * things rather than a general principle:
 *
 *  1. `play()` resolves when a clip STARTS. Nothing here may be written as
 *     if awaiting it meant the line had been heard — the tick on a tile and
 *     the "say it again" branch of Play both hang off `onEnd`, which fires
 *     only at a natural end.
 *  2. `ambient()` exists and is called. It had no caller anywhere in the app
 *     before this screen, so a double that omitted it would let the call be
 *     written and never noticed if it were later deleted.
 *  3. `camera.flyTo` records what it was asked for. The whole point of the
 *     arrival framing is the numbers it is called with, and jsdom cannot
 *     see a flight; asserting the ARGUMENT is the only honest check
 *     available here (the pixels are `scripts/shot.mjs`'s job).
 *  4. `everUnlocked` starts false and only `unlock()` flips it — never
 *     `play()` or `resumeContext()`. The screen's whole cold-start fix
 *     hangs on this exact distinction (see `PlaceScreen.tsx`'s own
 *     `unlocked` comment); a double that let `play()` imply unlock would
 *     make every test pass whether or not the real gate exists.
 */
const played: string[] = []
const ambient: (string | null)[] = []
const flights: { bbox: Bbox; padding?: number }[] = []
let listeners: (() => void)[] = []

const narrator = {
  playing: false,
  stuck: false,
  loading: false,
  word: -1,
  // Warm by default — the common path, a tap from the map, always lands
  // after `StartGate`'s own unlock. Cold-start tests below set this false
  // BEFORE rendering, which is the one thing that actually distinguishes
  // "arrived from the map" from "opened this URL cold".
  everUnlocked: true,
  onCue: (() => {}) as (cue: Cue) => void,
  onEnd: null as (() => void) | null,
  onAgain: null as (() => void) | null,
  current: null as Clip | null,
  get canReplay() { return narrator.current !== null },
  play: vi.fn(async (clip: Clip) => {
    played.push(clip.audio)
    narrator.playing = true
    narrator.current = clip
    narrator.emit()
  }),
  /** A natural end, the only thing that ever fires `onEnd`. */
  finish() {
    narrator.playing = false
    narrator.emit()
    narrator.onEnd?.()
  },
  pause: vi.fn(() => { narrator.playing = false; narrator.emit() }),
  resume: vi.fn(),
  replay: vi.fn(),
  stop: vi.fn(() => { narrator.playing = false; narrator.current = null; narrator.emit() }),
  forget: vi.fn(),
  prefetch: vi.fn(async (_clips: Clip[]) => {}),
  evict: vi.fn((_clips: Clip[]) => {}),
  sfx: vi.fn(async (_name: string) => {}),
  ambient: vi.fn(async (name: string | null) => { ambient.push(name) }),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  resumeContext: vi.fn(async () => true),
  unlock: vi.fn(async () => { narrator.everUnlocked = true; narrator.emit() }),
  scheduleAfter: vi.fn((seconds: number, cb: () => void) => {
    const t = setTimeout(cb, seconds * 1000)
    return () => clearTimeout(t)
  }),
  subscribe: (fn: () => void) => {
    listeners.push(fn)
    return () => { listeners = listeners.filter((l) => l !== fn) }
  },
  getSnapshot: () => narrator.word,
  emit() { for (const fn of [...listeners]) fn() },
}

vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

vi.mock('../map/camera', () => ({
  PLACE_PADDING: 40,
  bindCamera: vi.fn(),
  camera: {
    flyTo: vi.fn((bbox: Bbox, opts?: { padding?: number }) => {
      flights.push({ bbox, padding: opts?.padding })
      return Promise.resolve()
    }),
    home: vi.fn(() => Promise.resolve()),
    view: () => null,
    watch: () => () => {},
  },
}))

const RAJASTHAN = geo.places.rajasthan as unknown as { bbox: Bbox }
const CREDITS = photoCredits as unknown as Record<string, { attributionHtml: string }>

beforeEach(() => {
  played.length = 0
  ambient.length = 0
  flights.length = 0
  listeners = []
  narrator.playing = false
  narrator.current = null
  narrator.word = -1
  narrator.onEnd = null
  narrator.everUnlocked = true
  vi.clearAllMocks()
})

const tiles = () => screen.getAllByRole('button').filter((b) => b.classList.contains('tile'))

describe('PlaceScreen', () => {
  it('lays the four cards and the five landmarks out as a spread, each carrying a word', () => {
    render(<PlaceScreen slug="rajasthan" />)

    // Four cards, in the schema's own fixed order, then five landmarks in
    // the order the content lists them.
    expect(tiles().map((t) => t.textContent)).toEqual([
      'Animal', 'Food', 'Festival', 'Hello',
      // The tile shows `short`, the tile-length name — never `name`, which
      // is written to be accurate, not to fit 129.6px. See PlaceScreen.tsx's
      // own `Page.word`/`Page.alt` comment.
      ...rajasthan.landmarks.map((l) => l.short),
    ])

    // The rule the control bar is held to, held to here as well: a mark is
    // a landmark for finding the tile again, never its name.
    for (const tile of tiles()) expect(tile.textContent?.trim()).not.toBe('')
  })

  it('shows a real photograph on every landmark tile', () => {
    const { container } = render(<PlaceScreen slug="rajasthan" />)
    const images = [...container.querySelectorAll('.tile__photo img')]
    expect(images).toHaveLength(5)
    for (const [i, img] of images.entries()) {
      expect(img.getAttribute('src')).toContain(`photos/${rajasthan.landmarks[i].id}.jpg`)
    }
  })

  it('puts the licence credit BESIDE the photograph, not only on the colophon page', async () => {
    const user = userEvent.setup()
    const { container } = render(<PlaceScreen slug="rajasthan" />)
    await user.click(screen.getByRole('button', { name: /Hawa Mahal/ }))

    const by = container.querySelector('.place-photo__by')
    // Rendered verbatim from the generated attribution, markup and all —
    // `Credits.tsx` does the same and says why: rewriting a credit by hand
    // is how a credit goes wrong.
    expect(by?.innerHTML).toBe(CREDITS['rajasthan.hawa-mahal'].attributionHtml)
  })

  it('says the intro on arrival, and the tapped tile\'s own line after it', async () => {
    const user = userEvent.setup()
    render(<PlaceScreen slug="rajasthan" />)
    expect(played).toEqual(['audio/en/rajasthan.intro.m4a'])

    await user.click(screen.getByRole('button', { name: /Festival/ }))
    expect(played).toEqual([
      'audio/en/rajasthan.intro.m4a',
      'audio/en/rajasthan.card.festival.m4a',
    ])
  })

  it('fires a card\'s own sound before its words, and survives one that does not exist', async () => {
    const user = userEvent.setup()
    render(<PlaceScreen slug="rajasthan" />)
    // `camel` is one of the twelve sounds nobody has sourced yet. The engine
    // resolves a missing file to silence; the screen must not guard it a
    // second time, and must not skip the line because of it.
    await user.click(screen.getByRole('button', { name: /Animal/ }))
    expect(narrator.sfx).toHaveBeenCalledWith('camel')
    expect(played).toContain('audio/en/rajasthan.card.animal.m4a')
  })

  it('frames the arrival on the place\'s OWN size, not a flat constant', () => {
    render(<PlaceScreen slug="rajasthan" />)
    expect(flights).toHaveLength(1)
    expect(flights[0].bbox).toEqual(RAJASTHAN.bbox)
    // 16% of the longest side. A flat `PLACE_PADDING` of 40 is a seventh of
    // Rajasthan and three times Delhi — see ARRIVAL_MARGIN's own note.
    expect(flights[0].padding).toBeCloseTo(0.16 * Math.max(RAJASTHAN.bbox[2], RAJASTHAN.bbox[3]), 3)
  })

  it('gives a tiny place a frame proportional to itself, where the tour\'s recipe would not', () => {
    render(<PlaceScreen slug="delhi" />)
    // Delhi's own pinR is 16.1 and PLACE_PADDING is 40 — either one would
    // leave it a speck on its own page.
    expect(flights[0].padding).toBeLessThan(16)
  })

  it('plays the place\'s ambient bed, and stops it on the way out', () => {
    const { unmount } = render(<PlaceScreen slug="kerala" />)
    expect(ambient).toEqual(['forest'])
    unmount()
    expect(ambient).toEqual(['forest', null])
  })

  it('ticks a tile only once its line has actually been HEARD, never when it is tapped', async () => {
    const user = userEvent.setup()
    const { container } = render(<PlaceScreen slug="rajasthan" />)

    await user.click(screen.getByRole('button', { name: /Food/ }))
    expect(container.querySelector('.tile[data-heard]')).toBeNull()

    // `play()` resolved when the clip STARTED. Only a natural end counts.
    act(() => { narrator.finish() })
    const ticked = container.querySelectorAll('.tile[data-heard]')
    expect(ticked).toHaveLength(1)
    expect(within(ticked[0] as HTMLElement).getByText('Food')).toBeInTheDocument()
  })

  it('never leaves Play pressable and dead — it says the line again once it has ended', async () => {
    const user = userEvent.setup()
    render(<PlaceScreen slug="rajasthan" />)
    played.length = 0

    act(() => { narrator.finish() })
    await user.click(screen.getByRole('button', { name: /Play/ }))
    expect(played).toEqual(['audio/en/rajasthan.intro.m4a'])
  })

  it('makes Home a real navigation, which is what Controls has been waiting for', async () => {
    const user = userEvent.setup()
    const onHome = vi.fn()
    render(<PlaceScreen slug="rajasthan" onHome={onHome} />)
    await user.click(screen.getByRole('button', { name: /Home/ }))
    expect(narrator.stop).toHaveBeenCalled()
    expect(onHome).toHaveBeenCalled()
  })

  /**
   * `/place/:slug` is reachable with no gesture behind it at all — a deep
   * link, or a grown-up reloading the iPad mid-visit (App.tsx's own
   * comment says so explicitly). The bug this guards: the arrival effect
   * used to call `n.play()` unconditionally, which set the engine's
   * `playing` flag regardless of whether a real gesture had ever reached
   * WebKit — a Pause button over silence, "no control may be pressable and
   * produce no observable effect" broken in a new place. `everUnlocked`
   * starting false in this block, unlike every test above, is what makes
   * these tests actually cold.
   */
  describe('a state page opened cold, before any gesture has unlocked audio', () => {
    beforeEach(() => { narrator.everUnlocked = false })

    it('says nothing on arrival, and leaves Play showing — never a Pause button lying about it', () => {
      render(<PlaceScreen slug="rajasthan" />)
      expect(played).toEqual([])
      expect(narrator.play).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /Play/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument()
    })

    it('does not even ask for the ambient bed until unlocked', () => {
      render(<PlaceScreen slug="kerala" />)
      expect(ambient).toEqual([])
    })

    it('unlocks on the first tap of Play, and only then says the intro', async () => {
      const user = userEvent.setup()
      render(<PlaceScreen slug="rajasthan" />)
      await user.click(screen.getByRole('button', { name: /Play/ }))
      expect(narrator.unlock).toHaveBeenCalled()
      // The SAME effect that plays on a warm arrival re-runs once `unlocked`
      // flips — nothing here calls `play()` a second, different way.
      expect(played).toEqual(['audio/en/rajasthan.intro.m4a'])
    })

    it('unlocks on a tile tap too, and says THAT tile\'s own line, not the intro', async () => {
      const user = userEvent.setup()
      render(<PlaceScreen slug="rajasthan" />)
      await user.click(screen.getByRole('button', { name: /Festival/ }))
      expect(narrator.unlock).toHaveBeenCalled()
      expect(played).toEqual(['audio/en/rajasthan.card.festival.m4a'])
    })
  })

  /**
   * 32 of the 36 places have no page written, and beat 14 of the tour tells
   * every child to tap any state. A dead end there would break a promise
   * the narration makes out loud.
   */
  describe('a place with nothing written yet', () => {
    it('is a page, not an error, and offers the ones that do exist', () => {
      render(<PlaceScreen slug="gujarat" />)
      expect(screen.getByText(/We have not been to Gujarat yet/)).toBeInTheDocument()
      for (const name of ['Rajasthan', 'Kerala', 'Odisha', 'Delhi']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
    })

    it('still lights the state, still flies to it, and still has something to say', () => {
      render(<PlaceScreen slug="gujarat" />)
      expect(flights).toHaveLength(1)
      // A UI line already rendered, so the bar's Play and "Say it again"
      // both have something true to do — see `pages`' own note.
      expect(played).toEqual(['audio/en/ui.tap-state.m4a'])
    })

    it('has no shelf, because there is nothing on it', () => {
      const { container } = render(<PlaceScreen slug="gujarat" />)
      expect(container.querySelector('.place-shelf')).toBeNull()
    })
  })
})
