import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PassportScreen } from './PassportScreen'
import { addStamp, resetPassportForTests } from '../passport/passport'
import geo from '../data/geo.json'
import type { Clip } from '../types'

/**
 * A FAITHFUL DOUBLE, modelled on PlaceScreen.test.tsx's rather than stubbed
 * to the minimum: `play()` resolves when a clip STARTS, `onEnd` fires only
 * at a natural end (`finish()`), `everUnlocked` only flips through
 * `unlock()`, and the bar's reactive reads (`loading`, `canReplay`) behave
 * like the real engine's.
 */
const played: string[] = []
let listeners: (() => void)[] = []
const narrator = {
  playing: false,
  stuck: false,
  loading: false,
  word: -1,
  everUnlocked: true,
  onEnd: null as (() => void) | null,
  current: null as Clip | null,
  get canReplay() { return narrator.current !== null },
  play: vi.fn(async (clip: Clip) => {
    played.push(clip.audio)
    narrator.playing = true
    narrator.current = clip
    narrator.emit()
  }),
  finish() {
    narrator.playing = false
    narrator.emit()
    narrator.onEnd?.()
  },
  pause: vi.fn(() => { narrator.playing = false; narrator.emit() }),
  resume: vi.fn(),
  replay: vi.fn(),
  stop: vi.fn(() => { narrator.playing = false; narrator.current = null; narrator.emit() }),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  resumeContext: vi.fn(async () => true),
  unlock: vi.fn(async () => { narrator.everUnlocked = true; narrator.emit() }),
  subscribe: (fn: () => void) => {
    listeners.push(fn)
    return () => { listeners = listeners.filter((l) => l !== fn) }
  },
  getSnapshot: () => narrator.word,
  emit() { for (const fn of [...listeners]) fn() },
}
vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

const PLACES = Object.keys(geo.places)

beforeEach(() => {
  played.length = 0
  listeners = []
  narrator.playing = false
  narrator.current = null
  narrator.onEnd = null
  narrator.everUnlocked = true
  localStorage.clear()
  resetPassportForTests()
  vi.clearAllMocks()
})

const slots = () => PLACES.map((slug) => screen.getByTestId(`passport-${slug}`))

describe('PassportScreen', () => {
  it('has a slot for every one of the 36 places the map draws', () => {
    render(<PassportScreen />)
    expect(PLACES).toHaveLength(36)
    expect(slots()).toHaveLength(36)
  })

  it('every slot is a real button carrying the place\'s name as a word', () => {
    render(<PassportScreen />)
    for (const slot of slots()) {
      expect(slot.tagName).toBe('BUTTON')
      expect(slot.classList.contains('tap')).toBe(true)
      expect(slot.querySelector('.passport__name')?.textContent?.trim()).toBeTruthy()
    }
  })

  describe('empty, on a first visit', () => {
    it('says so, rather than congratulating a child on nothing', () => {
      render(<PassportScreen />)
      expect(screen.getByTestId('passport-count').textContent).toBe('No stamps yet')
      expect(played).toEqual(['audio/en/ui.passport-hint.m4a'])
    })

    it('marks no slot as stamped', () => {
      render(<PassportScreen />)
      expect(slots().filter((s) => s.hasAttribute('data-stamped'))).toHaveLength(0)
    })
  })

  describe('with stamps', () => {
    it('counts them, and says "look how far you have gone"', () => {
      addStamp('kerala')
      addStamp('odisha')
      addStamp('assam')
      render(<PassportScreen />)
      expect(screen.getByTestId('passport-count').textContent).toBe('You have explored 3 of 36!')
      expect(played).toEqual(['audio/en/ui.passport.m4a'])
    })

    it('stamps exactly the places that were finished', () => {
      addStamp('kerala')
      addStamp('ladakh')
      render(<PassportScreen />)
      const stamped = slots().filter((s) => s.hasAttribute('data-stamped')).map((s) => s.dataset.testid)
      expect(stamped.sort()).toEqual(['passport-kerala', 'passport-ladakh'])
      expect(screen.getByTestId('passport-kerala').getAttribute('aria-label')).toBe('Kerala, stamped')
    })

    it('ignores a stamp for a place this map does not have', () => {
      addStamp('atlantis')
      addStamp('kerala')
      render(<PassportScreen />)
      expect(screen.getByTestId('passport-count').textContent).toBe('You have explored 1 of 36!')
    })
  })

  it('keeps every slot in the same place whatever has been stamped', () => {
    // Fixed, alphabetical slots: a sticker album, not a leaderboard. If
    // earned stamps jumped to the front, "where Kerala goes" would move
    // every time the child came back.
    const order = () => [...document.querySelectorAll('.passport__slot')].map((s) => (s as HTMLElement).dataset.testid)
    const { unmount } = render(<PassportScreen />)
    const empty = order()
    unmount()
    addStamp('west-bengal')
    addStamp('andaman-nicobar')
    render(<PassportScreen />)
    expect(order()).toEqual(empty)
    // And the stamped ones did NOT move to the front.
    expect(order()[0]).not.toBe('passport-west-bengal')
  })

  it('every slot is a door: tapping one — stamped or not — goes to that place', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    addStamp('kerala')
    render(<PassportScreen onPick={onPick} />)
    await user.click(screen.getByTestId('passport-kerala'))
    await user.click(screen.getByTestId('passport-goa'))
    expect(onPick.mock.calls).toEqual([['kerala'], ['goa']])
    // Leaving must not leave the passport line talking over the next screen.
    expect(narrator.stop).toHaveBeenCalled()
  })

  it('has a way home', async () => {
    const user = userEvent.setup()
    const onHome = vi.fn()
    render(<PassportScreen onHome={onHome} />)
    await user.click(screen.getByRole('button', { name: /home/i }))
    expect(onHome).toHaveBeenCalledTimes(1)
  })

  describe('opened cold, before any gesture has unlocked audio', () => {
    beforeEach(() => { narrator.everUnlocked = false })

    it('stays quiet until the child taps, then speaks', async () => {
      const user = userEvent.setup()
      render(<PassportScreen />)
      expect(played).toEqual([])
      await user.click(screen.getByRole('button', { name: /play/i }))
      expect(narrator.unlock).toHaveBeenCalled()
      expect(played).toEqual(['audio/en/ui.passport-hint.m4a'])
    })
  })

  it('Play says the line again once it has finished — never a dead button', async () => {
    const user = userEvent.setup()
    render(<PassportScreen />)
    act(() => { narrator.finish() })
    await user.click(screen.getByRole('button', { name: /play/i }))
    expect(played).toEqual(['audio/en/ui.passport-hint.m4a', 'audio/en/ui.passport-hint.m4a'])
  })
})
