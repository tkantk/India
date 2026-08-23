import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { GrandTour } from './GrandTour'
import { HOLD } from './effects/Reveal'
import { STAGGER_MS } from '../map/useMapNodes'
import geo from '../data/geo.json'
import type { Clip, Cue } from '../types'

/**
 * The tour against the REAL cue registry and the REAL map.
 *
 * `GrandTour.test.tsx` mocks `./cues`, which is right for asking "was every
 * cue dispatched exactly once" — but it means no cue in that file ever
 * actually lights a state, and the thing this file exists to check is what
 * the map looks like a few seconds after one did.
 *
 * A HIGHLIGHT IS A WAVE THAT PASSES. Watching the whole tour in Chrome, the
 * first version of this lit 28 states at beat 3 and 8 union territories at
 * beat 4 and never let go of either: from beat 3 to the end the map was one
 * saffron silhouette with no boundaries in it. Nothing in `useMapNodes` or
 * `cues.ts` can fix that — `highlight` has no duration and `dispatch` fires
 * and forgets — so the release lives in the sequencer, and this is what
 * holds it there.
 */
const played: string[] = []
let listeners: (() => void)[] = []
let ending: ReturnType<typeof setTimeout> | null = null

const narrator = {
  playing: false,
  stuck: false,
  word: -1,
  current: null as Clip | null,
  onCue: (() => {}) as (cue: Cue) => void,
  onEnd: null as (() => void) | null,
  play: vi.fn(async (clip: Clip) => {
    narrator.cut()
    played.push(clip.audio)
    narrator.current = clip
    narrator.playing = true
    narrator.emit()
  }),
  /** The clip reaches its natural end. Cues are fired by the test, one at a
   *  time, the way the audio clock does. */
  finish() {
    const clip = narrator.current
    if (!clip) return
    narrator.cut()
    narrator.playing = false
    narrator.word = -1
    narrator.emit()
    narrator.onEnd?.()
  },
  cut() { if (ending) clearTimeout(ending); ending = null },
  pause: vi.fn(), resume: vi.fn(), replay: vi.fn(),
  stop: vi.fn(() => { narrator.playing = false; narrator.emit() }),
  prefetch: vi.fn(async (_clips: Clip[]) => {}),
  evict: vi.fn((_clips: Clip[]) => {}),
  sfx: vi.fn(async () => {}), ambient: vi.fn(async () => {}),
  setRate: vi.fn(), setVolume: vi.fn(),
  resumeContext: vi.fn(async () => true),
  subscribe: (fn: () => void) => {
    listeners.push(fn)
    return () => { listeners = listeners.filter((l) => l !== fn) }
  },
  getSnapshot: () => narrator.word,
  emit: () => { for (const fn of [...listeners]) fn() },
}
vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

const STATES = Object.values(geo.places).filter((p) => p.type === 'state').length
const UTS = Object.values(geo.places).filter((p) => p.type === 'ut').length

beforeEach(() => {
  played.length = 0
  listeners = []
  narrator.cut()
  narrator.current = null
  narrator.playing = false
  narrator.onEnd = null
  narrator.onCue = () => {}
  vi.clearAllMocks()
})
afterEach(() => { narrator.cut() })

const mount = (props: Record<string, unknown> = {}) => render(<GrandTour {...props} />)

const cue = (verb: string, arg?: string): Cue => ({ t: 0, word: 0, do: verb, arg })

describe('the map lights up and lets go again', () => {
  it('lights all twenty-eight states, then releases them', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { container } = mount()
      const lit = () => container.querySelectorAll('.base path.lit').length

      act(() => { narrator.onCue(cue('highlightAllStates')) })
      // The wave is staggered, so it arrives over about two seconds.
      act(() => { vi.advanceTimersByTime(STATES * STAGGER_MS + 50) })
      expect(lit()).toBe(STATES)

      // And then it passes. Nothing in the registry or the node cache would
      // ever do this on its own. The life is the whole wave plus the counter
      // that accompanies it, so the emphasis arrives and leaves as one
      // gesture — see HIGHLIGHT_MS.
      act(() => { vi.advanceTimersByTime(36 * STAGGER_MS + HOLD.counter + 100) })
      expect(lit()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lights the union territories the same way, and lets those go too', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { container } = mount()
      const lit = () => container.querySelectorAll('.base path.lit').length
      act(() => { narrator.onCue(cue('highlightUnionTerritories')) })
      act(() => { vi.advanceTimersByTime(UTS * STAGGER_MS + 50) })
      expect(lit()).toBe(UTS)
      act(() => { vi.advanceTimersByTime(36 * STAGGER_MS + HOLD.counter + 100) })
      expect(lit()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts every beat on a map with nothing left lit on it', async () => {
    // The backstop, and the one the whole strip turned on: beat 3 lights the
    // states, beat 4 lights the union territories, and by beat 5 — which
    // flies to Delhi — the map must be the map again.
    const { container } = mount({ autoStart: true })
    const lit = () => container.querySelectorAll('.base path.lit').length
    await waitFor(() => expect(played).toHaveLength(1))

    act(() => { narrator.onCue(cue('highlightAllStates')) })
    expect(lit()).toBeGreaterThan(0)

    await act(async () => { narrator.finish() })
    await waitFor(() => expect(played).toHaveLength(2))
    expect(lit()).toBe(0)
  })

  it('leaves nothing lit once the tour has let go of the child', async () => {
    const { container } = mount({ autoStart: true })
    const lit = () => container.querySelectorAll('.base path.lit').length
    await waitFor(() => expect(played).toHaveLength(1))
    act(() => { narrator.onCue(cue('highlightAllStates')) })
    expect(lit()).toBeGreaterThan(0)

    // A tap on a state ends the tour and flies there. Exactly one place stays
    // lit: the one the child pointed at. A real tap: pointerdown then
    // pointerup, same pointer, same spot (`isTap` in `hitLayer.ts`) — a bare
    // pointerdown, which is all this used to take, is now a gesture with no
    // matching pointerup, and would never pick anything.
    const kerala = container.querySelector('[data-testid="state-kerala"]')!
    await act(async () => {
      kerala.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }))
      kerala.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }))
    })
    expect(lit()).toBe(1)
    expect(container.querySelector('[data-slug="kerala"]')!.classList.contains('lit')).toBe(true)
  })
})
