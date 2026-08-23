import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { TourStage } from './TourStage'
import { subjectOf } from './effects/subject'
import type { Cue } from '../types'
import geo from '../data/geo.json'

/**
 * The double must be FAITHFUL to the real engine's interface — the plan-wide
 * rule established in Task 4. TourStage touches `onCue` (settable, set
 * once), `sfx` (fire-and-forget) and, since Task 5, `scheduleAfter` — it
 * hands the last one straight to `MediaClockProvider`, and every art cue
 * this file fires for real (via the real `dispatch`) mounts a `Reveal` that
 * calls it. Anything less on any of the three would let production code get
 * bent around a gap the same way Task 4's first double did.
 *
 * `scheduleAfter` itself only has to be a real, cancellable clock — none of
 * this file's own tests are about rate or pause (that is `Reveal.test.tsx`'s
 * job, against the real `Narrator`), so a plain wall-clock timer is a
 * faithful enough stand-in for what THIS double is asked to do.
 *
 * `vi.mock` is hoisted above every import by vitest's transform, so this
 * still applies to the `TourStage` imported above.
 */
const narrator = {
  onCue: (() => {}) as (cue: Cue) => void,
  sfx: vi.fn(async () => {}),
  scheduleAfter: vi.fn((seconds: number, cb: () => void) => {
    const t = setTimeout(cb, seconds * 1000)
    return () => clearTimeout(t)
  }),
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
    // A tap: pointerdown then pointerup, same pointer, same spot — not
    // pointerdown alone, which no longer picks anything on its own (see
    // `isTap` in `hitLayer.ts`).
    fireEvent.pointerDown(kerala, { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(kerala, { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 })
    expect(onPickState).toHaveBeenCalledWith('kerala')
  })

  it('does not crash when a state is tapped and no onPickState was given', () => {
    const { container } = render(<TourStage />)
    const kerala = container.querySelector('[data-slug="kerala"]')!
    expect(() => {
      fireEvent.pointerDown(kerala, { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 })
      fireEvent.pointerUp(kerala, { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 })
    }).not.toThrow()
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
 * The read-along strip's one job: paint itself in the same colour as
 * whatever is currently on stage, so a child who cannot yet read fluently
 * can see that the picture and the sentence about it are the same thing —
 * daylight's one genuinely original idea, grafted onto the picture-book
 * direction the father chose. `TourStage` is the only place `--subject-
 * accent` is set (see its own `subjectVars`); `grandTour.css`'s `.say`
 * reads it by inheritance, which jsdom cannot lay out or paint — so this
 * checks the data actually reaching the DOM (the custom property's value),
 * never the rendered appearance itself.
 */
describe("the read-along strip's colour", () => {
  const accentOf = (container: HTMLElement) =>
    (container.querySelector('.tour-stage') as HTMLElement).style.getPropertyValue('--subject-accent')

  it('writes --subject-accent from the subject prop', () => {
    const { container } = render(<TourStage subject="tiger" />)
    expect(accentOf(container)).toBe(subjectOf('tiger').accent)
  })

  it('falls back to the default accent when nothing is showing', () => {
    const { container } = render(<TourStage subject={null} />)
    expect(accentOf(container)).toBe(subjectOf(null).accent)
  })

  it('updates when the subject on stage changes mid-tour', () => {
    const { container, rerender } = render(<TourStage subject="tiger" />)
    expect(accentOf(container)).toBe(subjectOf('tiger').accent)
    rerender(<TourStage subject="lotus" />)
    expect(accentOf(container)).toBe(subjectOf('lotus').accent)
    // And the two must actually differ, or the assertions above would pass
    // even if the value never changed at all.
    expect(subjectOf('tiger').accent).not.toBe(subjectOf('lotus').accent)
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

/**
 * The framing rule in tourStage.css (`.tour-stage > .map, .tour-stage >
 * .tour-overlay`) consumes `--map-floor` and `--map-ceiling`. Task 4
 * originally defined both — and `--say-lane`, which they are built from —
 * only inside grandTour.css's `.india`, a stylesheet only GrandTour.tsx
 * imports. Plan 3's 32 state screens frame a map too, and none of them is
 * GrandTour: without a shared definition, `--map-floor` is undefined on
 * their `.india`, the `inset` shorthand that consumes it is invalid, and the
 * whole declaration drops — `.map`/`.tour-overlay` fall back to `position:
 * absolute` with no offsets at all, which is not "smaller", it is gone.
 *
 * jsdom does no layout and cannot compute custom properties reliably, so
 * this is a check on the stylesheets' own text rather than on rendered
 * boxes — the same technique MapStage.test.tsx already uses to police the
 * "no SVG filter" rule. It still catches the real regression: written
 * against the pre-fix tree (the variables only in grandTour.css, the
 * `inset` line with no fallback on `--map-floor`), both of these failed.
 */
describe('the map-framing convention is inheritable, not tour-only', () => {
  it('defines the frame variables where a non-tour screen can reach them', () => {
    // Not grandTour.css: a screen that never mounts GrandTour never loads
    // that file, so a definition living only there is invisible to it.
    const base = readFileSync('src/styles/base.css', 'utf8')
    for (const name of ['--map-floor', '--map-ceiling', '--say-lane']) {
      expect(base, `${name} must be defined in base.css, not only in grandTour.css`)
        .toMatch(new RegExp(`${name}\\s*:`))
    }
  })

  it('gives the framing rule a fallback for every custom property it consumes', () => {
    // Defense in depth even once the variables above are shared: a rule
    // that still collapses the instant ONE of its inputs goes missing was
    // exactly Task 4's original mistake (an asymmetric fallback on
    // `--map-ceiling` but none on `--map-floor`, even though the `inset`
    // shorthand is equally invalid either way).
    const css = readFileSync('src/tour/tourStage.css', 'utf8')
    const rule = /\.tour-stage > \.map,\s*\.tour-stage > \.tour-overlay\s*\{[^}]*\}/.exec(css)?.[0]
    expect(rule, 'the framing rule for .map and .tour-overlay must exist').toBeTruthy()
    for (const name of ['--map-ceiling', '--map-floor']) {
      expect(rule, `var(${name}) inside the framing rule must carry a fallback value`)
        .toMatch(new RegExp(`var\\(\\s*${name}\\s*,`))
    }
  })
})
