import { describe, it, expect } from 'vitest'
import {
  normaliseLicence, attributionFor, licenceOk,
  inatToCandidates, xcToCandidates, fsToCandidates, sameTaxon, fsInIndia,
} from './media-sources.mjs'

describe('normaliseLicence — three sources, one code format', () => {
  it('reads iNaturalist\'s bare codes as their 4.0 licences', () => {
    expect(normaliseLicence('cc-by-nc').code).toBe('cc-by-nc-4.0')
    expect(normaliseLicence('cc-by-nc-sa').code).toBe('cc-by-nc-sa-4.0')
    expect(normaliseLicence('cc-by').code).toBe('cc-by-4.0')
    expect(normaliseLicence('cc0').code).toBe('cc0')
  })

  it('reads xeno-canto\'s protocol-relative URLs', () => {
    const l = normaliseLicence('//creativecommons.org/licenses/by-nc-sa/4.0/')
    expect(l).toEqual({ code: 'cc-by-nc-sa-4.0', short: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' })
  })

  it('reads Freesound\'s URLs, including CC0 and the older 3.0 licences', () => {
    expect(normaliseLicence('http://creativecommons.org/licenses/by/4.0/').code).toBe('cc-by-4.0')
    expect(normaliseLicence('http://creativecommons.org/licenses/by/3.0/').code).toBe('cc-by-3.0')
    expect(normaliseLicence('http://creativecommons.org/publicdomain/zero/1.0/').code).toBe('cc0')
  })

  it('cannot read Freesound\'s Sampling+ licence, and so rejects it', () => {
    expect(normaliseLicence('http://creativecommons.org/licenses/sampling+/1.0/')).toBeNull()
    expect(licenceOk({ licence: 'http://creativecommons.org/licenses/sampling+/1.0/' }).ok).toBe(false)
  })

  it('fails closed on anything it cannot read', () => {
    expect(normaliseLicence(null)).toBeNull()
    expect(normaliseLicence('All rights reserved')).toBeNull()
    expect(licenceOk({ licence: undefined }).ok).toBe(false)
  })
})

describe('the licence rule, applied to the new sources', () => {
  // The owner's decision: non-commercial is allowed for this free, ad-free
  // site.
  it('accepts non-commercial licences', () => {
    expect(licenceOk({ licence: 'cc-by-nc' }).ok).toBe(true)
    expect(licenceOk({ licence: '//creativecommons.org/licenses/by-nc-sa/4.0/' }).ok).toBe(true)
  })

  // ...and the line that is not his to move: every sound is cut and often
  // looped, which is adapting it, and "no derivatives" forbids sharing an
  // adaptation at all. A real xeno-canto great egret was BY-NC-ND.
  it('never accepts a no-derivatives licence, in any source\'s format', () => {
    expect(licenceOk({ licence: '//creativecommons.org/licenses/by-nc-nd/4.0/' }).ok).toBe(false)
    expect(licenceOk({ licence: 'cc-by-nd' }).ok).toBe(false)
    expect(licenceOk({ licence: 'http://creativecommons.org/licenses/by-nd/4.0/' }).ok).toBe(false)
  })
})

describe('attributionFor', () => {
  const base = { source: 'inat', ref: 's1', artist: 'Asha', licence: 'cc-by-nc', pageUrl: 'https://www.inaturalist.org/observations/1' }

  it('marks a non-commercial file so every one can be found and removed in one pass', () => {
    expect(attributionFor(base).nonCommercial).toBe(true)
    expect(attributionFor({ ...base, licence: 'cc-by' }).nonCommercial).toBe(false)
  })

  it('writes the same credit shape the Commons pipelines write', () => {
    const a = attributionFor(base)
    for (const k of ['artist', 'licence', 'licenceShort', 'licenceUrl', 'attributionRequired', 'descriptionUrl', 'attributionHtml']) {
      expect(a).toHaveProperty(k)
    }
    expect(a.attributionRequired).toBe(true)
    expect(a.attributionHtml).toContain('via iNaturalist')
    expect(a.attributionHtml).toContain('rel="license noopener"')
  })

  // Credits.tsx renders this with dangerouslySetInnerHTML, and a recordist's
  // display name is free text typed by a stranger.
  it('escapes a recordist name before it becomes HTML', () => {
    const a = attributionFor({ ...base, artist: '<img src=x onerror=alert(1)>' })
    expect(a.attributionHtml).not.toContain('<img')
    expect(a.attributionHtml).toContain('&lt;img')
  })

  it('refuses to credit a licence it cannot read rather than guessing', () => {
    expect(() => attributionFor({ ...base, licence: 'whatever' })).toThrow(/unreadable licence/)
  })
})

describe('response mapping (real shapes, trimmed)', () => {
  it('iNaturalist: one candidate per licensed sound, all-rights-reserved skipped', () => {
    const c = inatToCandidates({
      results: [{
        id: 9, uri: 'https://www.inaturalist.org/observations/9', place_guess: 'Mysore Division, Karnataka, India',
        geojson: { coordinates: [76.6, 12.3] }, user: { login: 'asha', name: 'Asha R' },
        taxon: { name: 'Coracias benghalensis', preferred_common_name: 'Indian Roller' }, quality_grade: 'research',
        sounds: [
          { id: 1651126, license_code: 'cc-by-nc', file_url: 'https://static.inaturalist.org/sounds/1651126.wav' },
          { id: 2, license_code: null, file_url: 'https://static.inaturalist.org/sounds/2.wav' },
        ],
      }],
    }, 'sounds')
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ source: 'inat', ref: 's1651126', artist: 'Asha R', inIndia: true, lat: 12.3, lon: 76.6 })
  })

  it('xeno-canto: country, length and protocol-relative links', () => {
    const [c] = xcToCandidates({ recordings: [{
      id: '123', gen: 'Ardea', sp: 'alba', en: 'Great Egret', rec: 'R. Kumar', cnt: 'India', loc: 'Gaskopari Wetlands',
      lat: '21.1', lon: '79.0', type: 'call', file: '//xeno-canto.org/123/download', lic: '//creativecommons.org/licenses/by-nc-sa/4.0/',
      q: 'B', length: '1:05', url: '//xeno-canto.org/123',
    }] })
    expect(c).toMatchObject({ source: 'xc', ref: '123', seconds: 65, inIndia: true, download: 'https://xeno-canto.org/123/download' })
  })

  it('Freesound: India from the title or tags first, the geotag box second', () => {
    const [named, boxed, unknown] = fsToCandidates({ results: [
      { id: 1, name: 'temple-IIT-Mumbai.wav', license: 'http://creativecommons.org/licenses/by/4.0/', duration: 241.5, username: 'u', previews: { 'preview-hq-mp3': 'https://cdn/1.mp3' }, url: 'https://freesound.org/s/1/', tags: [] },
      { id: 2, name: 'bells.wav', license: 'http://creativecommons.org/licenses/by/4.0/', duration: 10, username: 'u', previews: {}, url: 'https://freesound.org/s/2/', geotag: '26.9 70.9', tags: [] },
      { id: 3, name: 'whoosh.wav', license: 'http://creativecommons.org/publicdomain/zero/1.0/', duration: 1.2, username: 'u', previews: {}, url: 'https://freesound.org/s/3/', tags: ['whoosh'] },
    ] })
    expect(named.inIndia).toBe(true)
    expect(boxed.inIndia).toBe(true)
    expect(unknown.inIndia).toBeNull() // not established, never "no"
  })
})

describe('the exact species, never the genus', () => {
  // The first real run of the candidate tool asked for tigers and got Indian
  // leopards and Gir lions: the taxon lookup had resolved to the GENUS
  // Panthera. The project's founding mistake — the wrong camel — in sound.
  it('keeps the species and its own subspecies', () => {
    expect(sameTaxon('Panthera tigris', 'Panthera tigris')).toBe(true)
    expect(sameTaxon('Panthera tigris tigris', 'Panthera tigris')).toBe(true)
  })

  it('rejects a sister species and the genus itself', () => {
    expect(sameTaxon('Panthera pardus fusca', 'Panthera tigris')).toBe(false)
    expect(sameTaxon('Panthera leo leo', 'Panthera tigris')).toBe(false)
    expect(sameTaxon('Panthera', 'Panthera tigris')).toBe(false)
    // and a prefix that only LOOKS like a match
    expect(sameTaxon('Panthera tigrisoides', 'Panthera tigris')).toBe(false)
  })

  it('drops the wrong animals from a real-shaped response', () => {
    const obs = (id, name) => ({ id, taxon: { name }, sounds: [{ id, license_code: 'cc-by-nc', file_url: `https://x/${id}.mp3` }] })
    const got = inatToCandidates({ results: [
      obs(1, 'Panthera tigris tigris'), obs(2, 'Panthera pardus fusca'), obs(3, 'Panthera leo leo'),
    ] }, 'sounds', 'Panthera tigris')
    expect(got.map((c) => c.ref)).toEqual(['s1'])
  })
})

describe('fsInIndia — found by the candidate tool\'s own first run', () => {
  it('does not call the Andaman SEA coast of Thailand India', () => {
    expect(fsInIndia('Mu Ko Lanta National Marine Park - Thailand andaman sea beach', 7.5, 99.0)).toBe(false)
  })

  it('needs whole words: "goal" is not Goa, "thank" is not the Thar', () => {
    expect(fsInIndia('Crashing Starship scifi goal impact', NaN, NaN)).toBeNull()
    expect(fsInIndia('thank you voice', NaN, NaN)).toBeNull()
  })

  it('still finds a real Indian recording by its words or its geotag', () => {
    expect(fsInIndia('Hampi, temple, India', NaN, NaN)).toBe(true)
    expect(fsInIndia('wind in the dunes', 26.9, 70.9)).toBe(true) // Jaisalmer
  })

  it('a geotag inside the box that names another country is not India', () => {
    expect(fsInIndia('Kathmandu street, Nepal', 27.7, 85.3)).toBe(false)
  })
})

describe('fsInIndia — a species name is not a place', () => {
  // Found by a chooser: this file was a zoo recording, flagged India by the
  // word "Indian" in the animal's name.
  it('does not take "Indian rhinoceros" to mean recorded in India', () => {
    expect(fsInIndia('Indian rhinoceros (Rhinoceros unicornis)', NaN, NaN)).toBeNull()
  })
  it('still takes "India" itself', () => {
    expect(fsInIndia('Indian rhinoceros, Kaziranga, Assam, India', NaN, NaN)).toBe(true)
  })
})

