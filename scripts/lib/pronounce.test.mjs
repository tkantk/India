import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { respell } from './pronounce.mjs'
import { collectRuns, flattenRuns } from './runs.mjs'

const TABLE = { Konark: 'Konaark', Kozhikode: 'Kozhi-kode', Ziro: 'Zeero' }

describe('respell', () => {
  it('replaces a name wherever it appears', () => {
    expect(respell('This is Konark Sun Temple.', TABLE)).toBe('This is Konaark Sun Temple.')
  })

  // The table holds bare words; the text does not.
  it('matches through surrounding punctuation and puts it back', () => {
    expect(respell('We went to Konark, then home.', TABLE)).toBe('We went to Konaark, then home.')
    expect(respell('This is Ziro.', TABLE)).toBe('This is Zeero.')
    expect(respell('("Konark")', TABLE)).toBe('("Konaark")')
  })

  it('leaves a line with no listed name byte-identical', () => {
    const text = 'The whole temple is carved to look like a giant chariot.'
    expect(respell(text, TABLE)).toBe(text)
  })

  it('is inert with no table at all', () => {
    expect(respell('Konark', null)).toBe('Konark')
  })

  // THE CONSTRAINT THE WHOLE DESIGN RESTS ON. The read-along joins the spoken
  // text to the displayed text by WORD INDEX, so a replacement that splits
  // one word into two would shift every later word's highlight for the rest
  // of that line — silently, and only audibly wrong on a device.
  it('refuses a replacement containing whitespace, by name', () => {
    expect(() => respell('This is Konark.', { Konark: 'Ko naark' }))
      .toThrow(/exactly one word/)
  })

  it('never changes the word count of a line it touches', () => {
    const text = 'This is Konark Sun Temple, near Kozhikode.'
    const spoken = respell(text, TABLE)
    expect(spoken.trim().split(/\s+/)).toHaveLength(text.trim().split(/\s+/).length)
  })

  it('does not match a name embedded inside a longer word', () => {
    expect(respell('Konarkish', TABLE)).toBe('Konarkish')
  })
})

describe('content/pronounce.json', () => {
  const table = JSON.parse(readFileSync('content/pronounce.json', 'utf8'))
  const entries = Object.entries(table).filter(([k]) => k !== '_comment')

  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(50)
  })

  // Every entry has to survive the same rule `respell` enforces at runtime —
  // checked here so a bad entry fails `npm test` rather than a paid render.
  it('maps every name to exactly one whitespace-free word', () => {
    const bad = entries.filter(([, v]) => typeof v !== 'string' || /\s/.test(v) || v === '')
    expect(bad).toEqual([])
  })

  it('has no entry that replaces a word with itself', () => {
    expect(entries.filter(([k, v]) => k === v)).toEqual([])
  })

  // A typo'd key matches nothing and is silently useless — it looks like a
  // pronunciation fix in the table while the voice goes on saying the name
  // the way it always did. This is the only thing that would ever notice.
  it('every name in the table actually occurs somewhere in the narration', () => {
    const corpus = flattenRuns(collectRuns())
      .map((l) => l.display ?? l.text)
      .join(' ')
      .toLowerCase()
    const orphans = entries.map(([k]) => k).filter((k) => !corpus.includes(k.toLowerCase()))
    expect(orphans).toEqual([])
  })

})
