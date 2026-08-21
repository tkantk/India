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

  it('credits DataMeet, as CC BY 4.0 requires', () => {
    expect(geo.attribution).toContain('DataMeet')
    expect(geo.attribution).toContain('CC BY 4.0')
  })
})
