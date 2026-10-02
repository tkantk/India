import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { addStamp, hasStamp, stampedSlugs, PASSPORT_KEY, resetPassportForTests } from './passport'

describe('the passport', () => {
  beforeEach(() => {
    localStorage.clear()
    resetPassportForTests()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts empty', () => {
    expect(stampedSlugs()).toEqual([])
    expect(hasStamp('kerala')).toBe(false)
  })

  it('stamps a place once, and says whether this was the first time', () => {
    // The caller plays "Well done! You have a new stamp." only when this is
    // true, so a revisit must never claim a NEW stamp it already had.
    expect(addStamp('kerala')).toBe(true)
    expect(addStamp('kerala')).toBe(false)
    expect(stampedSlugs()).toEqual(['kerala'])
  })

  it('keeps stamps in the order they were earned', () => {
    addStamp('kerala', 1)
    addStamp('odisha', 2)
    addStamp('delhi', 3)
    expect(stampedSlugs()).toEqual(['kerala', 'odisha', 'delhi'])
  })

  // The whole point of a passport is that it is still there tomorrow.
  it('survives a reload: the stamps are read back from the device', () => {
    addStamp('kerala')
    addStamp('assam')
    resetPassportForTests() // forget everything held in memory, as a reload does
    expect(stampedSlugs()).toEqual(['kerala', 'assam'])
  })

  it('reads a corrupted record as empty rather than throwing', () => {
    localStorage.setItem(PASSPORT_KEY, '{not json')
    expect(stampedSlugs()).toEqual([])
    expect(addStamp('kerala')).toBe(true)
  })

  it('drops malformed entries but keeps the good ones', () => {
    localStorage.setItem(PASSPORT_KEY, JSON.stringify({
      v: 1,
      stamps: [
        { slug: 'kerala', at: 1 },
        { slug: 42, at: 2 },
        { nope: true },
        'odisha',
        { slug: 'kerala', at: 3 }, // a duplicate: the first one wins
        { slug: 'delhi', at: 4 },
      ],
    }))
    expect(stampedSlugs()).toEqual(['kerala', 'delhi'])
  })

  it('can be limited to the places that actually exist', () => {
    addStamp('kerala')
    addStamp('atlantis')
    expect(stampedSlugs(new Set(['kerala', 'odisha']))).toEqual(['kerala'])
  })

  // iPad Safari's Private Browsing, a full disk, or a grown-up who has
  // turned off website data: storage throws. The child must still get the
  // stamp for this visit — it just will not outlive the tab.
  it('still works for this visit when the device refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    resetPassportForTests()
    expect(stampedSlugs()).toEqual([])
    expect(addStamp('kerala')).toBe(true)
    expect(hasStamp('kerala')).toBe(true)
    expect(addStamp('kerala')).toBe(false)
  })

  // Spec §12: "The only stored state is the passport, in localStorage on the
  // device." One key, and nothing in it but slugs and times.
  it('stores nothing but which places were finished and when', () => {
    addStamp('kerala', 1700000000000)
    const raw = JSON.parse(localStorage.getItem(PASSPORT_KEY)!)
    expect(raw).toEqual({ v: 1, stamps: [{ slug: 'kerala', at: 1700000000000 }] })
    expect(Object.keys(localStorage)).toEqual([PASSPORT_KEY])
  })
})
