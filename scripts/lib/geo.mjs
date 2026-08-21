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
