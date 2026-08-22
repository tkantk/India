import { describe, it, expect } from 'vitest'
import { buildTracePath, nearestOnPath, resamplePath, ringDelta } from './tracePath'

/**
 * A 100x100 square, traced clockwise from the top-left corner. Perimeter
 * 400, and every side is 100 long — numbers a human can check by hand,
 * which India's real coastline is not.
 */
const SQUARE = 'M0,0L100,0L100,100L0,100Z'

/**
 * A tall, 2-wide staple. Its two long sides run right past each other —
 * (2, 50) and (0, 50) are 2 units apart in space — but they are opposite
 * sides of the ring, three-quarters of its perimeter apart. A bay whose two
 * shores nearly touch is the real-world version of this shape.
 */
const STAPLE = 'M0,0L2,0L2,100L0,100Z'

describe('buildTracePath', () => {
  it('closes the ring back to its own first point', () => {
    const path = buildTracePath(SQUARE)
    expect(path.points[0]).toEqual(path.points[path.points.length - 1])
  })

  it('measures the square perimeter exactly', () => {
    const path = buildTracePath(SQUARE)
    expect(path.total).toBe(400)
  })

  it('is degenerate but harmless for a path with under two points', () => {
    expect(buildTracePath('M5,5Z').total).toBe(0)
    expect(buildTracePath('').total).toBe(0)
  })
})

describe('nearestOnPath', () => {
  const path = buildTracePath(SQUARE)

  it('reports zero distance and fraction 0 exactly on the start corner', () => {
    const { distance, fraction } = nearestOnPath(path, 0, 0)
    expect(distance).toBe(0)
    expect(fraction).toBe(0)
  })

  it('reports a quarter of the way round at the second corner', () => {
    // 100 of 400 units in, having walked the top edge.
    const { distance, fraction } = nearestOnPath(path, 100, 0)
    expect(distance).toBe(0)
    expect(fraction).toBeCloseTo(0.25)
  })

  it('places the midpoint of an edge at the midpoint of its fraction', () => {
    const { fraction } = nearestOnPath(path, 50, 0)
    expect(fraction).toBeCloseTo(0.125)
  })

  it('grows with distance for a point held away from the path', () => {
    const near = nearestOnPath(path, 50, 5)
    const far = nearestOnPath(path, 50, 60)
    expect(far.distance).toBeGreaterThan(near.distance)
  })

  it('is driven by arc length, not by raw (x, y) proximity', () => {
    // Two query points 1.8 units apart in space, one hugging each side of
    // STAPLE — nearer to each other than either is to most of its own side,
    // and yet on opposite ends of the ring's own perimeter. A fraction
    // computed from raw distance-to-either-side would put these two
    // together; pathLength cannot, because there is no such thing as "the
    // finger is 1.8 units from where it was" on a 1-dimensional stroke.
    const staple = buildTracePath(STAPLE)
    const rightSide = nearestOnPath(staple, 1.9, 50)
    const leftSide = nearestOnPath(staple, 0.1, 50)
    expect(Math.abs(rightSide.fraction - leftSide.fraction)).toBeGreaterThan(0.4)
  })

  it('degrades to a fixed answer rather than dividing by zero on an empty path', () => {
    const empty = buildTracePath('')
    expect(() => nearestOnPath(empty, 1, 1)).not.toThrow()
    expect(nearestOnPath(empty, 1, 1).distance).toBe(Infinity)
  })
})

describe('resamplePath', () => {
  it('starts exactly on the path and never runs past its own perimeter', () => {
    const path = buildTracePath(SQUARE)
    const points = resamplePath(path, 40)
    expect(points[0]).toEqual([0, 0])
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(100)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(100)
    }
  })

  it('leaves no gap a finger could fall through', () => {
    // Consecutive samples, walked along the ring, are never further apart
    // than the spacing itself — which `Trace.tsx` sizes its hit circles'
    // radius to match, so neighbouring circles always overlap.
    const path = buildTracePath(SQUARE)
    const spacing = 40
    const points = resamplePath(path, spacing)
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]
      const [bx, by] = points[i]
      expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual(spacing + 1e-6)
    }
  })

  it('returns nothing for a degenerate path rather than looping forever', () => {
    expect(resamplePath(buildTracePath(''), 40)).toEqual([])
    expect(resamplePath(buildTracePath(SQUARE), 0)).toEqual([])
  })
})

describe('ringDelta', () => {
  it('is the plain difference when nothing wraps', () => {
    expect(ringDelta(0.3, 0.1)).toBeCloseTo(0.2)
    expect(ringDelta(0.1, 0.3)).toBeCloseTo(-0.2)
  })

  it('takes the short way round the seam instead of the long way across it', () => {
    // 0.98 -> 0.02 is a forward step of 0.04 across the wrap, not a backward
    // step of 0.96 the long way round.
    expect(ringDelta(0.02, 0.98)).toBeCloseTo(0.04)
    expect(ringDelta(0.98, 0.02)).toBeCloseTo(-0.04)
  })

  it('never reports more than half the ring either way', () => {
    for (const [a, b] of [[0, 0.5], [0.25, 0.75], [0.9, 0.1], [0.1, 0.9]]) {
      expect(Math.abs(ringDelta(a, b))).toBeLessThanOrEqual(0.5 + 1e-9)
    }
  })

  it('is zero for a point against itself, anywhere on the ring', () => {
    for (const f of [0, 0.25, 0.5, 0.99]) expect(ringDelta(f, f)).toBe(0)
  })
})
