import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PlaceSchema, LINE_BUDGET, wordsOf } from './schema'
import type { Cue, Landmark, Line, Place, TourBeat } from './schema'

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

// Plan 4 / Task 1: thirteen narration lines a factual audit found wrong,
// misleading, or imprecise. Reads the real shipped content — not a fixture —
// because the point is that the actual files say the corrected thing, and
// that every cue that survives an edit still points at the word it names.
// content/tour.json cues address a word index, never a timestamp, so a cue
// whose sentence grew or shrank around it silently points at the wrong word
// unless something asserts the landing word by name, not just by number.
describe('Plan 4 Task 1: the thirteen audited narration lines', () => {
  // Typed as the schema's own inferred types — not re-declared inline — so a
  // cue keeps its real shape (word, do, arg) all the way through. An earlier
  // version of this file hand-rolled narrow parameter types on the helpers
  // below (e.g. `{ do: string }`), which silently dropped `word` from every
  // cue read through them; that was a bug in the test, not in the schema.
  const tour: { beats: TourBeat[] } = JSON.parse(readFileSync('content/tour.json', 'utf8'))
  const delhi: Place = JSON.parse(readFileSync('content/places/delhi.json', 'utf8'))
  const rajasthan: Place = JSON.parse(readFileSync('content/places/rajasthan.json', 'utf8'))
  const kerala: Place = JSON.parse(readFileSync('content/places/kerala.json', 'utf8'))

  // `.find()` returns `T | undefined`; a lookup that assumes its target
  // exists should say so and fail with a clear message, rather than a
  // "possibly undefined" compile error or an opaque runtime crash if the
  // content ever changes underneath it.
  function must<T>(value: T | undefined, message: string): T {
    if (value === undefined) throw new Error(message)
    return value
  }

  const beat = (id: string): TourBeat => must(tour.beats.find((b) => b.id === id), `no tour beat "${id}"`)
  const landmark = (place: Place, id: string): Landmark =>
    must(place.landmarks.find((l) => l.id === id), `no landmark "${id}" on "${place.id}"`)
  const findCue = (line: Line, predicate: (c: Cue) => boolean, label: string): Cue =>
    must(line.cues?.find(predicate), `no ${label} cue on "${line.id}"`)
  const cueByVerb = (line: Line, verb: string): Cue => findCue(line, (c) => c.do === verb, `"${verb}"`)
  const cueByArg = (line: Line, arg: string): Cue => findCue(line, (c) => c.arg === arg, `arg "${arg}"`)

  it('every edited place still satisfies PlaceSchema', () => {
    expect(PlaceSchema.safeParse(delhi).success).toBe(true)
    expect(PlaceSchema.safeParse(rajasthan).success).toBe(true)
    expect(PlaceSchema.safeParse(kerala).success).toBe(true)
  })

  // --- tour.05: the line the father reported. Must name "capital" and must
  // not teach "come to work" or "every country has one city" (both false). ---
  it('tour.05 names the capital by name and resolves Delhi vs New Delhi', () => {
    expect(beat('tour.05').text).toBe(
      "Every country has a capital city, where its leaders make the rules. " +
      "India's capital is New Delhi. It sits inside a bigger place called Delhi. " +
      'Hold on, we are flying there now. Look down. That big stone arch is called India Gate.',
    )
  })

  it("tour.05's cues still land on the words they name after the rewrite (38 -> 42 words)", () => {
    const b = beat('tour.05')
    const words = wordsOf(b.text)
    const zoomTo = cueByVerb(b, 'zoomTo')
    const revealSymbol = cueByVerb(b, 'revealSymbol')
    expect(zoomTo.word).toBe(24)
    expect(words[zoomTo.word]).toBe('Delhi.')
    expect(revealSymbol.word).toBe(40)
    expect(words[revealSymbol.word]).toBe('India')
  })

  // --- tour.04: measurably false ("smaller pieces") against src/data/geo.json,
  // where Ladakh is the 7th-largest of 36 shapes. ---
  it('tour.04 no longer calls union territories the smaller pieces', () => {
    const text = beat('tour.04').text
    expect(text).toContain('Those are pieces of a different kind')
    expect(text).not.toMatch(/smaller pieces/)
  })

  it("tour.04's cues sit before the edited phrase and do not move", () => {
    const b = beat('tour.04')
    expect(cueByVerb(b, 'highlightUnionTerritories').word).toBe(4)
    expect(cueByVerb(b, 'countTo').word).toBe(5)
  })

  // --- The nine imprecise lines. ---
  it('tour.03 no longer promises one greeting per state', () => {
    const text = beat('tour.03').text
    expect(text).toContain('many of them have their own food, their own festivals')
    expect(text).not.toMatch(/each one has its own/)
  })

  it('tour.10 keeps the Ganga in the north of India, not "across the country"', () => {
    const text = beat('tour.10').text
    expect(text).toContain('across the north of India')
    expect(text).not.toMatch(/across the country/)
  })

  it('tour.14 invites a tap on any place, not just states — 8 of the 36 are union territories', () => {
    expect(beat('tour.14').text).toContain('Tap any place on the map')
  })

  it("tour.14's cue word does not move (same word count)", () => {
    const b = beat('tour.14')
    const words = wordsOf(b.text)
    expect(cueByVerb(b, 'highlightAllStates').word).toBe(10)
    expect(words[10]).toBe('map,')
  })

  it('delhi.intro names both of Delhi\'s neighbours, not just Haryana', () => {
    const text = delhi.intro.text
    expect(text).toContain('Haryana wraps around three sides of it, and Uttar Pradesh is on the other side.')
    expect(text).not.toMatch(/Haryana wraps around it\./)
  })

  it("delhi.intro's lightNeighbour cue still lands on \"Haryana\" at word 41", () => {
    const words = wordsOf(delhi.intro.text)
    const cue = cueByVerb(delhi.intro, 'lightNeighbour')
    expect(cue.word).toBe(41)
    expect(words[41]).toBe('Haryana')
  })

  it('rajasthan.intro says "lots" of sand, not the unsupported "most"', () => {
    expect(rajasthan.intro.text).toContain('Lots of this one is sand.')
  })

  it("rajasthan.intro's lightNeighbour cues do not move (same word count)", () => {
    const words = wordsOf(rajasthan.intro.text)
    const gujarat = cueByArg(rajasthan.intro, 'gujarat')
    const punjab = cueByArg(rajasthan.intro, 'punjab')
    expect(gujarat.word).toBe(40)
    expect(words[40]).toBe('Gujarat')
    expect(punjab.word).toBe(45)
    expect(words[45]).toBe('Punjab')
  })

  it('rajasthan.card.hello names the language and calls it an honorific, not "pleased to see somebody"', () => {
    const text = rajasthan.card.hello.text
    expect(text).toContain(
      'It is Rajasthani, and it is a very polite hello, the kind you use for grown-ups and for guests.',
    )
    expect(text).not.toMatch(/really pleased to see somebody/)
  })

  it('delhi.card.festival names Republic Day', () => {
    expect(delhi.card.festival.text).toContain('Once a year, on Republic Day, Delhi holds an enormous parade.')
  })

  it('rajasthan.chand-baori.line puts the stepwell in a dry place, not the desert it is not in', () => {
    const text = landmark(rajasthan, 'rajasthan.chand-baori').line.text
    expect(text).toContain('In a dry place, water is the most precious thing there is.')
    expect(text).not.toMatch(/In a desert, water/)
  })

  it("delhi.humayuns-tomb.line names the red stone building the dome sits on", () => {
    const text = landmark(delhi, 'delhi.humayuns-tomb').line.text
    expect(text).toContain('sits on top of a red stone building, in the middle of a garden')
  })

  it("kerala.card.animal doesn't imply elephants are found only in Kerala", () => {
    const text = kerala.card.animal.text
    expect(text).toContain("The elephant is Kerala's own animal.")
    expect(text).not.toMatch(/belongs to Kerala/)
  })

  it('kerala.card.hello attributes the palindrome to the English spelling, not just "written in English"', () => {
    const text = kerala.card.hello.text
    expect(text).toContain('written in English letters, Malayalam reads the same backwards as forwards')
    expect(text).not.toMatch(/written in English,/)
  })
})
