import { describe, it, expect } from 'vitest'
import { slugify, classify, shareBorder, boundsOf } from './geo.mjs'

describe('slugify', () => {
  it('normalises ampersands and spaces the same way for every state', () => {
    expect(slugify('Jammu & Kashmir')).toBe('jammu-kashmir')
    expect(slugify('Andaman & Nicobar')).toBe('andaman-nicobar')
    expect(slugify('Dadra and Nagar Haveli and Daman and Diu'))
      .toBe('dadra-and-nagar-haveli-and-daman-and-diu')
    expect(slugify('Tamil Nadu')).toBe('tamil-nadu')
  })
})

describe('classify', () => {
  it('knows the eight union territories', () => {
    expect(classify('Delhi')).toBe('ut')
    expect(classify('Ladakh')).toBe('ut')
    expect(classify('Jammu & Kashmir')).toBe('ut')
    expect(classify('Puducherry')).toBe('ut')
    expect(classify('Chandigarh')).toBe('ut')
    expect(classify('Lakshadweep')).toBe('ut')
    expect(classify('Andaman & Nicobar')).toBe('ut')
    expect(classify('Dadra and Nagar Haveli and Daman and Diu')).toBe('ut')
  })
  it('treats everything else as a state', () => {
    expect(classify('Rajasthan')).toBe('state')
    expect(classify('Telangana')).toBe('state')
  })
})

describe('shareBorder', () => {
  const square = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
  const touching = [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]]
  const distant = [[[9, 9], [10, 9], [10, 10], [9, 10], [9, 9]]]

  it('finds neighbours that share at least two boundary points', () => {
    expect(shareBorder(square, touching, 1e-6)).toBe(true)
  })
  it('does not invent neighbours across open water', () => {
    expect(shareBorder(square, distant, 1e-6)).toBe(false)
  })
})

describe('boundsOf', () => {
  it('returns [x, y, width, height] from an SVG path', () => {
    expect(boundsOf('M10,20L30,20L30,60Z')).toEqual([10, 20, 20, 40])
  })
})
