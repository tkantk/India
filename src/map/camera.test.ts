import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { frame, committedRect, flyTo, bindCamera, camera } from './camera'
import type { Bbox } from '../types'

const VIEW: [number, number, number, number] = [0, 0, 1000, 1100]

describe('frame', () => {
  it('is the identity when the target is the whole view', () => {
    const f = frame([0, 0, 1000, 1100], VIEW, 0)
    expect(f.scale).toBeCloseTo(1, 5)
    expect(f.x).toBeCloseTo(0, 5)
    expect(f.y).toBeCloseTo(0, 5)
  })

  it('doubles the scale for a target half the size', () => {
    expect(frame([250, 275, 500, 550], VIEW, 0).scale).toBeCloseTo(2, 5)
  })

  it('fits by the more constrained axis so nothing is cropped', () => {
    // A wide, short target must fit by width, not height.
    const f = frame([0, 500, 1000, 100], VIEW, 0)
    expect(f.scale).toBeCloseTo(1, 5)
  })

  it('centres the target in the view', () => {
    const f = frame([400, 500, 200, 100], VIEW, 0)
    const cx = (400 + 100) * f.scale + f.x
    const cy = (500 + 50) * f.scale + f.y
    expect(cx).toBeCloseTo(500, 3)
    expect(cy).toBeCloseTo(550, 3)
  })

  it('honours padding by scaling down', () => {
    const tight = frame([250, 275, 500, 550], VIEW, 0).scale
    const padded = frame([250, 275, 500, 550], VIEW, 40).scale
    expect(padded).toBeLessThan(tight)
  })

  it('never scales past a sane ceiling, so a tiny territory does not fill the world', () => {
    // Lakshadweep is a few pixels across; without a clamp the child sees soup.
    expect(frame([500, 900, 4, 4], VIEW, 0).scale).toBeLessThanOrEqual(12)
  })

  it('produces a real transform for every actual place in the map', async () => {
    const geo = (await import('../data/geo.json')).default
    for (const [slug, p] of Object.entries(geo.places)) {
      const f = frame(p.bbox as never, VIEW, 40)
      expect(Number.isFinite(f.scale), slug).toBe(true)
      expect(f.scale, slug).toBeGreaterThan(0)
      expect(Number.isFinite(f.x), slug).toBe(true)
      expect(Number.isFinite(f.y), slug).toBe(true)
    }
  })

  it('zooms back out when the target is bigger than the view', () => {
    // Every flight is computed from wherever the camera already is, so the
    // way home from a tight view is a scale below 1. Clamping that away
    // would strand a child inside Lakshadweep.
    const f = frame(VIEW, [458, 545, 83, 91], 0)
    // Fits by height, the tighter axis of the two: 91 / 1100.
    expect(f.scale).toBeCloseTo(91 / 1100, 6)
    // And the way home really does show the whole country again.
    const r = committedRect(f, [458, 545, 83, 91])
    expect(r[0]).toBeLessThanOrEqual(0)
    expect(r[0] + r[2]).toBeGreaterThanOrEqual(1000)
    expect(r[1] + r[3]).toBeGreaterThanOrEqual(1100)
  })

  it('survives a target with no width at all', () => {
    const f = frame([500, 500, 0, 0], VIEW, 0)
    expect(Number.isFinite(f.scale)).toBe(true)
    expect(f.scale).toBeGreaterThan(0)
  })
})

/**
 * The rect that is committed at the end of the flight is the preimage of the
 * whole view under the transform, NOT the target bbox: that is what makes the
 * swap invisible. Both mappings letterbox by the same rule, so committing the
 * preimage lands on exactly the pixels the transform was showing.
 */
describe('committedRect', () => {
  it('is the target itself when the target shares the view aspect', () => {
    expect(committedRect(frame([250, 275, 500, 550], VIEW, 0), VIEW))
      .toEqual([250, 275, 500, 550])
  })

  it('keeps the view aspect, so the letterbox does not move at the commit', () => {
    const r = committedRect(frame([300, 400, 200, 50], VIEW, 0), VIEW)
    expect(r[2] / r[3]).toBeCloseTo(1000 / 1100, 6)
  })

  it('contains the padded target, so nothing the flight showed is cut off', () => {
    const target: Bbox = [791.9, 256.2, 188.3, 106.5]
    const r = committedRect(frame(target, VIEW, 40), VIEW)
    // A hair of float slack: these are divisions, not exact arithmetic.
    const e = 1e-6
    expect(r[0]).toBeLessThanOrEqual(target[0] - 40 + e)
    expect(r[1]).toBeLessThanOrEqual(target[1] - 40 + e)
    expect(r[0] + r[2]).toBeGreaterThanOrEqual(target[0] + target[2] + 40 - e)
    expect(r[1] + r[3]).toBeGreaterThanOrEqual(target[1] + target[3] + 40 - e)
  })

  it('is centred on the target', () => {
    const target: Bbox = [316.2, 306.2, 16.3, 17.2]
    const r = committedRect(frame(target, VIEW, 0), VIEW)
    expect(r[0] + r[2] / 2).toBeCloseTo(target[0] + target[2] / 2, 6)
    expect(r[1] + r[3] / 2).toBeCloseTo(target[1] + target[3] / 2, 6)
  })
})

// --------------------------------------------------------------- flyTo

const SVG_NS = 'http://www.w3.org/2000/svg'

function layer(cls: string) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', cls)
  svg.setAttribute('viewBox', '0 0 1000 1100')
  return svg
}

function map() {
  const stage = document.createElement('div')
  const base = layer('base')
  const hit = layer('hit')
  const glow = layer('glow')
  stage.append(base, hit, glow)
  document.body.append(stage)
  return { stage, base, hit, glow }
}

/**
 * A faithful stand-in for `Element.animate`, which jsdom does not implement.
 *
 * It promises exactly what the real one does and nothing more: the returned
 * object exposes `finished`, which settles when the animation ends, and
 * `cancel()`, which rejects it with an AbortError. Nothing here applies a
 * style — a real composited animation does not touch the style attribute
 * either, which is the whole reason the camera sets the final transform
 * itself instead of relying on a fill mode.
 */
type FakeAnimation = {
  target: Element
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  playState: string
  finished: Promise<unknown>
  cancel(): void
  finish(): void
}

function stubAnimate() {
  const started: FakeAnimation[] = []
  const impl = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let settle!: () => void
    let abort!: (reason: unknown) => void
    const finished = new Promise<unknown>((res, rej) => {
      settle = () => res(anim)
      abort = rej
    })
    const anim: FakeAnimation = {
      target: this,
      keyframes,
      options,
      playState: 'running',
      finished,
      cancel() {
        if (this.playState !== 'running') return
        this.playState = 'idle'
        abort(new DOMException('The animation was aborted.', 'AbortError'))
      },
      finish() {
        if (this.playState !== 'running') return
        this.playState = 'finished'
        settle()
      },
    }
    started.push(anim)
    return anim
  }
  ;(Element.prototype as unknown as { animate: unknown }).animate = impl
  return started
}

afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate
  document.body.innerHTML = ''
  bindCamera(null)
  vi.unstubAllGlobals()
})

describe('flyTo', () => {
  it('commits the viewBox and clears the transform when the flight ends', async () => {
    const stage = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 1000 1100')
    await flyTo(stage, svg, [250, 275, 500, 550], { duration: 0 })
    expect(svg.getAttribute('viewBox')).toBe('250 275 500 550')
    expect(stage.style.transform).toBe('')
    expect(stage.style.willChange).toBe('')
  })

  it('never animates the SVG itself, only the HTML wrapper', async () => {
    const stage = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 1000 1100')
    await flyTo(stage, svg, [250, 275, 500, 550], { duration: 0 })
    // An SVG child can never own a compositor layer in WebKit's legacy engine.
    expect(svg.style.transform).toBe('')
  })

  it('commits every layer that shares the viewBox, not just the one it read', async () => {
    // The hit layer is what a tap is tested against. Leave its viewBox behind
    // and the map goes dead the moment a child zooms in.
    const { stage, base, hit, glow } = map()
    await flyTo(stage, [base, hit, glow], [250, 275, 500, 550], { duration: 0 })
    for (const l of [base, hit, glow]) expect(l.getAttribute('viewBox')).toBe('250 275 500 550')
  })

  it('flies from wherever the camera already is, not always from home', async () => {
    const { stage, base } = map()
    await flyTo(stage, base, [316.2, 306.2, 16.3, 17.2], { duration: 0 })
    const first = base.getAttribute('viewBox')
    await flyTo(stage, base, [200, 200, 400, 440], { duration: 0 })
    const [x, y, w, h] = base.getAttribute('viewBox')!.split(' ').map(Number)
    expect(base.getAttribute('viewBox')).not.toBe(first)
    // Centred on the second target, at its size.
    expect(x + w / 2).toBeCloseTo(400, 3)
    expect(y + h / 2).toBeCloseTo(420, 3)
    expect(w).toBeCloseTo(400, 3)
  })

  it('leaves a layer with no viewBox alone rather than throwing', async () => {
    const stage = document.createElement('div')
    const svg = document.createElementNS(SVG_NS, 'svg')
    await expect(flyTo(stage, svg, [0, 0, 10, 10], { duration: 0 })).resolves.toBeUndefined()
    expect(svg.hasAttribute('viewBox')).toBe(false)
  })

  describe('with a compositor to animate on', () => {
    it('animates transform and nothing else, on the wrapper', async () => {
      const started = stubAnimate()
      const { stage, base } = map()
      const flight = flyTo(stage, base, [250, 275, 500, 550], { duration: 400 })
      expect(started).toHaveLength(1)
      expect(started[0].target).toBe(stage)
      for (const k of started[0].keyframes) {
        // Anything else here — width, opacity, viewBox — is a main-thread
        // repaint of all 36 paths, every frame.
        expect(Object.keys(k).filter((p) => p !== 'offset' && p !== 'easing')).toEqual(['transform'])
      }
      expect(started[0].options.duration).toBe(400)
      started[0].finish()
      await flight
    })

    it('holds the compositor hint only for as long as the flight', async () => {
      const started = stubAnimate()
      const { stage, base } = map()
      const flight = flyTo(stage, base, [250, 275, 500, 550], { duration: 400 })
      // A full-screen composited layer is about 12.6 MB on a 2048x1536 iPad,
      // and WebKit drops tiles under memory pressure: white flashes.
      expect(stage.style.willChange).toBe('transform')
      expect(stage.style.transform).toMatch(/scale\(/)
      expect(base.getAttribute('viewBox'), 'committed before landing').toBe('0 0 1000 1100')
      started[0].finish()
      await flight
      expect(stage.style.willChange).toBe('')
      expect(stage.style.transform).toBe('')
      expect(base.getAttribute('viewBox')).toBe('250 275 500 550')
    })

    it('swaps the viewBox and drops the transform in a single frame', async () => {
      // Two frames means one frame drawn at the new viewBox with the old
      // transform still on: the whole map jumps, then jumps back.
      const started = stubAnimate()
      const { stage, base, hit, glow } = map()
      const batches: string[][] = []
      const obs = new MutationObserver((records) =>
        batches.push(records.map((r) => `${(r.target as Element).getAttribute('class') ?? 'stage'}:${r.attributeName}`)),
      )
      for (const el of [stage, base, hit, glow]) obs.observe(el, { attributes: true })
      const flight = flyTo(stage, [base, hit, glow], [250, 275, 500, 550], { duration: 400 })
      await Promise.resolve()
      batches.length = 0
      started[0].finish()
      await flight
      obs.disconnect()
      // MutationObserver delivers one batch per microtask checkpoint, so a
      // second batch is a second task, which is a second frame.
      expect(batches).toHaveLength(1)
      expect(batches[0].filter((m) => m.endsWith('viewBox'))).toHaveLength(3)
      expect(batches[0].some((m) => m.startsWith('stage:style'))).toBe(true)
    })

    it('lands the flight it interrupts before starting the next one', async () => {
      const started = stubAnimate()
      const { stage, base } = map()
      const first = flyTo(stage, base, [316.2, 306.2, 16.3, 17.2], { duration: 400 })
      const second = flyTo(stage, base, [200, 200, 400, 440], { duration: 400 })
      expect(started[0].playState, 'the first flight was left running').toBe('idle')
      expect(started).toHaveLength(2)
      started[1].finish()
      await Promise.all([first, second])
      const [x, y, w] = base.getAttribute('viewBox')!.split(' ').map(Number)
      // The second flight framed the second target and nothing compounded.
      // Two decimals, not three: the interrupted flight committed a viewBox
      // rounded to a thousandth of a unit, and the second flight is computed
      // from that. A thousandth of a viewBox unit is under a thousandth of a
      // CSS pixel on the screen a child is looking at.
      expect(x + w / 2).toBeCloseTo(400, 2)
      expect(y).toBeCloseTo(200, 2)
      expect(stage.style.transform).toBe('')
      expect(stage.style.willChange).toBe('')
    })

    it('is 200 ms when the hardware or the child asks for less motion', async () => {
      vi.stubGlobal('matchMedia', (media: string) => ({
        media, matches: true, onchange: null,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent: () => false,
      }))
      const started = stubAnimate()
      const { stage, base } = map()
      const flight = flyTo(stage, base, [250, 275, 500, 550])
      expect(started[0].options.duration).toBe(200)
      started[0].finish()
      await flight
    })

    it('takes between 350 and 450 ms on hardware that can afford it', async () => {
      const started = stubAnimate()
      const { stage, base } = map()
      const flight = flyTo(stage, base, [250, 275, 500, 550])
      expect(started[0].options.duration).toBeGreaterThanOrEqual(350)
      expect(started[0].options.duration).toBeLessThanOrEqual(450)
      expect(String(started[0].options.easing), 'a camera decelerates').toMatch(/cubic-bezier/)
      started[0].finish()
      await flight
    })

    it('cuts straight to the destination where there is no Web Animations API', async () => {
      // iOS 12 has no Element.animate. A hard cut is not lovely, but a child
      // still arrives, and nothing is left half-transformed.
      const { stage, base } = map()
      await flyTo(stage, base, [250, 275, 500, 550], { duration: 400 })
      expect(base.getAttribute('viewBox')).toBe('250 275 500 550')
      expect(stage.style.transform).toBe('')
    })
  })
})

describe('what the flight assumes about the stylesheet', () => {
  // Vitest does not process CSS, so the stylesheet is read as the source of
  // truth — the same way MapStage.test.tsx checks the glow's filter.
  const css = readFileSync('src/map/map.css', 'utf8')
  const stageRule = /\.map \.stage\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

  it('transforms the stage about its top-left corner', () => {
    // Every translation the camera computes is measured from (0, 0). With the
    // default 50% 50% origin, each flight would land half a screen out, and
    // nothing in jsdom could see it: it has no layout to be wrong about.
    expect(stageRule).toMatch(/transform-origin:\s*0 0/)
  })

  it('gives the stage the whole map box to measure itself against', () => {
    // clientWidth/clientHeight are the viewport the SVG letterboxes into.
    // If the stage stopped filling the map, the letterbox term would be
    // computed against the wrong box.
    expect(stageRule).toMatch(/position:\s*absolute/)
    expect(stageRule).toMatch(/inset:\s*0/)
  })

  it('leaves will-change to the camera rather than declaring it', () => {
    // A permanent full-screen composited layer is about 12.6 MB on a
    // 2048x1536 iPad, and WebKit drops tiles from it under memory pressure.
    expect(stageRule).not.toMatch(/will-change/)
  })
})

// -------------------------------------------------------------- the binding

describe('the bound camera', () => {
  it('is inert until a map hands it a stage', async () => {
    bindCamera(null)
    expect(camera.view()).toBeNull()
    await expect(camera.flyTo([0, 0, 10, 10], { duration: 0 })).resolves.toBeUndefined()
  })

  it('takes the stage element itself, never a class name', async () => {
    // A querySelector for '.stage' is a coupling that breaks in silence.
    // The map hands its own element over, so a rename cannot miss it.
    const { stage, base, hit, glow } = map()
    bindCamera(stage)
    expect(camera.view()).toEqual([0, 0, 1000, 1100])
    await camera.flyTo([316.2, 306.2, 16.3, 17.2], { duration: 0, padding: 0 })
    const flown = base.getAttribute('viewBox')
    expect(flown).not.toBe('0 0 1000 1100')
    for (const l of [hit, glow]) expect(l.getAttribute('viewBox')).toBe(flown)
  })

  it('gives a place room to breathe by default', async () => {
    const { stage, base } = map()
    bindCamera(stage)
    const target: Bbox = [316.2, 306.2, 16.3, 17.2]
    await camera.flyTo(target, { duration: 0 })
    const [x, y, w, h] = base.getAttribute('viewBox')!.split(' ').map(Number)
    expect(x).toBeLessThan(target[0])
    expect(y).toBeLessThan(target[1])
    expect(x + w).toBeGreaterThan(target[0] + target[2])
    expect(y + h).toBeGreaterThan(target[1] + target[3])
  })

  it('comes home to the view the map started at', async () => {
    const { stage, base } = map()
    bindCamera(stage)
    await camera.flyTo([316.2, 306.2, 16.3, 17.2], { duration: 0 })
    await camera.home({ duration: 0 })
    expect(base.getAttribute('viewBox')).toBe('0 0 1000 1100')
    expect(camera.view()).toEqual([0, 0, 1000, 1100])
  })

  it('lets go of the map when the map unmounts', async () => {
    const { stage } = map()
    bindCamera(stage)
    bindCamera(null)
    expect(camera.view()).toBeNull()
    await expect(camera.flyTo([0, 0, 10, 10], { duration: 0 })).resolves.toBeUndefined()
  })

  it('stays inert rather than throwing when handed a stage with no layers', async () => {
    const stage = document.createElement('div')
    document.body.append(stage)
    bindCamera(stage)
    expect(camera.view()).toBeNull()
    await expect(camera.flyTo([0, 0, 10, 10], { duration: 0 })).resolves.toBeUndefined()
  })
})
