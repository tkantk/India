// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { build } from 'vite'
import { INDEX_ID, SHARED_ID, moduleSource, splitPlaceData } from './vite-place-data.mjs'

/**
 * TWO HALVES: the split itself, on a tiny made-up country where every
 * answer can be seen at a glance — and the BUILT APP, which is the only
 * place the claim this plugin exists to make ("a place's content is not in
 * the main script") can actually be true or false.
 */

const fixture = () => ({
  places: {
    testland: {
      name: 'Testland',
      card: { animal: { species: 'blue-whale' } },
      landmarks: [{ id: 'testland.tower' }, { id: 'testland.lake' }],
    },
    otherland: {
      name: 'Atlantis',
      card: { animal: { species: 'blue-whale' } },
      landmarks: [{ id: 'otherland.gate' }],
    },
  },
  timings: {
    'testland.intro': { audio: 'a' },
    'testland.tower.line': { audio: 'b' },
    'otherland.intro': { audio: 'c' },
    'tour.01': { audio: 'd' },
    'ui.tap-state': { audio: 'e' },
    // Some third prefix nobody has invented yet — and no dot at all.
    'quiz.01': { audio: 'f' },
    oddball: { audio: 'g' },
  },
  photos: {
    'testland.tower': { file: 'photos/testland.tower.jpg' },
    'otherland.gate': { file: 'photos/otherland.gate.jpg' },
    'blue-whale': { file: 'photos/blue-whale.jpg' },
    // `testland.lake` was never fetched: no entry, and none invented.
  },
})

describe('splitPlaceData', () => {
  it("gives each place its own clips — every '<slug>.' key — and no one else's", () => {
    const { bySlug } = splitPlaceData(fixture())
    expect(Object.keys(bySlug.testland.clips)).toEqual(['testland.intro', 'testland.tower.line'])
    expect(Object.keys(bySlug.otherland.clips)).toEqual(['otherland.intro'])
  })

  it('keeps every clip no place owns, whatever its prefix, rather than dropping it', () => {
    const { shared } = splitPlaceData(fixture())
    expect(Object.keys(shared).sort()).toEqual(['oddball', 'quiz.01', 'tour.01', 'ui.tap-state'])
  })

  it("gives each place the photographs its own page shows: its landmarks', and its animal by species", () => {
    const { bySlug } = splitPlaceData(fixture())
    expect(Object.keys(bySlug.testland.photos).sort()).toEqual(['blue-whale', 'testland.tower'])
    // A species two places share travels with both.
    expect(Object.keys(bySlug.otherland.photos).sort()).toEqual(['blue-whale', 'otherland.gate'])
  })

  it('indexes slug and name only, alphabetical by name', () => {
    expect(splitPlaceData(fixture()).index).toEqual([
      { id: 'otherland', name: 'Atlantis' },
      { id: 'testland', name: 'Testland' },
    ])
  })

  it('writes one STATIC import per place into the index — the thing the bundler cuts a chunk at', () => {
    const code = moduleSource(INDEX_ID, splitPlaceData(fixture()))
    expect(code).toContain('import("virtual:place-data/otherland")')
    expect(code).toContain('import("virtual:place-data/testland")')
    expect(code).toContain('new Map(')
    // A place it does not know is not a module at all.
    expect(moduleSource('virtual:place-data/nowhere', splitPlaceData(fixture()))).toBeNull()
    expect(moduleSource(SHARED_ID, splitPlaceData(fixture()))).toMatch(/^export default JSON\.parse\(/)
  })
})

/**
 * THE BUILT APP. A real `vite build` of the real config, held in memory
 * (`write: false`) so it neither needs nor touches `dist/` — a test that read
 * whatever `dist/` happened to hold would pass or fail on the age of the
 * last build rather than on the code in front of it.
 */
describe('the production build', () => {
  /** @type {import('rolldown').OutputChunk[]} */
  let chunks
  let entry
  const kerala = JSON.parse(readFileSync('content/places/kerala.json', 'utf8'))
  const slugs = readdirSync('content/places').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  // A sentence only Kerala's page says. Read from the content, not retyped,
  // so this cannot drift into checking for a sentence that no longer exists.
  const KERALA_SENTENCE = kerala.landmarks[0].line.text.split('. ')[1]

  beforeAll(async () => {
    // Vitest runs with NODE_ENV=test, and Vite keeps whatever NODE_ENV it is
    // handed — so a bare `build()` from in here bundles React's DEVELOPMENT
    // build and measures a script nobody ships (1.13 MB against the real
    // 0.90). The real `npm run build` runs as production; so must this, and
    // only for as long as the build takes.
    const was = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    let out
    try {
      out = await build({ mode: 'production', logLevel: 'silent', build: { write: false } })
    } finally {
      process.env.NODE_ENV = was
    }
    chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((c) => c.type === 'chunk')
    entry = chunks.find((c) => c.isEntry)
  }, 120_000)

  it('keeps every place\'s page, clips and photo credits OUT of the main script', () => {
    expect(KERALA_SENTENCE.length).toBeGreaterThan(40)
    expect(entry.code).not.toContain(KERALA_SENTENCE)
    for (const slug of slugs) {
      // A place's own clip, by its audio path…
      expect(entry.code, slug).not.toContain(`audio/en/${slug}.intro.m4a`)
    }
    // …and a landmark's photo credit, which is only ever needed on its page
    // or on the credits page (its own chunk too).
    expect(entry.code).not.toContain('photos/kerala.backwaters.jpg')
  })

  it('cuts one chunk per place, each holding that place and only that place', () => {
    const keralaChunk = chunks.find((c) => !c.isEntry && c.code.includes(KERALA_SENTENCE))
    expect(keralaChunk).toBeDefined()
    expect(keralaChunk.code).toContain('audio/en/kerala.intro.m4a')
    expect(keralaChunk.code).toContain('photos/kerala.backwaters.jpg')
    expect(keralaChunk.code).not.toContain('audio/en/rajasthan.intro.m4a')

    for (const slug of slugs) {
      const own = chunks.filter((c) => !c.isEntry && c.code.includes(`audio/en/${slug}.intro.m4a`))
      expect(own, slug).toHaveLength(1)
    }
  })

  it('keeps the tour and the interface lines in the main script, where the first screen needs them', () => {
    expect(entry.code).toContain('audio/en/tour.01.m4a')
    expect(entry.code).toContain('audio/en/ui.tap-state.m4a')
  })

  it('leaves the credits page — every photograph\'s full record — to its own chunk', () => {
    expect(entry.code).not.toContain('Credits and licences')
    expect(chunks.some((c) => !c.isEntry && c.code.includes('Credits and licences'))).toBe(true)
  })

  it('is well under the 1.5 MB the main script used to be', () => {
    // 1,529,796 bytes before the split; 897,000-odd after it. The ceiling is
    // set with room for the app to grow, and low enough that putting the
    // places (≈680 KB) back in would fail it loudly.
    expect(Buffer.byteLength(entry.code)).toBeLessThan(1_000_000)
  })
})
