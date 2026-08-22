import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { Trace } from './Trace'

/** Same shape tracePath.test.ts checks the geometry against: a 100x100
 *  square, perimeter 400, numbers a human can check by hand. */
const SQUARE = 'M0,0L100,0L100,100L0,100Z'

/** A bigger square, perimeter 1200, for the one test where SQUARE itself
 *  cannot demonstrate the point: SQUARE's own ring never puts two points
 *  more than 200 apart (half of 400) the short way round, which is exactly
 *  `MAX_STEP_UNITS` — so no jump on SQUARE can ever strictly exceed it. */
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
 *  good enough for a 100-unit square with circles every 40 units, where
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
      expect(Number(c.getAttribute('r'))).toBeGreaterThanOrEqual(20)
    }
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
    // 10 units — under ENGAGE_UNITS (20, half of the 40-unit TOLERANCE).
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
    // 30 of 400 units along the square's own perimeter — past ENGAGE_UNITS.
    moveTo(circle, 30, 0)
    await flushMotionFrame()
    expect(litLength(container)).toBeCloseTo(30 / 400, 2)
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
    // Swept exactly (80 - 20) = 60 of 400 units, not the raw fraction of
    // wherever the finger ended up measured from the path's own start (0).
    expect(litLength(container)).toBeCloseTo(60 / 400, 2)
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
    expect(peak).toBeCloseTo(60 / 400, 2)

    // Retrace 20 units back towards the anchor.
    moveTo(circle, 40, 0)
    await flushMotionFrame()
    expect(litLength(container)).toBe(peak) // never goes backward

    // And forward again, past the old peak, with no jump artefact from the
    // retrace in between.
    moveTo(circle, 70, 0)
    await flushMotionFrame()
    expect(litLength(container)).toBeCloseTo(70 / 400, 2)
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
    // edge, ten times TOLERANCE.
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
    // route, well past `MAX_STEP_UNITS` (200). A narrow strait putting two
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
    // (30, 0) — 30 of 400 units along the square, same as the untranslated
    // test above, but only reachable by actually inverting the CTM.
    circle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 20, pointerType: 'touch' }),
    )
    moveTo(circle, 80, 20)
    await flushMotionFrame()
    expect(litLength(container)).toBeCloseTo(30 / 400, 2)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
