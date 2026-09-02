import { describe, it, expect } from 'vitest'
import { pagedScrollTop } from './readAlongScroll'

describe('pagedScrollTop', () => {
  it('does nothing while the lit word is already inside the visible window', () => {
    // A 100px window, scrolled to 40; a word sitting comfortably inside it.
    expect(pagedScrollTop({
      wordTop: 50, wordBottom: 68, scrollTop: 40, viewHeight: 100, scrollHeight: 1000,
    })).toBeNull()
  })

  it('does nothing when the word exactly fills the visible edges', () => {
    expect(pagedScrollTop({
      wordTop: 40, wordBottom: 140, scrollTop: 40, viewHeight: 100, scrollHeight: 1000,
    })).toBeNull()
  })

  it('pages forward once the word has gone below the fold, landing it near the top rather than nudging it up by one line', () => {
    // Window shows 0..100; the word is at 220..238, well past the bottom.
    const target = pagedScrollTop({
      wordTop: 220, wordBottom: 238, scrollTop: 0, viewHeight: 100, scrollHeight: 1000,
    })
    // Not "scroll by one line" (e.g. 138) — the word lands near the TOP of a
    // fresh page, with a little headroom above it.
    expect(target).toBe(220 - 8)
  })

  it('pages backward too — a replay from the top can leave the window scrolled past word one', () => {
    const target = pagedScrollTop({
      wordTop: 10, wordBottom: 28, scrollTop: 400, viewHeight: 100, scrollHeight: 1000,
    })
    expect(target).toBe(Math.max(0, 10 - 8))
  })

  it('never asks for a negative scrollTop even with no headroom to spare', () => {
    const target = pagedScrollTop({
      wordTop: 2, wordBottom: 20, scrollTop: 400, viewHeight: 100, scrollHeight: 1000,
    })
    expect(target).toBe(0)
  })

  it('clamps to the scroller\'s own reachable maximum — the last word of a sentence never asks for more scroll than exists', () => {
    // scrollHeight 300, viewHeight 100 -> the furthest this can ever scroll is 200.
    const target = pagedScrollTop({
      wordTop: 280, wordBottom: 296, scrollTop: 0, viewHeight: 100, scrollHeight: 300,
    })
    expect(target).toBe(200)
  })

  it('never scrolls a box that has nothing to scroll (word 1, nothing has overflowed yet)', () => {
    expect(pagedScrollTop({
      wordTop: 5, wordBottom: 20, scrollTop: 0, viewHeight: 100, scrollHeight: 100,
    })).toBeNull()
  })
})
