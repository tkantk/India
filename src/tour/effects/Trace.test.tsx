import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { Trace, toleranceFor } from './Trace'
import { buildTracePath } from './tracePath'
import { isTracing, setTracing } from './tracing'

/**
 * A 1300x1300 square, perimeter 5200 — thirteen times the 100x100 square
 * `tracePath.test.ts` checks the geometry against, sized specifically so
 * its own corridor tolerance (`Trace.tsx`'s `toleranceFor`, perimeter /
 * 130) comes out to a round 40 raw units: the same number this file's
 * tests were written against back when `TOLERANCE` was one flat constant
 * shared by every shape. Every absolute distance below (10, 30, 60, 80,
 * 200...) is unchanged from that version for exactly this reason; only the
 * FRACTION-of-total assertions (`x / 5200`) had to move with the new
 * perimeter.
 */
const SQUARE = 'M0,0L1300,0L1300,1300L0,1300Z'

/** A square with a smaller perimeter than SQUARE's, on purpose, so
 *  `touchDown`/`moveTo` can reach a point genuinely far apart from the
 *  anchor (in path-fraction terms) without the coordinates themselves
 *  needing to track SQUARE's own — now much bigger — scale. Left at its
 *  original 300x300 size: its own derived `maxStepUnits` (perimeter / 26,
 *  about 46 raw units) is still comfortably smaller than the ~480-unit
 *  jump the one test below that uses it makes. */
const BIG_SQUARE = 'M0,0L300,0L300,300L0,300Z'

/**
 * A real, invertible 2D affine matrix — not a stand-in that merely LOOKS
 * like one. jsdom implements none of SVG's coordinate API (MapStage.test.tsx
 * already documents this for the map's own hit layer): no getScreenCTM, no
 * createSVGPoint. Stubbing them is unavoidable, but the stub has to be
 * FAITHFUL to the real interface — a `matrixTransform` that ignores the
 * matrix it is handed and echoes its input exercises `toPathPoint`
 * syntactically without ever exercising the `ctm.inverse()` /
 * `.matrixTransform()` arithmetic it actually depends on, and a real
 * coordinate-mapping bug would pass every test built on it. This one does
 * the real 2D affine transform (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`)
 * and inverts a real matrix, so a translated/scaled CTM produces a
 * genuinely different mapped point, and `Trace.test.tsx`'s own "uses the
 * SVG's real coordinate transform" test below only passes if `toPathPoint`
 * actually applies it.
 */
function makeMatrix(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
  const self = {
    a, b, c, d, e, f,
    inverse() {
      const det = self.a * self.d - self.b * self.c
      return makeMatrix(
        self.d / det, -self.b / det,
        -self.c / det, self.a / det,
        (self.c * self.f - self.d * self.e) / det,
        (self.b * self.e - self.a * self.f) / det,
      )
    },
  }
  return self
}

function stubSvgGeometry(matrix: ReturnType<typeof makeMatrix> = makeMatrix()) {
  ;(SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM =
    () => matrix
  ;(SVGSVGElement.prototype as unknown as { createSVGPoint: () => unknown }).createSVGPoint =
    () => {
      const point = {
        x: 0,
        y: 0,
        matrixTransform(m: ReturnType<typeof makeMatrix>) {
          return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f }
        },
      }
      return point
    }
}

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: reduced && media.includes('prefers-reduced-motion'),
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
}

/** Motion writes a MotionValue to the DOM on its own frame scheduler, not
 *  synchronously inside `.set()` — the same reason this component uses a
 *  MotionValue at all rather than `useState` (see Trace.tsx's own
 *  docstring). Two animation frames is Motion's own read-then-write pass. */
function flushMotionFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** A touch pointerdown at (x, y), on whichever hit circle is nearest it —
 *  good enough for a square whose own corridor stride is 40 units, where
 *  every point in play is well inside SOME circle's radius. Returns the
 *  element that captured the gesture, so a real drag's subsequent moves can
 *  be dispatched on the SAME element — exactly what `setPointerCapture`
 *  guarantees in a real browser regardless of where the finger physically
 *  is, and what jsdom's plain `dispatchEvent` does not simulate on its own. */
function touchDown(container: HTMLElement, x: number, y: number) {
  const circles = [...container.querySelectorAll('[data-testid="trace-hit"]')]
  const nearest = circles.reduce((best, el) => {
    const d2 = (n: Element) =>
      (Number(n.getAttribute('cx')) - x) ** 2 + (Number(n.getAttribute('cy')) - y) ** 2
    return d2(el) < d2(best) ? el : best
  })
  nearest.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch' }),
  )
  return nearest
}

function moveTo(el: Element, x: number, y: number, pointerType = 'touch') {
  el.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerType }),
  )
}

function litLength(container: HTMLElement): number {
  const dasharray = container.querySelector('path')!.getAttribute('stroke-dasharray') ?? '0'
  return Number(dasharray.split(' ')[0])
}

describe('Trace', () => {
  it('renders an invisible, generously-sized corridor along the path', () => {
    stubReducedMotion(false)
    const { container } = render(<Trace d={SQUARE} />)
    const circles = container.querySelectorAll('[data-testid="trace-hit"]')
    expect(circles.length).toBeGreaterThan(0)
    for (const c of circles) {
      // hitLayer.ts's own inert pattern: fill geometry hit-tested regardless
      // of what is actually painted, so nothing here costs anything to
      // rasterise.
      expect(c.getAttribute('fill')).toBe('none')
      expect(c.getAttribute('pointer-events')).toBe('fill')
      // Tens of pixels, not the stroke width — a six-year-old's fingertip.
      // SQUARE is sized so this is exactly `toleranceFor` of its own path.
      expect(Number(c.getAttribute('r'))).toBeCloseTo(toleranceFor(buildTracePath(SQUARE)), 5)
    }
  })

  it('sizes the corridor to the traced shape, not a constant tuned for a bigger one', () => {
    // The bug this replaces: a flat reach tuned for India's own ~5184-unit
    // mainland ring, reused unchanged for a state a fraction of that size,
    // left most of the smaller shape's own loop further from any hit-circle
    // than the circle's own radius — "dead" on the smallest states (see
    // Trace.tsx's `SEGMENTS` comment). A TENTH-scale square must therefore
    // get a TENTH the corridor reach of the full-size one, not the same
    // reach reused unchanged.
    stubReducedMotion(false)
    const TENTH = 'M0,0L130,0L130,130L0,130Z' // one tenth of SQUARE's own perimeter
    const big = render(<Trace d={SQUARE} />)
    const small = render(<Trace d={TENTH} />)
    const rBig = Number(big.container.querySelector('[data-testid="trace-hit"]')!.getAttribute('r'))
    const rSmall = Number(small.container.querySelector('[data-testid="trace-hit"]')!.getAttribute('r'))
    expect(rBig).toBeCloseTo(40, 5)
    expect(rSmall).toBeCloseTo(rBig / 10, 5)
  })

  it('is disabled entirely under prefers-reduced-motion', () => {
    stubReducedMotion(true)
    const { container } = render(<Trace d={SQUARE} />)
    expect(container.querySelector('[data-testid="trace-hits"]')).toBeNull()
    expect(container.querySelector('path')).toBeNull()
  })

  it('draws the visible lit path as never a tap target, same as every other cue', () => {
    stubReducedMotion(false)
    const { container } = render(<Trace d={SQUARE} />)
    const path = container.querySelector('path')!
    expect(path.getAttribute('pointer-events')).toBe('none')
  })

  it('a stationary tap produces no visible change at all', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    await flushMotionFrame()
    const before = litLength(container)
    touchDown(container, 100, 0)
    await flushMotionFrame()
    // No pointermove at all — the brief's own bar: "a control that responds
    // sometimes is worse than one that was never promised," and a bare tap
    // must be exactly the second thing, not a surprise mark on the map.
    expect(litLength(container)).toBe(before)
  })

  it('a small, sub-threshold wiggle still produces no visible change', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchDown(container, 0, 0)
    // 10 units — under SQUARE's own engage threshold (20, half of its own 40-unit tolerance).
    moveTo(circle, 10, 0)
    await flushMotionFrame()
    expect(litLength(container)).toBe(0)
  })

  it('lights the traced portion once the finger has moved a meaningful distance', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchDown(container, 0, 0)
    // 30 of 5200 units along the square's own perimeter — past ENGAGE_UNITS.
    moveTo(circle, 30, 0)
    await flushMotionFrame()
    expect(litLength(container)).toBeCloseTo(30 / 5200, 2)
  })

  it('never lets a drag show more than what was actually swept — no leap to an arbitrary fraction', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    // Touch down in the middle of an edge and drag steadily forward in
    // small steps — never a single implausible jump — ending 60 units on.
    const circle = touchDown(container, 20, 0)
    for (const x of [35, 45, 55, 65, 80]) moveTo(circle, x, 0)
    await flushMotionFrame()
    // Swept exactly (80 - 20) = 60 of 5200 units, not the raw fraction of
    // wherever the finger ended up measured from the path's own start (0).
    expect(litLength(container)).toBeCloseTo(60 / 5200, 2)
  })

  it('is monotonic within a gesture: retracing shrinks the raw position but never the drawn line', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchDown(container, 0, 0)
    moveTo(circle, 30, 0)
    moveTo(circle, 60, 0)
    await flushMotionFrame()
    const peak = litLength(container)
    expect(peak).toBeCloseTo(60 / 5200, 2)

    // Retrace 20 units back towards the anchor.
    moveTo(circle, 40, 0)
    await flushMotionFrame()
    expect(litLength(container)).toBe(peak) // never goes backward

    // And forward again, past the old peak, with no jump artefact from the
    // retrace in between.
    moveTo(circle, 70, 0)
    await flushMotionFrame()
    expect(litLength(container)).toBeCloseTo(70 / 5200, 2)
  })

  it('ignores a pointer path that wanders away from the outline mid-drag', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchDown(container, 0, 0)
    moveTo(circle, 30, 0)
    await flushMotionFrame()
    const before = litLength(container)
    // Deep in open water by this shape's scale — 500 units from the nearest
    // edge, over ten times SQUARE's own 40-unit tolerance.
    moveTo(circle, 500, 500)
    await flushMotionFrame()
    expect(litLength(container)).toBe(before)
  })

  it('treats an implausibly large single step as noise, not a leap forward', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 300 300">
        <Trace d={BIG_SQUARE} />
      </svg>,
    )
    const circle = touchDown(container, 0, 0)
    moveTo(circle, 30, 0)
    await flushMotionFrame()
    const before = litLength(container)
    expect(before).toBeCloseTo(30 / 1200, 2)
    // (150, 300) sits exactly on the FAR edge — on the corridor, not an
    // off-path miss — but 480 units away along the ring's own shortest
    // route, well past BIG_SQUARE's own maxStepUnits (~46). A narrow strait putting two
    // unconnected stretches of a real coastline this close in space is
    // exactly what this guards against (see `tracePath.test.ts`'s STAPLE).
    moveTo(circle, 150, 300)
    await flushMotionFrame()
    expect(litLength(container)).toBe(before)
  })

  it('starts fresh on a new mount, regardless of what a previous instance drew', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const first = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchDown(first.container, 0, 0)
    moveTo(circle, 60, 0)
    await flushMotionFrame()
    expect(litLength(first.container)).toBeGreaterThan(0)
    first.unmount()

    // A fresh instance — this is what actually happens when beat 2 ends and
    // fires again on "say it again" (see this file's own "WHY IT RESETS ON
    // ITS OWN"): a new React key, a brand new component instance.
    const second = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    await flushMotionFrame()
    expect(litLength(second.container)).toBe(0)
  })

  it('never fires anything outside its own tree — a trace cannot pick a state', () => {
    // The structural half of "does not fight .stage's pick handler": jsdom
    // does no hit testing (MapStage.test.tsx says so directly), so this
    // cannot prove a real finger routes to the right element — only that
    // Trace's own handlers touch nothing but their own local refs and the
    // two motion values, never a callback reaching outside this component.
    // The rest — including that this suppression is deliberate for touch,
    // not only mouse — is Task 6's own on-device check and its report, not
    // a jsdom test's to claim either way.
    stubReducedMotion(false)
    stubSvgGeometry()
    const onPick = vi.fn()
    const { container } = render(
      <>
        <div className="stage" onPointerDown={onPick} />
        <svg viewBox="0 0 100 100">
          <Trace d={SQUARE} />
        </svg>
      </>,
    )
    touchDown(container, 50, 0)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('does nothing for a mouse — this is a finger-only gesture', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circles = container.querySelectorAll('[data-testid="trace-hit"]')
    const circle = circles[0]
    circle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerType: 'mouse' }),
    )
    moveTo(circle, 60, 0, 'mouse')
    await flushMotionFrame()
    expect(litLength(container)).toBe(0)
  })

  it("uses the SVG's real coordinate transform, not merely the numbers handed to it", async () => {
    stubReducedMotion(false)
    // A CTM that is not the identity: screen coordinates are the path's own
    // coordinates shifted by (50, 20). `toPathPoint` has to invert this
    // correctly — a stub whose `matrixTransform` ignored the matrix (as an
    // earlier version of this file's stub did) would make this test expect
    // the wrong number regardless, which is exactly why it is worth having:
    // it only passes if the real inverse-matrix arithmetic ran.
    stubSvgGeometry(makeMatrix(1, 0, 0, 1, 50, 20))
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    // `resamplePath` starts its first hit circle exactly at the ring's own
    // start point, (0, 0) in PATH space — found directly rather than through
    // `touchDown`'s nearest-circle search, which assumes screen space and
    // path space are the same thing (true only for the identity matrix
    // every other test in this file uses, and exactly what this test must
    // NOT assume).
    const circle = container.querySelector('[data-testid="trace-hit"]')!
    // Screen (50, 20) is path-space (0, 0); screen (80, 20) is path-space
    // (30, 0) — 30 of 5200 units along the square, same as the untranslated
    // test above, but only reachable by actually inverting the CTM.
    circle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 20, pointerType: 'touch' }),
    )
    moveTo(circle, 80, 20)
    await flushMotionFrame()
    expect(litLength(container)).toBeCloseTo(30 / 5200, 2)
  })
})

/**
 * Plan 4 / Task 3: `GrandTour`'s dwell timer needs to know whether a finger
 * is currently down on the corridor, and the interface it reads that
 * through — `useSyncExternalStore(subscribeTracing, isTracing)` — is only as
 * trustworthy as this component actually keeping it in sync with the real
 * gesture. `isTracing()` is read directly here rather than through the hook:
 * this file's job is "does `Trace` publish correctly", not "does
 * `useSyncExternalStore` work".
 */
describe('Trace publishes whether a finger is down', () => {
  it('is not tracing before anything has touched the corridor', () => {
    stubReducedMotion(false)
    render(<Trace d={SQUARE} />)
    expect(isTracing()).toBe(false)
  })

  it('publishes true the instant a touch lands on the corridor', () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    touchDown(container, 0, 0)
    expect(isTracing()).toBe(true)
  })

  it('publishes false again once the finger lifts', () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchDown(container, 0, 0)
    expect(isTracing()).toBe(true)
    circle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 0 }))
    expect(isTracing()).toBe(false)
  })

  it('publishes false on a cancelled gesture too — a native scroll taking the pointer', () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchDown(container, 0, 0)
    expect(isTracing()).toBe(true)
    circle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, clientX: 0, clientY: 0 }))
    expect(isTracing()).toBe(false)
  })

  it('never publishes true for a mouse — this is a finger-only gesture', () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = container.querySelectorAll('[data-testid="trace-hit"]')[0]
    circle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerType: 'mouse' }),
    )
    expect(isTracing()).toBe(false)
  })

  it('resets to not-tracing if the component unmounts mid-gesture', () => {
    // `Outline`'s `Reveal` unmounts this whole subtree the moment its hold
    // expires — mid-touch, if a finger is still moving when it does. No
    // `pointerup` is coming for a pointer this component no longer has a
    // listener on, so without an unmount guard the dwell timer's own
    // "is a finger down" would read true forever.
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container, unmount } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    touchDown(container, 0, 0)
    expect(isTracing()).toBe(true)
    unmount()
    expect(isTracing()).toBe(false)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  setTracing(false)
})
