import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { Trace } from './Trace'

/** Same shape trace.test.ts checks the geometry against: a 100x100 square,
 *  perimeter 400, numbers a human can check by hand. */
const SQUARE = 'M0,0L100,0L100,100L0,100Z'

/** jsdom implements none of SVG's coordinate API (MapStage.test.tsx already
 *  documents this for the map's own hit layer) — no getScreenCTM, no
 *  createSVGPoint. Stubbed here as an identity transform so a dispatched
 *  event's clientX/clientY passes straight through as a path-space point,
 *  which is enough to exercise Trace's REAL handlers rather than a
 *  simplified stand-in for them (a test double has to be faithful to the
 *  interface it stands in for, and the interface here is "however the
 *  browser answers getScreenCTM", not "however this test finds convenient"
 *  — identity is a genuine answer a browser could give, just an unusually
 *  simple one). */
function stubSvgGeometry() {
  const identity = {
    a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    inverse() { return identity },
  } as unknown as DOMMatrix
  ;(SVGSVGElement.prototype as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM =
    () => identity
  ;(SVGSVGElement.prototype as unknown as { createSVGPoint: () => DOMPoint }).createSVGPoint =
    () => {
      const point = {
        x: 0,
        y: 0,
        matrixTransform() { return { x: point.x, y: point.y } },
      }
      return point as unknown as DOMPoint
    }
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

/** A touch pointerdown/move/up at a given point, on whichever hit circle is
 *  nearest it — good enough for a 100-unit square with circles at every 40
 *  units, where every point in play is well inside SOME circle's radius. */
function touchAt(container: HTMLElement, x: number, y: number) {
  const circles = [...container.querySelectorAll('[data-testid="trace-hit"]')]
  const nearest = circles.reduce((best, el) => {
    const bx = Number(el.getAttribute('cx'))
    const by = Number(el.getAttribute('cy'))
    const bd = (bx - x) ** 2 + (by - y) ** 2
    const bestX = Number(best.getAttribute('cx'))
    const bestY = Number(best.getAttribute('cy'))
    const bestD = (bestX - x) ** 2 + (bestY - y) ** 2
    return bd < bestD ? el : best
  })
  const opts = { bubbles: true, clientX: x, clientY: y, pointerType: 'touch' }
  nearest.dispatchEvent(new PointerEvent('pointerdown', opts))
  return nearest
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

  it('lights the traced portion as a finger moves along the path', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    // (100, 0) is the square's second corner, a quarter of the way round —
    // see trace.test.ts's identical assertion on the pure geometry.
    touchAt(container, 100, 0)
    await flushMotionFrame()
    const path = container.querySelector('path')!
    const dasharray = path.getAttribute('stroke-dasharray') ?? ''
    const [lit] = dasharray.split(' ').map(Number)
    expect(lit).toBeCloseTo(0.25, 1)
  })

  it('ignores a pointer path that wanders away from the outline', async () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circle = touchAt(container, 0, 0)
    circle.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 0, clientY: 0, pointerType: 'touch' }),
    )
    await flushMotionFrame()
    const before = container.querySelector('path')!.getAttribute('stroke-dasharray')
    // Deep in open water, by this shape's scale — 500 units from the
    // nearest edge, ten times TOLERANCE.
    circle.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 500, clientY: 500, pointerType: 'touch' }),
    )
    await flushMotionFrame()
    const after = container.querySelector('path')!.getAttribute('stroke-dasharray')
    expect(after).toBe(before)
  })

  it('never fires anything outside its own tree — a trace cannot pick a state', () => {
    // The structural half of "does not fight .stage's pick handler": jsdom
    // does no hit testing (MapStage.test.tsx says so directly), so this
    // cannot prove a real finger routes to the right element — only that
    // Trace's own handlers touch nothing but their own local ref and the
    // motion value, never a callback reaching outside this component. The
    // rest is Task 6's own on-device check, not a jsdom test's to claim.
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
    touchAt(container, 50, 0)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('does nothing for a mouse — this is a finger-only gesture', () => {
    stubReducedMotion(false)
    stubSvgGeometry()
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Trace d={SQUARE} />
      </svg>,
    )
    const circles = container.querySelectorAll('[data-testid="trace-hit"]')
    circles[0].dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0, pointerType: 'mouse' }),
    )
    const dasharray = container.querySelector('path')!.getAttribute('stroke-dasharray') ?? ''
    expect(Number(dasharray.split(' ')[0])).toBe(0)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
