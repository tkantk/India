import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))

describe('generated geo.json', () => {
  it('has all 28 states and 8 union territories', () => {
    const places = Object.values(geo.places)
    expect(places).toHaveLength(36)
    expect(places.filter(p => p.type === 'state')).toHaveLength(28)
    expect(places.filter(p => p.type === 'ut')).toHaveLength(8)
  })

  it('includes Ladakh as a separate union territory (post-2019)', () => {
    expect(geo.places.ladakh?.type).toBe('ut')
  })

  it('has merged Dadra & Nagar Haveli with Daman & Diu (post-2020)', () => {
    expect(geo.places['dadra-and-nagar-haveli-and-daman-and-diu']).toBeDefined()
    expect(geo.places['daman-diu']).toBeUndefined()
  })

  it('gives every place a non-trivial path', () => {
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.d.length, `${slug} has no path data`).toBeGreaterThan(50)
    }
  })

  it('knows Rajasthan touches five states', () => {
    expect(geo.places.rajasthan.neighbours.sort())
      .toEqual(['gujarat', 'haryana', 'madhya-pradesh', 'punjab', 'uttar-pradesh'])
  })

  it('makes neighbour relationships symmetric', () => {
    for (const [slug, p] of Object.entries(geo.places)) {
      for (const n of p.neighbours) {
        expect(geo.places[n].neighbours, `${n} should list ${slug}`).toContain(slug)
      }
    }
  })

  it('gives island territories no land neighbours', () => {
    expect(geo.places.lakshadweep.neighbours).toEqual([])
    expect(geo.places['andaman-nicobar'].neighbours).toEqual([])
  })

  it('keeps every state inside a sane fraction of the viewBox', () => {
    // This is the automated half of the blob check. If the rings are not
    // rewound clockwise, d3 renders each polygon as its own complement and
    // every bbox balloons to span the whole viewBox — measured: Rajasthan
    // goes from [74.7, 254.3, 286.9, 261.7] to [0, 288.8, 1000, 522.3].
    // Without this assertion all the other tests still pass on a broken map.
    const [, , vw, vh] = geo.viewBox
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.bbox[2], `${slug} spans the full viewBox width — rings not rewound?`)
        .toBeLessThan(vw * 0.75)
      expect(p.bbox[3], `${slug} spans the full viewBox height — rings not rewound?`)
        .toBeLessThan(vh * 0.75)
    }
  })

  it('places every state inside the viewBox', () => {
    const [, , vw, vh] = geo.viewBox
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.bbox[0], `${slug} starts left of the viewBox`).toBeGreaterThanOrEqual(-1)
      expect(p.bbox[1], `${slug} starts above the viewBox`).toBeGreaterThanOrEqual(-1)
      expect(p.bbox[0] + p.bbox[2], `${slug} runs off the right`).toBeLessThanOrEqual(vw + 1)
      expect(p.bbox[1] + p.bbox[3], `${slug} runs off the bottom`).toBeLessThanOrEqual(vh + 1)
    }
  })

  it('credits DataMeet, as CC BY 4.0 requires', () => {
    expect(geo.attribution).toContain('DataMeet')
    expect(geo.attribution).toContain('CC BY 4.0')
  })
})
