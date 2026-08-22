/**
 * Pure geometry for tracing a closed outline with a finger.
 *
 * No DOM and no React here on purpose: `Trace.tsx` is the only thing that
 * ever touches a pointer event, and everything that decides WHERE along the
 * path a touch lands is a plain function over numbers, so it can be tested
 * directly against a known shape rather than through a browser's own (and in
 * jsdom's case, absent) hit-testing.
 *
 * Every path handled here is straight-line only — `M x,y L x,y ... Z` — the
 * same simplified form `hitLayer.ts`'s `buildOutlines` already parses for
 * the map's own hit layer. Nothing here assumes it is INDIA_OUTLINE
 * specifically: a single closed ring in any coordinate space works, which is
 * what lets a future state screen trace its own border with the same code.
 */

export type Point = [number, number]

export type TracePath = {
  /** The ring's vertices, closed: the first point is also the last. */
  points: Point[]
  /** Cumulative length up to each point, same length as `points`. */
  cum: number[]
  /** The ring's total perimeter. 0 for a degenerate (empty or single-point)
   *  path. */
  total: number
}

/** Parse one closed ring — "M x,y L x,y L x,y ... Z" — into a flat vertex
 *  list. The `M`/`L`/`Z` letters are discarded; only the numbers matter, the
 *  same tolerant parse `hitLayer.ts` uses. */
function parseRing(d: string): Point[] {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const points: Point[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]])
  return points
}

/**
 * Build the arc-length table a trace is measured against: every vertex,
 * closed back to the first, with the running distance up to each one.
 *
 * Built once per path (memoised by the caller) and never rebuilt per event —
 * the only thing that runs on a pointer event is `nearestOnPath`, a single
 * pass over vertices already sitting in memory.
 */
export function buildTracePath(d: string): TracePath {
  const raw = parseRing(d)
  if (raw.length < 2) return { points: raw, cum: raw.map(() => 0), total: 0 }

  const points = [...raw, raw[0]]
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay))
  }
  return { points, cum, total: cum[cum.length - 1] }
}

/**
 * Where a point falls against the path: how far away, and how far along the
 * ring's own perimeter the nearest point on it is, as a fraction from 0 (the
 * path's start) to 1 (all the way round).
 *
 * `fraction` is the whole reason this exists rather than a flat
 * point-in-radius check: it is what feeds `pathLength`, so a touch near the
 * end of a long straight stretch reports a fraction near where THAT stretch
 * sits on the ring, not a value derived from raw (x, y) — two points can
 * share an (x, y) neighbourhood and still be far apart in arc length (a bay
 * whose two shores nearly touch), and it is the arc length a `pathLength`
 * draw-on obeys.
 */
export function nearestOnPath(path: TracePath, x: number, y: number): { distance: number; fraction: number } {
  const { points, cum, total } = path
  if (total === 0 || points.length < 2) return { distance: Infinity, fraction: 0 }

  let bestD2 = Infinity
  let bestFraction = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const qx = ax + t * dx
    const qy = ay + t * dy
    const d2 = (qx - x) ** 2 + (qy - y) ** 2
    if (d2 < bestD2) {
      bestD2 = d2
      bestFraction = (cum[i - 1] + t * Math.sqrt(len2)) / total
    }
  }
  return { distance: Math.sqrt(bestD2), fraction: bestFraction }
}

/**
 * Points spaced evenly along the ring, `spacing` apart in the same units as
 * the path's own coordinates.
 *
 * This is the hit corridor: `Trace.tsx` puts an invisible, generously-sized
 * circle at each one, so a finger anywhere close to the edge lands on SOME
 * circle. Spacing at or under the circles' own radius is what guarantees no
 * gap between neighbours for a finger to fall through.
 */
export function resamplePath(path: TracePath, spacing: number): Point[] {
  const { points, cum, total } = path
  if (total === 0 || spacing <= 0) return []

  const out: Point[] = []
  let i = 1
  for (let s = 0; s <= total; s += spacing) {
    while (i < cum.length - 1 && cum[i] < s) i++
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const segLen = cum[i] - cum[i - 1]
    const t = segLen === 0 ? 0 : (s - cum[i - 1]) / segLen
    out.push([ax + t * (bx - ax), ay + t * (by - ay)])
  }
  return out
}
