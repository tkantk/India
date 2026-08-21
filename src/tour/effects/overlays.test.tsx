import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { OVERLAYS } from '../overlays'
import { GREETINGS } from './Script'
import { GANGA, PEAKS } from './art/geo'
import vocab from '../../../content/vocab.json'
import geo from '../../data/geo.json'

/**
 * The contract that content can never name art nobody drew.
 *
 * `cues.ts` looks a renderer up here by verb and hands whatever comes back to
 * `setOverlay`; `vocab.json` is the list of arguments the content is allowed
 * to use. Everything below walks that list and insists something real comes
 * out — real meaning "an SVG with shapes in it", not a labelled box.
 */
const draw = (verb: string, arg?: string) => render(<>{OVERLAYS[verb](arg)}</>)

describe('the overlay registry', () => {
  it('has a renderer for every verb that needs art', () => {
    for (const verb of ['revealSymbol', 'unfurlFlag', 'countTo', 'traceRiver', 'raiseMountains', 'showScript']) {
      expect(OVERLAYS[verb], `no renderer for "${verb}"`).toBeTypeOf('function')
    }
  })

  it('draws real art for every symbol the content may name', () => {
    for (const symbol of vocab.revealSymbol) {
      const { container, unmount } = draw('revealSymbol', symbol)
      expect(container.querySelector('svg'), `${symbol} drew nothing`).toBeTruthy()
      unmount()
    }
  })

  it('draws real art for every greeting, in its own script', () => {
    for (const greeting of vocab.showScript) {
      const { container, unmount } = draw('showScript', greeting)
      const native = GREETINGS[greeting]?.native
      expect(native, `${greeting} has no script`).toBeTruthy()
      // The one being said now, not merely somewhere on the card: all three
      // greetings are always on it.
      const now = container.querySelector('.cue-greeting.is-now')
      expect(now?.textContent, `${greeting} was not the one brought forward`).toContain(native)
      unmount()
    }
  })

  it('draws every declared river', () => {
    for (const river of vocab.rivers) {
      const { container, unmount } = draw('traceRiver', river)
      expect(container.querySelector('path'), `${river} drew nothing`).toBeTruthy()
      unmount()
    }
  })

  it('draws the flag with the twenty-four spokes the narrator counts', () => {
    const { container } = draw('unfurlFlag')
    expect(container.querySelectorAll('.chakra-spoke')).toHaveLength(24)
  })

  it('raises a range of mountains, not one mountain', () => {
    const { container } = draw('raiseMountains')
    expect(container.querySelectorAll('.peak').length).toBeGreaterThanOrEqual(5)
  })

  it('counts to whatever the cue asked for', () => {
    const { container } = draw('countTo', '28')
    expect(container.textContent).toMatch(/\d+/)
  })

  it('never leaves a placeholder on stage', () => {
    for (const [verb, arg] of [
      ['revealSymbol', 'tiger'], ['unfurlFlag', undefined], ['countTo', '8'],
      ['traceRiver', 'ganga'], ['raiseMountains', undefined], ['showScript', 'namaste'],
    ] as const) {
      const { container, unmount } = draw(verb, arg)
      expect(container.querySelector('.cue-placeholder'), `${verb} is still a placeholder`).toBeNull()
      unmount()
    }
  })

  it('says which cue put it there, for the seam TourStage tests', () => {
    const { container } = draw('revealSymbol', 'tiger')
    const node = container.querySelector('[data-verb="revealSymbol"]')
    expect(node?.getAttribute('data-arg')).toBe('tiger')
  })

  it('remounts a symbol, so revealing the same one twice animates twice', () => {
    const { container, rerender } = render(<>{OVERLAYS.revealSymbol('tiger')}</>)
    const first = container.querySelector('svg')
    rerender(<>{OVERLAYS.revealSymbol('tiger')}</>)
    expect(container.querySelector('svg')).not.toBe(first)
  })

  it('comes back after it has taken itself off stage', () => {
    // "Say it again" replays a beat, and every cue in it fires a second time.
    // An effect that had already dismissed itself must not stay dismissed.
    vi.useFakeTimers()
    const { container, rerender } = render(<>{OVERLAYS.revealSymbol('tiger')}</>)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(container.querySelector('svg')).toBeNull()
    rerender(<>{OVERLAYS.revealSymbol('tiger')}</>)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('keeps ONE greetings card across the three greetings', () => {
    // The beat is about there being more than one way to say hello, which
    // nobody sees if each greeting replaces the last. Same DOM node, moved
    // emphasis — not three mounts.
    const { container, rerender } = render(<>{OVERLAYS.showScript('namaste')}</>)
    const card = container.querySelector('.cue-script')
    expect(card).toBeTruthy()
    rerender(<>{OVERLAYS.showScript('namaskar')}</>)
    expect(container.querySelector('.cue-script')).toBe(card)
    expect(container.querySelector('.cue-greeting.is-now')?.textContent)
      .toContain(GREETINGS.namaskar.native)
  })

  it('brings the greetings card back too, though it never remounts', () => {
    // The one effect with a stable key, so it is the one that could get stuck
    // off stage for good.
    vi.useFakeTimers()
    const { container, rerender } = render(<>{OVERLAYS.showScript('namaste')}</>)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(container.querySelector('.cue-script')).toBeNull()
    rerender(<>{OVERLAYS.showScript('namaste')}</>)
    expect(container.querySelector('.cue-script')).toBeTruthy()
  })

  it('survives an argument no artist ever drew', () => {
    for (const [verb, arg] of [
      ['revealSymbol', 'unicorn'], ['showScript', 'bonjour'],
      ['traceRiver', 'thames'], ['countTo', 'twenty-eight'],
    ] as const) {
      expect(() => draw(verb, arg).unmount(), `${verb} ${arg} crashed`).not.toThrow()
    }
  })
})

describe('the map-registered art', () => {
  /** Every number in geo.ts is in the map's own viewBox, so it can be checked
   *  against the states the narrator names. */
  const bbox = (slug: string) => (geo.places as Record<string, { bbox: number[] }>)[slug].bbox
  const inside = ([x, y]: number[], [bx, by, bw, bh]: number[]) =>
    x >= bx && x <= bx + bw && y >= by && y <= by + bh

  const points = GANGA.match(/-?[\d.]+,-?[\d.]+/g)!.map((p) => p.split(',').map(Number))

  it('starts the Ganga in the mountains, where the narrator says it starts', () => {
    // "It begins high up in the snowy mountains" — Gaumukh, in Uttarakhand.
    expect(inside(points[0], bbox('uttarakhand'))).toBe(true)
  })

  it('pours the Ganga out into the sea', () => {
    // "until it pours itself out into the sea" — the Hooghly mouth, at the
    // southern edge of West Bengal.
    const end = points[points.length - 1]
    const [wx, wy, ww, wh] = bbox('west-bengal')
    expect(end[0]).toBeGreaterThan(wx)
    expect(end[0]).toBeLessThan(wx + ww)
    expect(wy + wh - end[1]).toBeLessThan(20)
  })

  it('puts every Himalayan peak along the top of India', () => {
    // "Along the top of India stand the Himalaya mountains." Every summit in
    // the northern third of the map, and none of them off the edge of it.
    for (const peak of PEAKS) {
      expect(peak.y, `${peak.name} is not in the north`).toBeLessThan(geo.viewBox[3] / 3)
      expect(peak.y).toBeGreaterThan(0)
      expect(peak.x).toBeGreaterThan(0)
      expect(peak.x).toBeLessThan(geo.viewBox[2])
    }
  })

  it('runs the range right across the top, west to east', () => {
    // A range, not a cluster: it starts over Ladakh and ends over Arunachal,
    // and the summits are in order so the rise can stagger along it.
    const [lx, , lw] = bbox('ladakh')
    const [ax, , aw] = bbox('arunachal-pradesh')
    const first = PEAKS[0]
    const last = PEAKS[PEAKS.length - 1]
    expect(first.x).toBeGreaterThan(lx)
    expect(first.x).toBeLessThan(lx + lw)
    expect(last.x).toBeGreaterThan(ax)
    expect(last.x).toBeLessThan(ax + aw)
    for (let i = 1; i < PEAKS.length; i++) {
      expect(PEAKS[i].x, `${PEAKS[i].name} is out of order`).toBeGreaterThan(PEAKS[i - 1].x)
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})
