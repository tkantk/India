import { describe, it, expect } from 'vitest'
import { PlaceSchema, LINE_BUDGET, wordsOf } from './schema'

const validLine = { id: 'raj.intro', kind: 'intro' as const, text: 'Rajasthan is a big state.' }

const validPlace = {
  id: 'rajasthan',
  name: 'Rajasthan',
  type: 'state' as const,
  capital: 'Jaipur',
  ambience: 'desert' as const,
  intro: validLine,
  card: {
    animal: { id: 'raj.card.animal', kind: 'card' as const, text: 'The camel lives here.', sfx: 'camel' },
    food: { id: 'raj.card.food', kind: 'card' as const, text: 'Dal baati churma is crunchy.' },
    festival: { id: 'raj.card.festival', kind: 'card' as const, text: 'Teej is a swing festival.' },
    hello: { id: 'raj.card.hello', kind: 'card' as const, text: 'People say Khamma Ghani.', script: 'खम्मा घणी' },
  },
  landmarks: Array.from({ length: 5 }, (_, i) => ({
    id: `raj.lm.${i}`,
    name: `Place ${i}`,
    photoQuery: `Place ${i}, Rajasthan`,
    scene: 'dunes',
    line: { id: `raj.lm.${i}.line`, kind: 'landmark' as const, text: 'It is very big and sandy.' },
  })),
}

describe('PlaceSchema', () => {
  it('accepts a well-formed place', () => {
    expect(PlaceSchema.safeParse(validPlace).success).toBe(true)
  })

  it('rejects a place with four landmarks — every place needs exactly five', () => {
    const short = { ...validPlace, landmarks: validPlace.landmarks.slice(0, 4) }
    expect(PlaceSchema.safeParse(short).success).toBe(false)
  })

  it('rejects an intro longer than its character budget', () => {
    const fat = { ...validPlace, intro: { ...validLine, text: 'x'.repeat(LINE_BUDGET.intro + 1) } }
    expect(PlaceSchema.safeParse(fat).success).toBe(false)
  })

  it('rejects a cue exactly one word past the end', () => {
    // Must be n, not some large number like 99. With 99 the test still passes
    // when the check is loosened from `>= n` to `> n`, so it would not catch
    // the off-by-one that lets an unreachable cue through.
    const n = wordsOf(validLine.text).length
    const bad = {
      ...validPlace,
      intro: { ...validLine, cues: [{ word: n, do: 'revealSymbol', arg: 'camel' }] },
    }
    expect(PlaceSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a wildly out-of-range cue too', () => {
    const bad = {
      ...validPlace,
      intro: { ...validLine, cues: [{ word: 99, do: 'revealSymbol', arg: 'camel' }] },
    }
    expect(PlaceSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts a cue on the last word', () => {
    const n = wordsOf(validLine.text).length
    const ok = {
      ...validPlace,
      intro: { ...validLine, cues: [{ word: n - 1, do: 'revealSymbol', arg: 'camel' }] },
    }
    expect(PlaceSchema.safeParse(ok).success).toBe(true)
  })
})

describe('wordsOf', () => {
  it('splits on whitespace and keeps punctuation attached', () => {
    expect(wordsOf('Hello, big world!')).toEqual(['Hello,', 'big', 'world!'])
  })

  it('collapses runs of whitespace and newlines', () => {
    expect(wordsOf('  a \n  b  ')).toEqual(['a', 'b'])
  })
})
