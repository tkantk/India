import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { IndiaScreen } from './IndiaScreen'
import geo from '../data/geo.json'
import type { Clip, Cue } from '../types'

/**
 * The engine, faithfully — same rule as everywhere else in this plan, even
 * though this file is about layout: an incomplete double lets production code
 * grow a fallback that only the double needs. Nothing here drives the tour;
 * it only has to mount.
 */
const narrator = {
  playing: false,
  stuck: false,
  onCue: (() => {}) as (cue: Cue) => void,
  onEnd: null as (() => void) | null,
  play: vi.fn(async (_clip: Clip) => {}),
  pause: vi.fn(), resume: vi.fn(), replay: vi.fn(), stop: vi.fn(),
  prefetch: vi.fn(async (_clips: Clip[]) => {}), evict: vi.fn((_clips: Clip[]) => {}),
  sfx: vi.fn(async () => {}), ambient: vi.fn(async () => {}),
  setRate: vi.fn(), setVolume: vi.fn(),
  resumeContext: vi.fn(async () => true),
  subscribe: (_fn: () => void) => () => {},
  getSnapshot: () => -1,
}
vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

const mount = () => render(<IndiaScreen />)

describe('IndiaScreen', () => {
  it('is the map, the peacock, one enormous button and the control bar', () => {
    const { container } = mount()
    expect(container.querySelector('.map')).toBeTruthy()
    expect(container.querySelector('.mor')).toBeTruthy()
    expect(screen.getByRole('button', { name: /show me india/i })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: /controls/i })).toBeInTheDocument()
  })

  it('keeps a heading for a screen reader without spending screen on it', () => {
    mount()
    // A page needs one. A child watching a narrated map does not need to be
    // told in 32px type what they are looking at.
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('visually-hidden')
  })

  it('shows the CC BY credit the boundary data legally requires', () => {
    mount()
    expect(screen.getByText(geo.attribution)).toBeVisible()
  })

  /**
   * PLAN 5 TASK 3: THE NIGHT STAYS ON THE GATE.
   *
   * This is the map's OWN idle screen — "Show me India", the big button back,
   * nothing playing — the same rest state `end()` returns to once the tour
   * finishes (GrandTour.test.tsx's own lit-gate suite covers that path,
   * mid-beat and finished). Neither of festival's lit-cover pieces is wired
   * to this component at all, so their absence in the DOM is true by
   * construction; asserting it anyway is what stops a future change that
   * imports `startGate.css` here — or copies `.gate__toran` onto this
   * screen "because it looked nice" — from landing unnoticed.
   */
  it('is never lit: no garland, no diyas, on the map\'s own rest screen', () => {
    const { container } = mount()
    expect(container.querySelector('.gate__toran')).toBeNull()
    expect(container.querySelector('.gate__diyas')).toBeNull()
  })

  /**
   * THE MECHANISM, NOT JUST THE SYMPTOM. Task 3's failure mode is the night
   * leaking through a TOKEN or an INHERITED RULE rather than through a
   * misplaced component — the kind of regression that would not show up as
   * a missing `.gate__toran` anywhere, only as `--gate-night` suddenly
   * resolving somewhere it should not. Every `--gate-*` custom property is
   * declared once, inside `.gate {}` in startGate.css (see that file's own
   * banner and StartGate.test.tsx's matching test); this is the other half
   * of the same guarantee — that nothing the tour actually loads ever
   * references one. `grandTour.css` and `tourStage.css` are read directly
   * because a source check is the only one that CAN catch this: jsdom does
   * not resolve cascaded custom-property values the way a real browser
   * does, so a render-level assertion here would prove nothing.
   */
  it('never references a --gate- token from any stylesheet the tour actually loads', () => {
    for (const path of ['src/tour/grandTour.css', 'src/tour/tourStage.css', 'src/map/map.css']) {
      const css = readFileSync(path, 'utf8')
      expect(css, `${path} must not reference a --gate- token`).not.toMatch(/--gate-/)
    }
    // And base.css — :root and body — must be exactly what it was before
    // this task: no new token, no repainted body.
    const base = readFileSync('src/styles/base.css', 'utf8')
    expect(base, 'base.css must not declare a --gate- token').not.toMatch(/--gate-/)
    expect(base).toMatch(/body\s*\{[^}]*background:\s*var\(--page\)/s)
  })
})

/*
 * WHY THERE ARE NO LAYOUT TESTS IN THIS FILE.
 *
 * There were six, and every one of them was a regex over a stylesheet: "does
 * Controls.css contain `flex-wrap: wrap` inside a max-width query". They
 * would have broken on a rename and could not have failed on an actual
 * collision, because jsdom does no layout at all — no box has a size here, so
 * "the bar overflows a 390px phone by 73px" is not a statement this
 * environment can evaluate.
 *
 * The real check is `npm run tour:strip`, which builds the app, serves it,
 * and measures it in Chrome at 390x844, 375x812, 768x1024 and 1024x768: bar
 * overflow, every control's box against the 104px floor, the licence credit
 * against the bar and against the play button, the read-along against Mor and
 * the credit, whether the page scrolls, and — with `elementFromPoint` — what a
 * finger actually reaches through Mor and through the words. It exits
 * non-zero if any of it is wrong, and it writes build/tour-layout.json.
 */
