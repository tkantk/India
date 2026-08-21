import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))
const hit = JSON.parse(readFileSync('src/data/hit.json', 'utf8'))

describe('generated hit.json', () => {
  it('covers every place in the map', () => {
    expect(Object.keys(hit.places).sort()).toEqual(Object.keys(geo.places).sort())
  })

  it('is dramatically smaller than the visible geometry', () => {
    const visible = Object.values(geo.places).reduce((a, p) => a + p.d.length, 0)
    const hits = Object.values(hit.places).reduce((a, p) => a + p.d.length, 0)
    expect(hits).toBeLessThan(visible * 0.25)
  })

  it('keeps each simplified path inside its own bounding box', () => {
    for (const [slug, p] of Object.entries(hit.places)) {
      const [x, y, w, h] = geo.places[slug].bbox
      const nums = p.d.match(/-?\d+(\.\d+)?/g).map(Number)
      for (let i = 0; i + 1 < nums.length; i += 2) {
        expect(nums[i], `${slug} x`).toBeGreaterThanOrEqual(x - 2)
        expect(nums[i], `${slug} x`).toBeLessThanOrEqual(x + w + 2)
        expect(nums[i + 1], `${slug} y`).toBeGreaterThanOrEqual(y - 2)
        expect(nums[i + 1], `${slug} y`).toBeLessThanOrEqual(y + h + 2)
      }
    }
  })

  it('gives every place a pin inside its own bounding box', () => {
    for (const [slug, p] of Object.entries(hit.places)) {
      const [x, y, w, h] = geo.places[slug].bbox
      expect(p.pin[0]).toBeGreaterThanOrEqual(x)
      expect(p.pin[0]).toBeLessThanOrEqual(x + w)
      expect(p.pin[1]).toBeGreaterThanOrEqual(y)
      expect(p.pin[1]).toBeLessThanOrEqual(y + h)
    }
  })

  it('gives the tiny territories a pin, because their shapes are unhittable', () => {
    for (const slug of ['lakshadweep', 'chandigarh', 'delhi', 'goa', 'sikkim']) {
      expect(hit.places[slug]?.pin, `${slug} needs a pin`).toBeDefined()
    }
  })
})

// The brief's five tests above check the contract. These check the two
// properties the generator exists for, which a bbox test cannot see.
describe('the hit geometry is actually usable', () => {
  const parseRings = (d) => d.split('M').filter((s) => s.trim()).map((chunk) => {
    const nums = chunk.match(/-?\d+(?:\.\d+)?/g).map(Number)
    const ring = []
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]])
    return ring
  })
  const signedArea = (r) => {
    let a = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
    return a / 2
  }
  const inRing = ([px, py], r) => {
    let inside = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j]
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  const covers = (rings, p) =>
    rings.filter((r) => signedArea(r) > 0).some((r) => inRing(p, r)) &&
    !rings.filter((r) => signedArea(r) < 0).some((r) => inRing(p, r))

  it('puts every pin on the land it belongs to, not merely in its bounding box', () => {
    for (const [slug, p] of Object.entries(hit.places)) {
      expect(covers(parseRings(p.d), p.pin), `${slug}'s pin is off its own shape`).toBe(true)
    }
  })

  // This is why the pin is the pole of inaccessibility and not geo.json's
  // centroid, which is already sitting right there in the data.
  it('beats the centroid, which for three territories is out at sea', () => {
    const stranded = Object.keys(hit.places)
      .filter((slug) => !covers(parseRings(hit.places[slug].d), geo.places[slug].centroid))
    expect(stranded.sort()).toEqual(['andaman-nicobar', 'lakshadweep', 'puducherry'])
  })

  it('records how much room each shape has, so the map can size a tap target', () => {
    for (const [slug, p] of Object.entries(hit.places)) {
      expect(p.r, `${slug} has no inscribed radius`).toBeTypeOf('number')
      expect(p.r, `${slug}`).toBeGreaterThan(0)
    }
    // The 22-unit eligibility threshold falls in a real gap in the data:
    // Manipur, the LARGEST place that still gets a pin, has 20.9 units of
    // room; Haryana, the SMALLEST that does not, has 24.4. Nothing is
    // borderline. (`pinned` is `r < 22`, so small radius means pinned.)
    const radii = Object.values(hit.places).map((p) => p.r).sort((a, b) => a - b)
    expect(radii.filter((r) => r > 20.5 && r < 24)).toHaveLength(1)
  })

  it('keeps every place inside the point budget the byte budget depends on', () => {
    for (const [slug, p] of Object.entries(hit.places)) {
      const points = p.d.match(/,/g)?.length ?? 0
      expect(points, `${slug} blew the point budget`).toBeLessThanOrEqual(100)
    }
  })
})

// MapStage injects both files' path data with dangerouslySetInnerHTML, and
// does not escape the geometry — only the place names, which come from
// DataMeet's shapefile. That is only safe while the geometry really is
// nothing but coordinates, so this checks it rather than assuming it.
describe('the injected geometry', () => {
  it('is coordinates and nothing else, in both files', () => {
    const PATH_ONLY = /^[MLZ0-9.,\-]+$/
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(PATH_ONLY.test(p.d), `geo.json: ${slug} has non-path characters`).toBe(true)
    }
    for (const [slug, p] of Object.entries(hit.places)) {
      expect(PATH_ONLY.test(p.d), `hit.json: ${slug} has non-path characters`).toBe(true)
    }
  })
})

// A single pin radius for all fourteen places cannot work: the two offshore
// territories have hundreds of units of empty sea around them and are exactly
// the ones a child cannot find, while Delhi and Chandigarh sit on top of their
// neighbours' poles. These are the invariants that let each pin be as big as
// its own surroundings allow.
describe('per-place pin radii', () => {
  const entries = Object.entries(hit.places)
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

  it('gives every place a pin radius', () => {
    for (const [slug, p] of entries) {
      expect(p.pinR, `${slug} has no pin radius`).toBeTypeOf('number')
      expect(p.pinR, `${slug}`).toBeGreaterThan(0)
    }
  })

  it('never lets a pin swallow another place´s pole', () => {
    // A pole is a place's tap point of last resort. Covering one would make
    // that place unreachable however carefully a child aimed.
    for (const [slug, p] of entries) {
      for (const [other, q] of entries) {
        if (other === slug) continue
        expect(dist(p.pin, q.pin), `${slug}'s pin covers ${other}'s pole`)
          .toBeGreaterThanOrEqual(p.pinR)
      }
    }
  })

  it('never lets two pins overlap', () => {
    // Falls out of the rule above, and is worth asserting separately because
    // it is what makes the painting order of the pins irrelevant.
    for (const [slug, p] of entries) {
      for (const [other, q] of entries) {
        if (other === slug) continue
        expect(dist(p.pin, q.pin), `${slug} and ${other} have overlapping pins`)
          .toBeGreaterThanOrEqual(p.pinR + q.pinR - 0.2) // 0.1 rounding, twice
      }
    }
  })

  it('always reaches past the shape it is standing in for', () => {
    // If the pin were smaller than the place's own inscribed circle it would
    // sit uselessly inside a shape that was already easier to hit.
    for (const [slug, p] of entries.filter(([, q]) => q.r < 22)) {
      expect(p.pinR, `${slug}'s pin is smaller than the place itself`).toBeGreaterThan(p.r)
    }
  })

  it('gives the offshore territories a genuinely child-sized target', () => {
    // Empty sea all around, and the two places a child is least able to find.
    expect(hit.places['andaman-nicobar'].pinR).toBeGreaterThanOrEqual(100)
    expect(hit.places.lakshadweep.pinR).toBeGreaterThanOrEqual(70)
  })

  it('holds Delhi and Chandigarh back, because their neighbours are underneath', () => {
    // These two are why a uniform 22 was wrong in the other direction: it was
    // taking a quarter of Haryana's interior.
    expect(hit.places.delhi.pinR).toBeLessThan(22)
    expect(hit.places.chandigarh.pinR).toBeLessThan(22)
  })
})
