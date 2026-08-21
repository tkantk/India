import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

const mount = () => render(<MemoryRouter><IndiaScreen /></MemoryRouter>)

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
})

/**
 * The three collisions the earlier tasks measured in a real browser and left
 * for this one. jsdom does no layout, so these cannot be checked by rendering
 * — they are checked as what they are, declarations in a stylesheet, and then
 * measured for real by `npm run tour:strip`, which photographs the app at a
 * phone and two iPad viewports and writes the overlaps to
 * build/tour-layout.json.
 */
const css = (path: string) => readFileSync(path, 'utf8')
const controls = css('src/ui/Controls.css')
const tour = css('src/tour/grandTour.css')
const map = css('src/map/map.css')

describe('the control bar fits a phone', () => {
  it('publishes its own height, so anything under it can leave room', () => {
    expect(controls).toMatch(/--bar:\s*calc\(/)
    expect(controls).toMatch(/--bar-rows:\s*1/)
  })

  it('wraps to a second row rather than shrinking a 104px target', () => {
    // Five 104px targets plus the 56px gutter need 592px. A 390px phone
    // overflowed by 73px with Play and Home cut off the ends. The target size
    // is the researched figure for a child under nine and does not move.
    expect(controls).toMatch(/@media \(max-width: 600px\)[\s\S]*?--bar-rows:\s*2/)
    expect(controls).toMatch(/@media \(max-width: 600px\)[\s\S]*?flex-wrap:\s*wrap/)
    expect(controls).not.toMatch(/--tap:\s*/)
  })

  it('puts play, again and home on the row nearest the thumb', () => {
    const wrap = /@media \(max-width: 600px\)\s*\{[\s\S]*?\n\}/g
    const blocks = controls.match(wrap)?.join('\n') ?? ''
    expect(blocks).toMatch(/nth-child\(5\)\s*\{\s*order:\s*3/)  // home moves up
    expect(blocks).toMatch(/nth-child\(3\)\s*\{\s*order:\s*4/)  // slower moves down
  })
})

describe('nothing hides behind the control bar', () => {
  it('stands Mor clear of it, through the knob mor.css shipped for this', () => {
    expect(tour).toMatch(/--mor-floor:\s*calc\(var\(--bar-over\)/)
    // And clear of the play button too, on the phone where the two collide.
    expect(tour).toMatch(/@media \(max-width: 600px\)[\s\S]*?--mor-floor:[^;]*var\(--play\)/)
  })

  it('lifts the licence credit off the floor, because a hidden credit is not a credit', () => {
    expect(map).toMatch(/\.map \.credit \{[\s\S]*?bottom:\s*var\(--credit-floor, 0px\)/)
    expect(tour).toMatch(/--credit-floor:\s*calc\(var\(--bar-over\)/)
  })

  it('measures the bar against the box it actually overlaps', () => {
    // `.controls` is fixed to the viewport; body already carries the bottom
    // safe-area inset as padding, so the stage stops short of the viewport by
    // exactly that much. Reserving the full bar height inside the stage would
    // reserve a home indicator's worth of nothing.
    expect(tour).toMatch(/--bar-over:\s*calc\(var\(--bar\) - env\(safe-area-inset-bottom, 0px\)\)/)
  })
})

describe('the play button', () => {
  it('is at least twice a tap target, and says a word', () => {
    expect(tour).toMatch(/--play:\s*calc\(var\(--tap\) \* 2\)/)
    expect(tour).toMatch(/\.tap\.play-big \{[\s\S]*?min-height:\s*var\(--play\)/)
    mount()
    expect(screen.getByRole('button', { name: /show me india/i }).className).toContain('tap')
  })
})
