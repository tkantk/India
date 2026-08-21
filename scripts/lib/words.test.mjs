import { describe, it, expect } from 'vitest'
import { wordSpans, timingsFromAlignment, estimateTimings, cueTimes } from './words.mjs'

describe('wordSpans', () => {
  it('reports the character offsets of each word', () => {
    expect(wordSpans('Hi big sea')).toEqual([
      { word: 'Hi', start: 0, end: 2 },
      { word: 'big', start: 3, end: 6 },
      { word: 'sea', start: 7, end: 10 },
    ])
  })

  it('keeps punctuation attached to its word', () => {
    expect(wordSpans('Look, a tiger!').map(s => s.word)).toEqual(['Look,', 'a', 'tiger!'])
  })

  it('handles leading and repeated whitespace', () => {
    expect(wordSpans('  a   b ')).toEqual([
      { word: 'a', start: 2, end: 3 },
      { word: 'b', start: 6, end: 7 },
    ])
  })
})

describe('timingsFromAlignment', () => {
  const text = 'Hi big'
  const alignment = {
    characters: ['H', 'i', ' ', 'b', 'i', 'g'],
    character_start_times_seconds: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  }

  it('takes each word start from its first character and end from its last', () => {
    expect(timingsFromAlignment(text, alignment)).toEqual({
      words: ['Hi', 'big'],
      starts: [0.0, 0.3],
      ends: [0.2, 0.6],
    })
  })

  it('throws if the alignment does not match the submitted text', () => {
    const drifted = { ...alignment, characters: ['H', 'i', ' ', 'b', 'i', 'X'] }
    expect(() => timingsFromAlignment(text, drifted)).toThrow(/does not match/)
  })
})

describe('estimateTimings', () => {
  it('spreads the duration across words by character weight', () => {
    const t = estimateTimings('aa bbbb', 6)
    expect(t.words).toEqual(['aa', 'bbbb'])
    expect(t.starts[0]).toBe(0)
    expect(t.ends[1]).toBeCloseTo(6, 5)
    expect(t.ends[1] - t.starts[1]).toBeGreaterThan(t.ends[0] - t.starts[0])
  })

  it('gives a sentence-ending word extra time for the pause after it', () => {
    const withStop = estimateTimings('aa. bb', 6)
    const without = estimateTimings('aa bb', 6)
    expect(withStop.ends[0] - withStop.starts[0])
      .toBeGreaterThan(without.ends[0] - without.starts[0])
  })

  it('never returns a word that starts before the previous one ends', () => {
    const t = estimateTimings('one two three four five', 10)
    for (let i = 1; i < t.starts.length; i++) {
      expect(t.starts[i]).toBeGreaterThanOrEqual(t.ends[i - 1] - 1e-9)
    }
  })
})

describe('agreement with the schema', () => {
  it('splits words exactly as content/schema.ts does', async () => {
    // Two definitions of "a word" exist: wordsOf() drives cue validation and
    // wordSpans() drives the timings. If they ever drift, every cue after the
    // divergence fires on the wrong word.
    const { wordsOf } = await import('../../content/schema.ts')
    for (const t of ['Hi big sea', 'Look, a tiger!', '  a   b ', 'nine hundred and fifty-three.']) {
      expect(wordSpans(t).map(s => s.word)).toEqual(wordsOf(t))
    }
  })
})

describe('cueTimes', () => {
  const timings = { words: ['a', 'b', 'c'], starts: [0, 1, 2], ends: [1, 2, 3] }

  it('resolves a word index to the moment that word begins', () => {
    expect(cueTimes([{ word: 2, do: 'playSfx', arg: 'growl' }], timings))
      .toEqual([{ t: 2, word: 2, do: 'playSfx', arg: 'growl' }])
  })

  it('sorts cues by time so the player can walk them with one cursor', () => {
    const out = cueTimes([
      { word: 2, do: 'playSfx' },
      { word: 0, do: 'unfurlFlag' },
    ], timings)
    expect(out.map(c => c.t)).toEqual([0, 2])
  })

  it('throws on a cue past the end rather than silently dropping it', () => {
    expect(() => cueTimes([{ word: 7, do: 'playSfx' }], timings)).toThrow(/out of range/)
  })
})
