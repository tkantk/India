import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { TourStage } from './TourStage'
import type { Cue } from '../types'
import geo from '../data/geo.json'

/**
 * The double must be FAITHFUL to the real engine's interface — the plan-wide
 * rule established in Task 4. TourStage only ever touches `onCue` (settable,
 * set once) and `sfx` (fire-and-forget), so that is all the double needs;
 * anything less on either of those two would let production code get bent
 * around a gap the same way Task 4's first double did.
 *
 * `vi.mock` is hoisted above every import by vitest's transform, so this
 * still applies to the `TourStage` imported above.
 */
const narrator = {
  onCue: (() => {}) as (cue: Cue) => void,
  sfx: vi.fn(async () => {}),
}
vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

describe('TourStage', () => {
  it('renders the real map — this is the first place in the app that does', () => {
    const { container } = render(<TourStage />)
    expect(container.querySelector('.map')).toBeTruthy()
    expect(container.querySelectorAll('.base path[data-slug]')).toHaveLength(36)
  })

  it('wires the engine cues to the real map, so a real cue lights a real state', () => {
    const { container } = render(<TourStage />)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'highlightState', arg: 'kerala' }) })
    const kerala = container.querySelector('[data-slug="kerala"]')
    expect(kerala?.classList.contains('lit')).toBe(true)
  })

  it('routes an art verb through setOverlay and onto the page', () => {
    const { container } = render(<TourStage />)
    expect(container.querySelector('.tour-overlay')).toBeNull()
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger' }) })
    expect(container.querySelector('.tour-overlay')).toBeTruthy()
    expect(container.querySelector('[data-verb="revealSymbol"]')?.getAttribute('data-arg')).toBe('tiger')
  })

  it('flies the real camera when zoomTo fires', () => {
    const { container } = render(<TourStage />)
    const before = container.querySelector('svg.base')!.getAttribute('viewBox')
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }) })
    const after = container.querySelector('svg.base')!.getAttribute('viewBox')
    expect(after).not.toBe(before)
    // Every layer moves together, or the hit layer goes dead the moment a
    // child zooms in — Task 6's whole point.
    expect(container.querySelector('svg.hit')!.getAttribute('viewBox')).toBe(after)
  })

  it('fires the engine sfx for playSfx, and never throws even if it rejects', () => {
    narrator.sfx.mockRejectedValueOnce(new Error('closed context'))
    render(<TourStage />)
    expect(() => {
      act(() => { narrator.onCue({ t: 0, word: 0, do: 'playSfx', arg: 'peacock-call' }) })
    }).not.toThrow()
    expect(narrator.sfx).toHaveBeenCalledWith('peacock-call')
  })

  it('ignores an unknown verb rather than crashing the tour', () => {
    render(<TourStage />)
    expect(() => {
      act(() => { narrator.onCue({ t: 0, word: 0, do: 'wobble' }) })
    }).not.toThrow()
  })

  it('forwards a tap on a state to onPickState', () => {
    const onPickState = vi.fn()
    const { container } = render(<TourStage onPickState={onPickState} />)
    const kerala = container.querySelector('[data-slug="kerala"]')!
    fireEvent.pointerDown(kerala, { bubbles: true })
    expect(onPickState).toHaveBeenCalledWith('kerala')
  })

  it('does not crash when a state is tapped and no onPickState was given', () => {
    const { container } = render(<TourStage />)
    const kerala = container.querySelector('[data-slug="kerala"]')!
    expect(() => fireEvent.pointerDown(kerala, { bubbles: true })).not.toThrow()
  })

  it('sweeps the stage when the scene changes, so art cannot bleed into the next beat', async () => {
    // Every effect dismisses itself, and the holds deliberately outrun the
    // gap between cues so nothing flickers — but HOLD.script is 8s and beat
    // 13's last greeting fires 3.3s before the beat ends, so beat 14's "now
    // it is your turn, tap any state" was delivered with the greetings card
    // sitting over the map.
    const { container, rerender } = render(<TourStage scene="tour.13" />)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger' }) })
    expect(container.querySelector('.tour-overlay')).toBeTruthy()

    rerender(<TourStage scene="tour.14" />)
    // A fade, not a cut: it is still there, on its way out.
    expect(container.querySelector('.tour-overlay')?.getAttribute('data-sweeping')).toBe('true')
    await waitFor(() => expect(container.querySelector('.tour-overlay')).toBeNull())
  })

  it('lets a new picture cancel a sweep, so a beat never eats its own first cue', async () => {
    const { container, rerender } = render(<TourStage scene="tour.13" />)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger' }) })
    rerender(<TourStage scene="tour.14" />)
    // Beat 6's flag lands 663 ms in, which is inside the sweep.
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'unfurlFlag' }) })
    expect(container.querySelector('.tour-overlay')?.getAttribute('data-sweeping')).toBeNull()
    await new Promise((r) => setTimeout(r, 500))
    expect(container.querySelector('[data-verb="unfurlFlag"]')).toBeTruthy()
  })

  it('hands the engine back to a no-op on unmount, so a stray cue is inert', () => {
    const { container, unmount } = render(<TourStage />)
    const wired = narrator.onCue
    unmount()
    expect(narrator.onCue).not.toBe(wired)
    expect(() => narrator.onCue({ t: 0, word: 0, do: 'highlightState', arg: 'kerala' })).not.toThrow()
    // And, since nothing is mounted any more, nothing in this now-detached
    // container changed either.
    expect(container.querySelector('[data-slug="kerala"].lit')).toBeNull()
  })

  it('derives the highlighted 28 states straight from the real map data', () => {
    const { container } = render(<TourStage />)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'highlightAllStates' }) })
    const states = Object.entries(geo.places).filter(([, p]) => p.type === 'state')
    // The wave is staggered; the first entry lands synchronously.
    const [firstSlug] = states[0]
    expect(container.querySelector(`[data-slug="${firstSlug}"]`)?.classList.contains('lit')).toBe(true)
  })
})

/**
 * The art that is drawn in the map's own coordinates — the outline, the
 * Ganga, the Himalaya, the three seas — has to be drawn in the rect the
 * camera is ACTUALLY showing, not in the rect the map started at.
 *
 * `tour.json` reaches `zoomTo delhi` at beat 5 and never comes home, so every
 * layer after it (the river at beat 10, the mountains at 11, the seas at 12)
 * is drawn while the camera is somewhere else. Sequencing the content around
 * that is an unenforced invariant; this is the enforcement.
 */
describe('map-registered art and the camera', () => {
  const viewOf = (el: Element | null) => el?.getAttribute('viewBox')

  it('draws a layer in the rect the camera is showing, not the one it started at', () => {
    const { container } = render(<TourStage />)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }) })
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'traceRiver', arg: 'ganga' }) })
    expect(viewOf(container.querySelector('.cue-map')))
      .toBe(viewOf(container.querySelector('svg.base')))
  })

  it('keeps a traced line the same weight on screen however far in the camera is', () => {
    // The river's COURSE is geography and grows with the map; the width of
    // the line drawing it is not. Un-scaled, the 16-unit casing is a sixth of
    // the screen at Delhi — the same failure map.css spends a paragraph on
    // for the state borders.
    const { container } = render(<TourStage />)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'traceRiver', arg: 'ganga' }) })
    const width = () => Number(container.querySelector('.cue-map path')!.getAttribute('stroke-width'))
    const home = width()
    expect(home).toBeGreaterThan(0)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }) })
    const [, , w] = container.querySelector('svg.base')!.getAttribute('viewBox')!.split(' ').map(Number)
    expect(width()).toBeCloseTo((home * w) / geo.viewBox[2], 4)
  })

  it('follows the camera that moves while the art is already on stage', () => {
    const { container } = render(<TourStage />)
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'raiseMountains' }) })
    const home = viewOf(container.querySelector('.cue-map'))
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }) })
    const now = viewOf(container.querySelector('.cue-map'))
    expect(now).not.toBe(home)
    expect(now).toBe(viewOf(container.querySelector('svg.base')))
  })
})
