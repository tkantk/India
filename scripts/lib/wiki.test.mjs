import { describe, it, expect } from 'vitest'
import {
  licencePolicy, vet, vetAnimal, isZooPhoto, attribution, realWidth, stripQuery, UA,
  coordsInIndia, indiaLocalityRegex, textNamesIndia, localityVerdict,
} from './wiki.mjs'

const freeFile = {
  imagerepository: 'shared',
  fileTitle: 'File:Konarka Temple.jpg',
  mime: 'image/jpeg', width: 2048, height: 1365,
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Konarka_Temple.jpg/960px-Konarka_Temple.jpg?utm_source=x',
  extmetadata: {
    License: { value: 'cc-by-sa-4.0' },
    LicenseShortName: { value: 'CC BY-SA 4.0' },
    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
    Artist: { value: '<a href="/wiki/User:Subham9423">Subham9423</a>' },
    AttributionRequired: { value: 'true' },
  },
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Konarka_Temple.jpg',
}

// Wikimedia's User-Agent policy (meta.wikimedia.org/wiki/User-Agent_policy)
// requires the shape `<client>/<version> (<contact>) <library>/<version>` and
// accepts either a contact URL or an email in the parens. We don't pin the
// exact string here — that would just be a change-detector for whichever
// contact we're using this week — we assert the shape the policy demands.
describe('UA', () => {
  it('is non-empty', () => {
    expect(UA.length).toBeGreaterThan(0)
  })

  it('names the client and a library, per the client/version (contact) library shape', () => {
    expect(UA).toMatch(/^\S+\/\S+ \(.+\) \S+$/)
  })

  it('carries a reachable contact (a URL) inside the parens, as the policy requires', () => {
    const contact = UA.match(/\(([^)]+)\)/)?.[1] ?? ''
    expect(contact.length).toBeGreaterThan(0)
    expect(contact).toMatch(/^https?:\/\//)
  })
})

describe('realWidth', () => {
  it('reads the width actually delivered, not the width requested', () => {
    expect(realWidth(freeFile.thumburl)).toBe(960)
  })
})

describe('stripQuery', () => {
  it('removes the tracking parameters Wikimedia now appends', () => {
    expect(stripQuery(freeFile.thumburl)).not.toContain('utm_source')
    expect(stripQuery(freeFile.thumburl)).toMatch(/960px-Konarka_Temple\.jpg$/)
  })
})

// One licence rule, one implementation. fetch-photos and fetch-sounds used to
// carry separate ones — wiki.mjs matched the machine-readable License code and
// checked NonFree, Restrictions and imagerepository; fetch-sounds re-derived
// the same policy from the human-readable LicenseShortName with none of those
// checks — so the two could and did disagree about the same file.
describe('licencePolicy', () => {
  const onCommons = { hostedOnCommons: true }

  it('accepts a CC BY-SA file hosted on Commons', () => {
    expect(licencePolicy(freeFile, onCommons).ok).toBe(true)
  })

  it('rejects a file the caller says is not on Commons, where fair use lives', () => {
    expect(licencePolicy(freeFile, { hostedOnCommons: false }).ok).toBe(false)
  })

  it('rejects an explicitly non-free file', () => {
    const nonFree = { ...freeFile, extmetadata: { ...freeFile.extmetadata, NonFree: { value: 'true' } } }
    expect(licencePolicy(nonFree, onCommons).ok).toBe(false)
  })

  it('rejects a fair-use LicenseShortName even before the code allowlist', () => {
    const fu = { ...freeFile, extmetadata: { LicenseShortName: { value: 'Fair use' } } }
    expect(licencePolicy(fu, onCommons).ok).toBe(false)
  })

  it('rejects GFDL, which has no machine licence code and cannot be shipped', () => {
    const gfdl = { ...freeFile, extmetadata: { LicenseShortName: { value: 'GFDL 1.2' } } }
    expect(licencePolicy(gfdl, onCommons).ok).toBe(false)
  })

  it('accepts public domain and CC0', () => {
    for (const code of ['pd', 'cc0']) {
      const f = { ...freeFile, extmetadata: { License: { value: code } } }
      expect(licencePolicy(f, onCommons).ok, code).toBe(true)
    }
  })

  it('rejects a file carrying personality or trademark restrictions', () => {
    const r = { ...freeFile, extmetadata: { ...freeFile.extmetadata, Restrictions: { value: 'personality' } } }
    expect(licencePolicy(r, onCommons).ok).toBe(false)
  })

  it('tolerates the empty Restrictions string Commons actually returns', () => {
    const r = { ...freeFile, extmetadata: { ...freeFile.extmetadata, Restrictions: { value: '' } } }
    expect(licencePolicy(r, onCommons).ok).toBe(true)
  })

  // The whole point of extracting it: a bird call has no mime image type, no
  // pixel width and no aspect ratio, and must still be judged by the same
  // licence rule as a photograph.
  it('judges an audio file, which has none of a photograph\'s properties', () => {
    const sound = {
      mime: 'application/ogg',
      fileTitle: 'File:House Sparrows chirping.ogg',
      extmetadata: {
        License: { value: 'cc-by-sa-3.0' },
        LicenseShortName: { value: 'CC BY-SA 3.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' },
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:QWerk">QWerk</a>' },
        AttributionRequired: { value: 'true' },
        Restrictions: { value: '' },
      },
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:House_Sparrows_chirping.ogg',
    }
    expect(licencePolicy(sound, onCommons).ok).toBe(true)
    // ...and the photo layer on top of it still rejects the same file.
    expect(vet({ ...sound, imagerepository: 'shared' }).ok).toBe(false)
  })

  it('rejects an unfree sound by exactly the same rule', () => {
    const sound = { extmetadata: { LicenseShortName: { value: 'GFDL' } } }
    expect(licencePolicy(sound, onCommons).ok).toBe(false)
  })
})

describe('vet', () => {
  it('accepts a CC BY-SA file hosted on Commons', () => {
    expect(vet(freeFile).ok).toBe(true)
  })

  it('rejects a file uploaded locally to en.wikipedia, where fair-use lives', () => {
    expect(vet({ ...freeFile, imagerepository: 'local' }).ok).toBe(false)
  })

  it('rejects an explicitly non-free file', () => {
    const nonFree = { ...freeFile, extmetadata: { ...freeFile.extmetadata, NonFree: { value: 'true' } } }
    expect(vet(nonFree).ok).toBe(false)
  })

  it('rejects GFDL, which has no machine licence code and cannot be shipped', () => {
    const gfdl = { ...freeFile, extmetadata: { LicenseShortName: { value: 'GFDL 1.2' } } }
    expect(vet(gfdl).ok).toBe(false)
  })

  it('accepts public domain, which carries no LicenseUrl', () => {
    const pd = {
      ...freeFile,
      extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' },
                     AttributionRequired: { value: 'false' } },
    }
    expect(vet(pd).ok).toBe(true)
  })

  it('rejects a title that looks like a montage rather than a photograph', () => {
    expect(vet({ ...freeFile, fileTitle: 'File:A collage of Mamallapuram town.jpg' }).ok).toBe(false)
  })

  it('rejects an ISS satellite frame, the Pangong Tso failure mode', () => {
    expect(vet({ ...freeFile, fileTitle: 'File:ISS054-E-7809 - View of Earth (cropped).jpg' }).ok).toBe(false)
  })

  it('rejects a TIFF, which browsers cannot display', () => {
    expect(vet({ ...freeFile, mime: 'image/tiff' }).ok).toBe(false)
  })

  it('rejects an image too small to fill a landmark panel', () => {
    expect(vet({ ...freeFile, width: 400 }).ok).toBe(false)
  })

  it('rejects an extreme panorama that cannot be cropped sensibly', () => {
    expect(vet({ ...freeFile, width: 4365, height: 800 }).ok).toBe(false)
  })

  it('rejects a file carrying personality or trademark restrictions', () => {
    const r = { ...freeFile, extmetadata: { ...freeFile.extmetadata, Restrictions: { value: 'personality' } } }
    expect(vet(r).ok).toBe(false)
  })
})

/**
 * Task 5's own instruction: "a tiger behind concrete answers 'the tiger
 * looks fake' worse than the drawing already does." There is no
 * machine-readable "this animal is captive" field anywhere in Wikimedia's
 * metadata, so this is a heuristic over the two text fields that actually
 * carry the signal when it exists at all: the file title and its Commons
 * categories. It is honestly incomplete — see the last test in this block
 * for the failure mode it cannot catch — but it catches the obvious,
 * common case (a title or category that says "zoo") for free.
 */
describe('isZooPhoto / vetAnimal', () => {
  const wild = { ...freeFile, fileTitle: 'File:Dromedary in the Thar desert.jpg', categories: ['Camelus dromedarius', 'Thar Desert'] }

  it('accepts a photograph with no zoo signal in its title or categories', () => {
    expect(isZooPhoto(wild)).toBe(false)
    expect(vetAnimal(wild).ok).toBe(true)
  })

  it('rejects a title that says the animal is at a zoo', () => {
    const zoo = { ...wild, fileTitle: 'File:Bengal tiger at Delhi Zoo.jpg' }
    expect(isZooPhoto(zoo)).toBe(true)
    expect(vetAnimal(zoo).ok).toBe(false)
  })

  it('rejects a file with no zoo word in its title but a zoo/captivity category', () => {
    const captive = { ...wild, fileTitle: 'File:Elephas maximus portrait.jpg', categories: ['Elephas maximus', 'Animals in captivity'] }
    expect(isZooPhoto(captive)).toBe(true)
    expect(vetAnimal(captive).ok).toBe(false)
  })

  it('catches "zoological garden" and "safari park", not only the bare word "zoo"', () => {
    expect(isZooPhoto({ ...wild, fileTitle: 'File:Lion at the zoological garden.jpg' })).toBe(true)
    expect(isZooPhoto({ ...wild, categories: ['Nairobi Safari Park'] })).toBe(true)
  })

  it('does NOT reject a wild protected area named "Sanctuary" or "National Park"', () => {
    // India's real wild habitats are routinely named this way — Ranthambore
    // NATIONAL PARK, Periyar WILDLIFE SANCTUARY — and rejecting on those
    // words would throw out exactly the photographs this project wants.
    const wildlife = { ...wild, fileTitle: 'File:Tiger in Ranthambore National Park.jpg', categories: ['Periyar Wildlife Sanctuary'] }
    expect(isZooPhoto(wildlife)).toBe(false)
  })

  it('still runs the ordinary licence/quality checks vet() already does', () => {
    const badLicence = { ...wild, extmetadata: { LicenseShortName: { value: 'GFDL' } } }
    expect(vetAnimal(badLicence).ok).toBe(false)
  })

  // THE HONEST LIMIT. A working temple elephant, or a captive animal in a
  // photo whose title and categories name only the species and the place —
  // never the word "zoo" or "captiv*" anywhere — passes this check. There is
  // no field in Wikimedia's metadata that says "this individual animal is
  // free-ranging"; a human looking at the contact sheet is still the only
  // check that can catch this, exactly as Task 5's own brief says.
  it('cannot catch a captive animal whose title and categories never say so', () => {
    const uncaught = { ...wild, fileTitle: 'File:Elephant, Kerala.jpg', categories: ['Elephas maximus', 'Elephants of Kerala'] }
    expect(isZooPhoto(uncaught)).toBe(false)
  })
})

/**
 * "Prefer a photograph taken in India" (Task 5a's own review comment, after
 * two of the first four animal photographs turned out to be taken in Egypt
 * and Brooklyn). Every fixture below is REAL data, read directly off
 * Commons for this task's own four files — not invented — because a
 * plausible-looking synthetic fixture is exactly how a geography check
 * would end up untested against the actual shape Commons' data comes in.
 *
 * Two signals, tried in order, because neither alone is enough:
 *   1. `coordinates` — Commons' own geotag, when a file carries one. This is
 *      GROUND TRUTH, not a guess, and definitively confirms OR REFUTES.
 *   2. Title/category TEXT naming "India", "Indian", or a state/UT — the
 *      fallback for the (common) case of no geotag at all.
 * A verdict is TRI-STATE (`true`/`false`/`null`), not boolean, because
 * "not established" is a real, different answer from "confirmed elsewhere"
 * — see the Bandipur elephant test below, which is the whole reason this is
 * tri-state rather than a single boolean defaulting to false.
 */
describe('India locality', () => {
  const indiaRe = indiaLocalityRegex(['Karnataka', 'Kerala', 'Gujarat', 'Rajasthan', 'Jammu & Kashmir'])

  describe('coordsInIndia', () => {
    it('confirms real coordinates inside India (Vadodara, Gujarat)', () => {
      expect(coordsInIndia({ lat: 22.3, lon: 73.2 })).toBe(true)
    })

    it('refutes real coordinates in the Sinai, Egypt — this task\'s own Nuweiba dromedary', () => {
      expect(coordsInIndia({ lat: 29.14841667, lon: 34.67383333 })).toBe(false)
    })

    it('refutes real coordinates in Brooklyn, New York — this task\'s own Prospect Park sparrow', () => {
      expect(coordsInIndia({ lat: 40.66209403, lon: -73.96917841 })).toBe(false)
    })

    // THE BUG THIS TEST WAS ADDED TO CATCH. A first version of this function
    // used one flat box (minLat 6) to cover India's mainland AND the
    // Nicobars in one range — and a "File:Sri Lankan elephant... .jpg"
    // candidate, geotagged at 6.29°N 81.408°E (Yala, SRI LANKA — a REAL
    // Commons coordinate, not invented), fell inside that box and was
    // reported `true`. Sri Lanka's own latitude range (roughly 5.9-9.9°N)
    // genuinely overlaps India's at that longitude (Kanyakumari, India's own
    // southern tip, is 8.08°N) — a flat box cannot tell them apart, so Sri
    // Lanka needs its own carve-out, checked BEFORE the general box.
    it('refutes real coordinates in Sri Lanka, which overlaps India\'s own latitude range at Kanyakumari', () => {
      expect(coordsInIndia({ lat: 6.29, lon: 81.408 })).toBe(false) // Yala National Park, Sri Lanka
      expect(coordsInIndia({ lat: 9.66, lon: 80.02 })).toBe(false) // Jaffna, Sri Lanka
    })

    it('still confirms India\'s own real southern tip and the Nicobars, which sit at similar latitudes', () => {
      expect(coordsInIndia({ lat: 8.08, lon: 77.55 })).toBe(true) // Kanyakumari, India
      expect(coordsInIndia({ lat: 6.75, lon: 93.82 })).toBe(true) // Indira Point, Great Nicobar
    })

    it('returns null (not established), never false, when there is no coordinate at all', () => {
      expect(coordsInIndia(undefined)).toBeNull()
      expect(coordsInIndia(null)).toBeNull()
    })
  })

  describe('textNamesIndia', () => {
    it('matches a category that plainly says "in India" — this task\'s own Indian roller', () => {
      const ii = { fileTitle: 'File:Indian roller - Timbi Lake, Vadodara 2023-12-03.jpg', categories: ['Birds of Vadodara', 'Coracias benghalensis in India'] }
      expect(textNamesIndia(ii, indiaRe)).toBe(true)
    })

    it('matches a bare state name among the categories', () => {
      expect(textNamesIndia({ fileTitle: 'File:Tiger.jpg', categories: ['Wildlife of Rajasthan'] }, indiaRe)).toBe(true)
    })

    it('does not match a foreign place name that names no country or state at all', () => {
      const ii = { fileTitle: 'File:Camelus dromedarius in Nuweiba.jpg', categories: ['Camels in Nuweiba', 'Camelus dromedarius'] }
      expect(textNamesIndia(ii, indiaRe)).toBe(false)
    })
  })

  describe('localityVerdict', () => {
    it('trusts a real coordinate over absent text — confirms Vadodara even with no India-naming category', () => {
      const ii = { fileTitle: 'File:X.jpg', categories: [], coordinates: { lat: 22.3, lon: 73.2 } }
      expect(localityVerdict(ii, indiaRe)).toBe(true)
    })

    it('refutes on coordinates alone, even if a category happens to mention "India"', () => {
      // Should not happen in practice, but proves coordinates are checked
      // FIRST and win — they are ground truth, text is not.
      const ii = { fileTitle: 'File:X.jpg', categories: ['India-related'], coordinates: { lat: 29.15, lon: 34.67 } }
      expect(localityVerdict(ii, indiaRe)).toBe(false)
    })

    it('falls back to text when there is no coordinate — the Indian roller case', () => {
      const ii = { fileTitle: 'File:Indian roller - Timbi Lake, Vadodara 2023-12-03.jpg', categories: ['Birds of Vadodara', 'Coracias benghalensis in India'] }
      expect(localityVerdict(ii, indiaRe)).toBe(true)
    })

    // THE HONEST GAP. This task's own Asian elephant (Bandipur National
    // Park, Karnataka — genuinely India) carries NO coordinates and NO
    // category or title text naming India OR Karnataka — only the park's
    // own name, which this function does not and cannot know is Indian
    // without a gazetteer this project does not have. The correct, honest
    // answer is `null` (not established), never `false` (confirmed
    // elsewhere) — a human still has to close this specific gap, exactly as
    // `isZooPhoto`'s own "cannot catch" test states the same limit a
    // different way.
    it('reports null, not false, for a genuinely Indian photo its own text never confirms', () => {
      const ii = { fileTitle: 'File:Elephas maximus (Bandipur).jpg', categories: ['Elephas maximus (male)', 'Elephas maximus in the Bandipur National Park'] }
      expect(localityVerdict(ii, indiaRe)).toBeNull()
    })

    it('reports false for a real, confirmed non-Indian photo — Prospect Park', () => {
      const ii = { fileTitle: 'File:House sparrow male in Prospect Park (53532).jpg', categories: ['Prospect Park in 2022'], coordinates: { lat: 40.662, lon: -73.969 } }
      expect(localityVerdict(ii, indiaRe)).toBe(false)
    })
  })
})

describe('attribution', () => {
  it('builds a credit with the author, a linked licence and a link to the source', () => {
    const a = attribution(freeFile)
    expect(a.artist).toBe('Subham9423')
    expect(a.licence).toBe('cc-by-sa-4.0')
    expect(a.attributionRequired).toBe(true)
    expect(a.attributionHtml).toContain('CC BY-SA 4.0')
    expect(a.attributionHtml).toContain('creativecommons.org/licenses/by-sa/4.0')
    expect(a.attributionHtml).toContain('commons.wikimedia.org/wiki/File:Konarka_Temple.jpg')
  })

  it('makes protocol-relative author links absolute so they work offline', () => {
    const rel = { ...freeFile, extmetadata: { ...freeFile.extmetadata, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">X</a>' } } }
    expect(attribution(rel).attributionHtml).not.toContain('href="//')
  })

  it('tolerates a missing LicenseUrl, as public domain files have', () => {
    const pd = { ...freeFile, extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' } } }
    expect(() => attribution(pd)).not.toThrow()
    expect(attribution(pd).licenceUrl).toBeNull()
  })
})
