import { describe, it, expect } from 'vitest'
import { licencePolicy, vet, attribution, realWidth, stripQuery, UA } from './wiki.mjs'

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
