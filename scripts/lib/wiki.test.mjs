import { describe, it, expect } from 'vitest'
import {
  licencePolicy, vet, vetAnimal, isZooPhoto, attribution, realWidth, stripQuery, UA,
  coordsInIndia, indiaLocalityRegex, textNamesIndia, localityVerdict, isNotLivingAnimal,
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
  // DISNEY'S ANIMAL KINGDOM — a real candidate for Manipur's sangai, and a
  // reminder that "zoo" is a word many zoos do not use. `animal park` was
  // already here; `animal kingdom` was not, and nor were the European and
  // breeding-centre namings a rare Himalayan species is most often
  // photographed in.
  it('catches captive settings that avoid the word "zoo" — Animal Kingdom, Tierpark, a breeding centre', () => {
    expect(isZooPhoto({ fileTitle: 'File:Cervus eldii4.jpg', categories: ["Rucervus eldii in Disney's Animal Kingdom"] })).toBe(true)
    expect(isZooPhoto({ fileTitle: 'File:Capra falconeri Tierpark Berlin.jpg', categories: [] })).toBe(true)
    expect(isZooPhoto({ fileTitle: 'File:Tragopan at the Sarahan breeding centre.jpg', categories: [] })).toBe(true)
    expect(isZooPhoto({ fileTitle: 'File:Bird in an aviary.jpg', categories: [] })).toBe(true)
  })

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

    // THE NEPAL CASE — a real file this project actually shipped, not a
    // hypothetical. `INDIA_BBOX` is one flat rectangle (6-36N, 68-98E) and
    // therefore swallows every land neighbour India has; only Sri Lanka was
    // ever carved out, and that carve-out's own comment says in as many
    // words that "Bangladesh, Nepal, Bhutan, Pakistan, Myanmar" are NOT
    // similarly guarded. This is Nepal arriving.
    //
    // The blackbuck chosen for BOTH Andhra Pradesh and Punjab was
    // `File:A male blackbuck photographed at Blackbuck Conservation Area,
    // Bardiya, Nepal.jpg`, geotagged 28.248N 81.325E — genuinely inside the
    // India rectangle — and its ONLY Commons category is `Category:Antilope
    // cervicapra in Nepal`. Commons stated the country outright and the
    // verdict threw that away, because coordinates were checked first and
    // treated as definitive. A crude rectangle must not outrank an explicit
    // statement.
    it('refutes a photo whose categories name another country, even when the coordinate lands inside the India box', () => {
      const ii = {
        fileTitle: 'File:A male blackbuck photographed at Blackbuck Conservation Area, Bardiya, Nepal.jpg',
        categories: ['Antilope cervicapra in Nepal'],
        coordinates: { lat: 28.248202, lon: 81.325187 },
      }
      expect(coordsInIndia(ii.coordinates)).toBe(true) // the rectangle really does say yes
      expect(localityVerdict(ii, indiaRe)).toBe(false) // and it must not be the last word
    })

    // The same rectangle covers Thailand's latitude/longitude only partly,
    // but Phayre's langur is the species this project was warned about by
    // name ("expect Tripura's Phayre's langur to have no usable
    // photograph: the only Commons image is from Thailand"), so the text
    // signal has to work with no coordinate at all.
    it('refutes a Thailand-categorised photo with no coordinate — the Phayre\'s langur warning', () => {
      const ii = { fileTitle: 'File:Trachypithecus phayrei.jpg', categories: ['Trachypithecus phayrei in Thailand'] }
      expect(localityVerdict(ii, indiaRe)).toBe(false)
    })

    // Naming another country must not refute when India is named TOO — a
    // range map category ("Mammals of India and Nepal") describes a species
    // found in both, and says nothing about where the shutter was.
    it('does not refute when India is named alongside the other country', () => {
      const ii = { fileTitle: 'File:X.jpg', categories: ['Mammals of India and Nepal'], coordinates: { lat: 26.9, lon: 84.1 } }
      expect(localityVerdict(ii, indiaRe)).toBe(true)
    })

    // Whole-word matching, or this app's own Kerala landmark breaks: the
    // Chinese fishing nets at Fort Kochi are in India, and "Chinese" must
    // never match a bare "China" country token.
    it('does not mistake "Chinese fishing nets" for a photograph taken in China', () => {
      const ii = { fileTitle: 'File:Chinese fishing nets, Kochi.jpg', categories: ['Chinese fishing nets in Kerala'] }
      expect(localityVerdict(ii, indiaRe)).toBe(true)
    })
  })
})

describe('isNotLivingAnimal / vetAnimal', () => {
  const base = {
    imagerepository: 'shared', width: 3000, height: 2000, mime: 'image/jpeg',
    extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, License: { value: 'cc-by-sa-4.0' } },
  }

  // THE WESTERN TRAGOPAN CASE — this one actually shipped. Himachal
  // Pradesh's animal card was given `File:A Page of Birds. St. Petersburg
  // Muraqqa (Institute of Oriental Manuscripts of the Russian Academy of
  // Sciences E-14 f.80r).jpg`: a seventeenth-century Mughal PAINTING. It
  // passed every gate, because `vetAnimal` checked whether the animal was
  // captive and never whether it was alive, or real, or a photograph.
  // "The images are fake and not original" was this project's first
  // device-test complaint; a painting is the most literal form of it.
  it('rejects a painting of the animal — the Mughal muraqqa that actually shipped', () => {
    const ii = { ...base, fileTitle: 'File:A Page of Birds. St. Petersburg Muraqqa (Institute of Oriental Manuscripts of the Russian Academy of Sciences E-14 f.80r).jpg', categories: [] }
    expect(isNotLivingAnimal(ii)).toBe(true)
    expect(vetAnimal(ii).ok).toBe(false)
  })

  // A stuffed bird in a glass case in London is not the bird that lives in
  // the Himalaya, and it is a worse picture for a six-year-old than none.
  it('rejects a taxidermied museum specimen', () => {
    const ii = { ...base, fileTitle: 'File:Ma - Tragopan melanocephalus - 1.jpg', categories: ['Taxidermied birds in the Natural History Museum, London', 'Tragopan melanocephalus (museum specimens)'] }
    expect(isNotLivingAnimal(ii)).toBe(true)
    expect(vetAnimal(ii).ok).toBe(false)
  })

  // Manipur's sangai card shipped `File:Sangai Deer Replica in Manipur.jpg`
  // — a model of the deer, photographed in Manipur, so every locality and
  // captivity check said yes.
  it('rejects a replica, statue or sculpture standing in for the animal', () => {
    for (const t of ['File:Sangai Deer Replica in Manipur.jpg', 'File:Statue of a tiger.jpg', 'File:Elephant sculpture.jpg']) {
      expect(isNotLivingAnimal({ ...base, fileTitle: t, categories: [] })).toBe(true)
    }
  })

  it('accepts an ordinary photograph of a live animal', () => {
    const ii = { ...base, fileTitle: 'File:Blackbuck in Tal Chhapar Sanctuary November 2025 by Tisha Mukherjee 11.jpg', categories: ['Antilope cervicapra in Rajasthan'] }
    expect(isNotLivingAnimal(ii)).toBe(false)
    expect(vetAnimal(ii).ok).toBe(true)
  })

  // The check is animal-only on purpose. Jharkhand's Sohrai houses ARE wall
  // paintings — the landmark IS the painting — and `vet()` must not learn
  // this rule, or the app loses a real landmark to a rule written for
  // animal cards.
  it('does not apply to landmarks: Sohrai wall paintings survive plain vet()', () => {
    const ii = { ...base, fileTitle: 'File:A Munda tribesman sitting in front of wall decorated with Munda style Sohrai Painting at Isko Village, Hazaribagh.jpg', categories: [] }
    expect(vet(ii).ok).toBe(true)
  })

  // A TAXIDERMIED SPECIMEN IS WRONG FOR EVERYTHING, so unlike the artwork
  // half above this one lives in `vet()` and applies to landmarks too.
  // Manipur's Keibul Lamjao National Park — a landmark, not an animal card,
  // so `vetAnimal` never ran on it — was given `File:CervusEldiAMNH.jpg`,
  // categorised `Taxidermied Rucervus eldii`: a stuffed sangai in the
  // American Museum of Natural History, standing in for a national park.
  it('rejects a taxidermied specimen even for a LANDMARK, via plain vet()', () => {
    const ii = { ...base, fileTitle: 'File:CervusEldiAMNH.jpg', categories: ['Taxidermied Rucervus eldii'] }
    expect(vet(ii).ok).toBe(false)
  })

  // ...but "fossil" must NOT be in that shared half. Puducherry's landmark
  // "The Stone Tree" is a fossilised tree, photographed as
  // `File:Fossil photo2.JPG`. A fossil is the correct picture there and the
  // wrong picture on an animal card, so the word belongs in the
  // animal-only rule and nowhere else.
  it('keeps "fossil" out of vet(), because a fossil tree is a real landmark here', () => {
    const ii = { ...base, fileTitle: 'File:Fossil photo2.JPG', categories: [] }
    expect(vet(ii).ok).toBe(true)
    expect(isNotLivingAnimal(ii)).toBe(true)
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
