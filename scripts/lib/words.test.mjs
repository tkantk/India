import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
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

/**
 * The third argument: how long each picture stays, derived from the clip's
 * own duration rather than a hardcoded per-verb constant. See
 * .superpowers/sdd/2026-08-22-03-make-it-work/task-3-brief.md — the formula
 * is `hold = clamp(min(nextIndependentArtCue.t, duration) - t, MIN_HOLD, CAP[verb])`.
 */
describe('cueTimes: the derived hold', () => {
  // Five words a second apart, art cues on four of them.
  const timings = {
    words: ['a', 'b', 'c', 'd', 'e'],
    starts: [0, 2, 5, 8, 12],
    ends: [1, 3, 6, 9, 13],
  }

  it('holds a lone reveal all the way to the end of its clip', () => {
    const [cue] = cueTimes([{ word: 0, do: 'revealSymbol', arg: 'tiger' }], timings, 15)
    expect(cue.hold).toBe(15000)
  })

  it('holds each of several independent reveals only until the next one', () => {
    // tour.09's shape: lotus, banyan, mango — three cards in one beat, none
    // of them accumulating, so each one is cut short by the next.
    const cues = cueTimes([
      { word: 0, do: 'revealSymbol', arg: 'lotus' },
      { word: 1, do: 'revealSymbol', arg: 'banyan' },
      { word: 2, do: 'revealSymbol', arg: 'mango' },
    ], timings, 15)
    expect(cues.map((c) => c.hold)).toEqual([2000, 3000, 10000])
  })

  it('does not let two seas truncate each other — both hold past the second one', () => {
    const cues = cueTimes([
      { word: 0, do: 'revealSymbol', arg: 'arabian-sea' },
      { word: 1, do: 'revealSymbol', arg: 'bay-of-bengal' },
    ], timings, 15)
    // The first sea is not cut short by the second: it runs to the clip's
    // end, exactly as if the second cue were not an independent art cue.
    expect(cues[0].hold).toBe(15000)
    expect(cues[1].hold).toBe(13000)
  })

  it('does not let two showScript cues truncate each other either', () => {
    const cues = cueTimes([
      { word: 0, do: 'showScript', arg: 'namaste' },
      { word: 1, do: 'showScript', arg: 'namaskar' },
    ], timings, 15)
    expect(cues[0].hold).toBe(15000)
    expect(cues[1].hold).toBe(13000)
  })

  it('lets a sea group be closed off by a later, independent art cue', () => {
    const cues = cueTimes([
      { word: 0, do: 'revealSymbol', arg: 'arabian-sea' },
      { word: 1, do: 'revealSymbol', arg: 'bay-of-bengal' },
      { word: 2, do: 'revealSymbol', arg: 'tiger' },
    ], timings, 15)
    // Both seas now stop at the tiger, which is not one of them, and the
    // tiger — the only art cue left — holds to the clip's own end.
    expect(cues[0].hold).toBe(5000)
    expect(cues[1].hold).toBe(3000)
    expect(cues[2].hold).toBe(10000)
  })

  it('caps countTo at 5000ms while leaving every other verb uncapped', () => {
    const [cue] = cueTimes([{ word: 0, do: 'countTo', arg: '28' }], timings, 30)
    expect(cue.hold).toBe(5000)
  })

  it('treats zoomTo as an art verb with its own derived hold', () => {
    // Easy to get wrong: zoomTo looks like pure camera work, but it also
    // raises the "look down" ring, which needs its own lifetime.
    const [cue] = cueTimes([{ word: 0, do: 'zoomTo', arg: 'delhi' }], timings, 15)
    expect(cue.hold).toBe(15000)
  })

  it('floors a very short hold at MIN_HOLD (1000ms)', () => {
    const tight = { words: ['a', 'b'], starts: [0, 0.5], ends: [0.4, 1] }
    const cues = cueTimes([
      { word: 0, do: 'revealSymbol', arg: 'tiger' },
      { word: 1, do: 'revealSymbol', arg: 'peacock' },
    ], tight, 5)
    // The raw gap is 500ms; the floor is 1000ms.
    expect(cues[0].hold).toBe(1000)
  })

  it('gives non-art verbs no hold at all', () => {
    const cues = cueTimes([
      { word: 0, do: 'playSfx', arg: 'tiger-growl' },
      { word: 1, do: 'highlightAllStates' },
      { word: 2, do: 'highlightUnionTerritories' },
      { word: 3, do: 'highlightState', arg: 'goa' },
      { word: 4, do: 'lightNeighbour', arg: 'goa' },
    ], timings, 15)
    for (const c of cues) expect(c.hold).toBeUndefined()
  })

  it('falls back to no hold at all when resolved without a duration', () => {
    // The draft-voice pipeline and the single-effect tests run this way —
    // every effect then falls back to its own constant.
    const cues = cueTimes([{ word: 0, do: 'revealSymbol', arg: 'tiger' }], timings)
    expect(cues[0].hold).toBeUndefined()
    expect(cues[0]).toEqual({ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger' })
  })
})

/**
 * The table in the brief was computed from the real, shipped files — not
 * from a synthetic fixture — so this is the check that actually matters:
 * run `cueTimes` against `content/tour.json` and `src/data/timings.json`
 * and land on the exact numbers the brief verified by hand.
 */
describe('cueTimes against the shipped tour', () => {
  const tour = JSON.parse(readFileSync('content/tour.json', 'utf8'))
  const shipped = JSON.parse(readFileSync('src/data/timings.json', 'utf8'))

  const beat = (id) => tour.beats.find((b) => b.id === id)
  const holdsFor = (id) => {
    const clip = shipped[id]
    return cueTimes(beat(id).cues, clip, clip.duration)
  }
  const seconds = (ms) => ms / 1000

  it('tour.02: the outline holds to the end of its beat (9.0 -> 15.86)', () => {
    const [outline] = holdsFor('tour.02')
    expect(seconds(outline.hold)).toBeCloseTo(15.86, 1)
  })

  it('tour.03/04: the state and UT counters are capped at 5s though derived is far more', () => {
    expect(holdsFor('tour.03').find((c) => c.do === 'countTo').hold).toBe(5000)
    expect(holdsFor('tour.04').find((c) => c.do === 'countTo').hold).toBe(5000)
  })

  it('tour.05: zoomTo is art and its hold matches the Delhi ring; india-gate takes the rest', () => {
    const [zoomTo, indiaGate] = holdsFor('tour.05')
    expect(seconds(zoomTo.hold)).toBeCloseTo(8.80, 1)
    expect(seconds(indiaGate.hold)).toBeCloseTo(1.48, 1)
  })

  it('tour.06: the flag holds until the counter, which then holds to the beat end', () => {
    const [flag, counter] = holdsFor('tour.06')
    expect(seconds(flag.hold)).toBeCloseTo(19.45, 1)
    expect(seconds(counter.hold)).toBeCloseTo(1.63, 1)
  })

  it('tour.07: the tiger holds more than twice as long as the old constant', () => {
    const [tiger] = holdsFor('tour.07')
    expect(seconds(tiger.hold)).toBeCloseTo(14.48, 1)
  })

  it('tour.08: the peacock holds to the end of its beat', () => {
    const [peacock] = holdsFor('tour.08')
    expect(seconds(peacock.hold)).toBeCloseTo(15.27, 1)
  })

  it('tour.09: lotus, banyan and mango each hold only until the next', () => {
    const [lotus, banyan, mango] = holdsFor('tour.09').filter((c) => c.do === 'revealSymbol')
    expect(seconds(lotus.hold)).toBeCloseTo(11.38, 1)
    expect(seconds(banyan.hold)).toBeCloseTo(7.73, 1)
    expect(seconds(mango.hold)).toBeCloseTo(1.11, 1)
  })

  it('tour.10: the Ganga holds to the end of its beat', () => {
    const [ganga] = holdsFor('tour.10')
    expect(seconds(ganga.hold)).toBeCloseTo(13.90, 1)
  })

  it('tour.11: the Himalaya hold to the end of their beat', () => {
    const [himalaya] = holdsFor('tour.11')
    expect(seconds(himalaya.hold)).toBeCloseTo(15.17, 1)
  })

  it('tour.12: the three seas accumulate and all land together on the beat end', () => {
    const [arabian, bengal, ocean] = holdsFor('tour.12')
    expect(seconds(arabian.hold)).toBeCloseTo(10.02, 1)
    expect(seconds(bengal.hold)).toBeCloseTo(6.41, 1)
    expect(seconds(ocean.hold)).toBeCloseTo(1.60, 1)
  })

  it('tour.13: the three greetings accumulate and all land together on the beat end', () => {
    const [namaste, namaskar, vanakkam] = holdsFor('tour.13')
    expect(seconds(namaste.hold)).toBeCloseTo(7.42, 1)
    expect(seconds(namaskar.hold)).toBeCloseTo(5.89, 1)
    expect(seconds(vanakkam.hold)).toBeCloseTo(4.32, 1)
  })
})
