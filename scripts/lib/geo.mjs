/** DataMeet's ST_NM strings are internally inconsistent — "Jammu & Kashmir"
 *  uses '&' while "Dadra and Nagar Haveli and Daman and Diu" spells out "and".
 *  Everything downstream joins on the slug, so this must be the only
 *  normalisation in the codebase. */
export function slugify(name) {
  return name
    .replace(/&/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const UNION_TERRITORIES = new Set([
  'andaman-nicobar',
  'chandigarh',
  'dadra-and-nagar-haveli-and-daman-and-diu',
  'delhi',
  'jammu-kashmir',
  'ladakh',
  'lakshadweep',
  'puducherry',
])

export function classify(name) {
  return UNION_TERRITORIES.has(slugify(name)) ? 'ut' : 'state'
}

/** Two places are neighbours if their rings share at least two vertices
 *  within `tol` degrees. Two, not one, so a single touching corner
 *  (e.g. the old Chhattisgarh/UP tripoint) does not count as a border. */
export function shareBorder(ringsA, ringsB, tol = 1e-4) {
  const key = ([x, y]) => `${Math.round(x / tol)}:${Math.round(y / tol)}`
  const seen = new Set()
  for (const ring of ringsA) for (const pt of ring) seen.add(key(pt))
  let hits = 0
  for (const ring of ringsB) {
    for (const pt of ring) {
      if (seen.has(key(pt)) && ++hits >= 2) return true
    }
  }
  return false
}

/** Bounding box of an SVG path, in viewBox units. Used as the zoom target. */
export function boundsOf(d) {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i], y = nums[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX - minX, maxY - minY]
}

// ------------------------------------------------- Ramer-Douglas-Peucker
//
// Shared by build-map.mjs (simplifying the visible geometry, per ring, to a
// screen-space error) and build-hitlayer.mjs (simplifying the hit geometry
// to a shared point budget) — both need the identical closed-ring RDP
// primitive, so it lives here once rather than as two copies that could
// silently drift apart.

/** Squared distance from p to the segment ab. Squared, so the inner loop of
 *  both RDP and a pole-of-inaccessibility search stays free of sqrt. */
export function segDist2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  let t = len === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx - px, qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/** RDP over an open polyline. Both endpoints are always kept. */
export function rdp(pts, eps2) {
  if (pts.length < 3) return pts.slice()
  const a = pts[0], b = pts[pts.length - 1]
  let idx = -1, worst = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist2(pts[i], a, b)
    if (d > worst) { worst = d; idx = i }
  }
  if (worst <= eps2) return [a, b]
  const left = rdp(pts.slice(0, idx + 1), eps2)
  const right = rdp(pts.slice(idx), eps2)
  return left.slice(0, -1).concat(right)
}

/**
 * RDP over a closed ring. A ring has no endpoints to anchor, so it is cut at
 * its first point and at the point furthest from it, and the two halves are
 * simplified separately. Running RDP straight along the ring as if it were an
 * open line collapses it towards a single spike instead.
 */
export function simplifyRing(ring, eps) {
  if (ring.length < 4) return ring
  let far = 0, best = -1
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i][0] - ring[0][0], dy = ring[i][1] - ring[0][1]
    const d = dx * dx + dy * dy
    if (d > best) { best = d; far = i }
  }
  const eps2 = eps * eps
  const head = rdp(ring.slice(0, far + 1), eps2)
  const tail = rdp(ring.slice(far).concat([ring[0]]), eps2)
  // Drop each half's trailing anchor: `head` ends where `tail` begins, and
  // `tail` ends back at ring[0], which Z re-supplies.
  return head.slice(0, -1).concat(tail.slice(0, -1))
}
