import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { OVERLAYS } from '../overlays'
import { GREETINGS } from './Script'
import { GANGA, PEAKS } from './art/geo'
import { WATERS } from './art/Sea'
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
      // Shapes, not merely an <svg>: an empty frame is truthy too.
      const shapes = container.querySelectorAll('path, circle, ellipse, rect, polygon, line')
      expect(shapes.length, `${symbol} drew nothing`).toBeGreaterThan(0)
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

/**
 * "Water touches India on three sides. On the left of the map is the Arabian
 * Sea. On the right is the Bay of Bengal. And underneath them both is the
 * Indian Ocean."
 *
 * Three cues, seven words apart, into ONE overlay slot — and what the beat
 * teaches is where the water is, to a listener who cannot read yet.
 */
describe('the three seas', () => {
  const water = (id: string) => WATERS.find((w) => w.id === id)!
  const bbox = (slug: string) => (geo.places as Record<string, { bbox: number[] }>)[slug].bbox

  it('never writes the name of a sea down', () => {
    // The audience is six. The narrator says the names; the art says where —
    // a caption in English is the one thing this beat must not be.
    for (const w of WATERS) {
      const { container, unmount } = draw('revealSymbol', w.id)
      expect(container.querySelectorAll('text'), `${w.id} is captioned`).toHaveLength(0)
      expect(container.textContent?.trim(), `${w.id} is captioned`).toBe('')
      unmount()
    }
  })

  it('shows all three waters at once, with the one being named brought forward', () => {
    for (const w of WATERS) {
      const { container, unmount } = draw('revealSymbol', w.id)
      // "on three sides" — a picture of one sea contradicts the sentence.
      expect(container.querySelectorAll('.cue-water')).toHaveLength(WATERS.length)
      const now = container.querySelectorAll('.cue-water.is-now')
      expect(now, `${w.id} was not the one brought forward`).toHaveLength(1)
      expect(now[0].getAttribute('data-sea')).toBe(w.id)
      unmount()
    }
  })

  it('keeps ONE water layer across the three of them, so they accumulate', () => {
    // Same DOM node, moved emphasis — not three mounts, each wiping out the
    // last. The same exception the greetings card gets, for the same reason.
    const { container, rerender } = render(<>{OVERLAYS.revealSymbol('arabian-sea')}</>)
    const layer = container.querySelector('.cue-map')
    expect(layer).toBeTruthy()
    rerender(<>{OVERLAYS.revealSymbol('bay-of-bengal')}</>)
    expect(container.querySelector('.cue-map')).toBe(layer)
    rerender(<>{OVERLAYS.revealSymbol('indian-ocean')}</>)
    expect(container.querySelector('.cue-map')).toBe(layer)
    expect(container.querySelector('.cue-water.is-now')?.getAttribute('data-sea'))
      .toBe('indian-ocean')
  })

  it('brings the water back after it has taken itself off stage', () => {
    // The stable key is what makes this possible to get wrong: "say it
    // again" replays the beat into the instance that already dismissed
    // itself.
    vi.useFakeTimers()
    const { container, rerender } = render(<>{OVERLAYS.revealSymbol('arabian-sea')}</>)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(container.querySelector('.cue-map')).toBeNull()
    rerender(<>{OVERLAYS.revealSymbol('arabian-sea')}</>)
    expect(container.querySelector('.cue-map')).toBeTruthy()
  })

  it('goes back to a symbol on a card when the cue is not a sea', () => {
    // The special case is keyed on the argument, so it must let go again.
    const { container, rerender } = render(<>{OVERLAYS.revealSymbol('arabian-sea')}</>)
    expect(container.querySelector('.cue-water')).toBeTruthy()
    rerender(<>{OVERLAYS.revealSymbol('tiger')}</>)
    expect(container.querySelector('.cue-water')).toBeNull()
    expect(container.querySelector('.cue-art')).toBeTruthy()
  })

  it('puts each sea where the narrator says it is', () => {
    const [arabian, bengal, ocean] = [water('arabian-sea'), water('bay-of-bengal'), water('indian-ocean')]
    // "On the left of the map" — the whole body of it west of the Konkan
    // coast, not merely centred to the left.
    expect(arabian.cx + arabian.rx).toBeLessThan(bbox('maharashtra')[0])
    // "On the right" — east of Odisha, the coast it lies off.
    expect(bengal.cx - bengal.rx).toBeGreaterThan(bbox('odisha')[0] + bbox('odisha')[2])
    // "And underneath them both."
    expect(ocean.cy).toBeGreaterThan(arabian.cy)
    expect(ocean.cy).toBeGreaterThan(bengal.cy)
    // On the map, all of it: a sea half off the edge is half a sea.
    for (const w of WATERS) {
      expect(w.cx - w.rx, `${w.id} runs off the left`).toBeGreaterThan(0)
      expect(w.cx + w.rx, `${w.id} runs off the right`).toBeLessThan(geo.viewBox[2])
      expect(w.cy - w.ry, `${w.id} runs off the top`).toBeGreaterThan(0)
      expect(w.cy + w.ry, `${w.id} runs off the bottom`).toBeLessThan(geo.viewBox[3])
    }
  })

  it('paints no water over the land', () => {
    // Water on top of Gujarat is not a sea, it is a flood. The map is drawn
    // from straight polygons (M/L/Z only), so this is the real test: sample
    // each body, boundary and inside, against the real states.
    const rings = (d: string) =>
      d.split('Z')
        .map((r) => (r.match(/-?[\d.]+,-?[\d.]+/g) ?? []).map((p) => p.split(',').map(Number)))
        .filter((r) => r.length > 2)
    const land = Object.entries(geo.places as Record<string, { d: string; bbox: number[] }>)
      .map(([slug, p]) => ({ slug, bbox: p.bbox, rings: rings(p.d) }))

    const covers = (ring: number[][], x: number, y: number) => {
      let hit = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    }
    const onLand = (x: number, y: number) =>
      land.find(
        (place) =>
          x >= place.bbox[0] && x <= place.bbox[0] + place.bbox[2] &&
          y >= place.bbox[1] && y <= place.bbox[1] + place.bbox[3] &&
          place.rings.some((ring) => covers(ring, x, y)),
      )?.slug

    for (const w of WATERS) {
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2
        // The rim, where a body is most likely to touch a coast, and a point
        // partway in on the same bearing.
        for (const r of [1, 0.6, 0.25]) {
          const x = w.cx + Math.cos(a) * w.rx * r
          const y = w.cy + Math.sin(a) * w.ry * r
          expect(onLand(x, y), `${w.id} washes over land at ${Math.round(x)},${Math.round(y)}`)
            .toBeUndefined()
        }
      }
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})
