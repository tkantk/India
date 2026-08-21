import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Guards the committed artefact, not the fetcher: the fetcher only runs when
// someone re-sources a sound, and by then a credit written without these
// fields has already shipped. Seven of the eleven sounds are CC BY-SA 3.0 or
// 4.0, which legally require a visible credit and a link to the licence — the
// app cannot render either if the data does not carry them.
const sounds = JSON.parse(readFileSync('src/data/sound-credits.json', 'utf8'))
const photos = JSON.parse(readFileSync('src/data/photo-credits.json', 'utf8'))

const ATTRIBUTION_FIELDS = [
  'artist', 'licence', 'licenceShort', 'licenceUrl',
  'attributionRequired', 'descriptionUrl', 'attributionHtml',
]

describe('sound-credits.json', () => {
  it('carries the same attribution shape as the photo pipeline', () => {
    for (const [id, c] of Object.entries(sounds)) {
      for (const f of ATTRIBUTION_FIELDS) {
        expect(Object.keys(c), `${id} has no ${f}`).toContain(f)
      }
    }
  })

  it('gives every share-alike or attribution licence a licence URL to link to', () => {
    for (const [id, c] of Object.entries(sounds)) {
      // Keyed off the human-readable short name, which the pre-fix credits
      // also had: keying off c.licence would silently skip every entry that
      // is missing the machine code, which is exactly the broken case.
      if (!/^CC BY/i.test(c.licenceShort)) continue
      expect(c.attributionRequired, `${id} is ${c.licence} but claims no attribution is required`).toBe(true)
      expect(c.licenceUrl, `${id} is ${c.licence} with no licence URL`).toMatch(/^https?:\/\//)
      expect(c.attributionHtml, `${id} does not name its author`).toContain(c.licenceShort)
    }
  })

  it('names an audio file that actually exists', () => {
    for (const [id, c] of Object.entries(sounds)) {
      expect(c.file.startsWith('/'), `${id} has an absolute path, which 404s on a project page`).toBe(false)
      expect(existsSync(join('public', c.file)), `${id}: public/${c.file} is missing`).toBe(true)
    }
  })

  it('agrees with photo-credits.json field for field', () => {
    const photoFields = new Set(Object.values(photos).flatMap(Object.keys))
    for (const f of ATTRIBUTION_FIELDS) {
      expect([...photoFields], `photo credits lost ${f}`).toContain(f)
    }
  })
})
