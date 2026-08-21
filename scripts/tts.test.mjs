import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FIXTURE = 'content/places/testland.json'
const line = (id, kind, text, cues) => ({ id, kind, text, ...(cues ? { cues } : {}) })

// Runs the real pipeline (say -> afconvert -> timings), but writes to a
// scratch directory rather than the tracked public/audio/en and
// src/data/timings.json. tts.mjs's --audio-dir/--timings/--cache flags exist
// for exactly this: without them, running this suite would leave a
// "testland" clip and timings entry committed alongside real content.
const dir = mkdtempSync(join(tmpdir(), 'tts-test-'))
const AUDIO_DIR = join(dir, 'audio')
const TIMINGS = join(dir, 'timings.json')
const CACHE = join(dir, 'cache.json')

beforeAll(() => {
  mkdirSync('content/places', { recursive: true })
  writeFileSync(FIXTURE, JSON.stringify({
    id: 'testland', name: 'Testland', type: 'state', capital: 'Testpur', ambience: 'plains',
    intro: line('testland.intro', 'intro', 'Testland is a friendly place with one big tiger.',
                [{ word: 7, do: 'playSfx', arg: 'tiger-growl' }]),
    card: {
      animal: line('testland.card.animal', 'card', 'The tiger lives here.'),
      food: line('testland.card.food', 'card', 'People eat rice.'),
      festival: line('testland.card.festival', 'card', 'They dance in spring.'),
      hello: line('testland.card.hello', 'card', 'People say hello.'),
    },
    landmarks: Array.from({ length: 5 }, (_, i) => ({
      id: `testland.lm${i}`, name: `Spot ${i}`, photoQuery: `Spot ${i}`, scene: 'plains',
      line: line(`testland.lm${i}.line`, 'landmark', `Spot number ${i} is nice.`),
    })),
  }))
  execFileSync('node', [
    'scripts/tts.mjs',
    '--provider=say',
    '--only=testland',
    `--audio-dir=${AUDIO_DIR}`,
    `--timings=${TIMINGS}`,
    `--cache=${CACHE}`,
  ], { stdio: 'inherit' })
})

afterAll(() => {
  rmSync(FIXTURE, { force: true })
  rmSync(dir, { recursive: true, force: true })
})

describe('tts pipeline with the draft voice', () => {
  const timings = () => JSON.parse(readFileSync(TIMINGS, 'utf8'))

  it('produces an audio file for every line', () => {
    for (const id of Object.keys(timings()).filter(k => k.startsWith('testland'))) {
      expect(existsSync(join(AUDIO_DIR, `${id}.m4a`)), `missing audio for ${id}`).toBe(true)
    }
  })

  it('records one timing per word', () => {
    const t = timings()['testland.intro']
    expect(t.words).toEqual('Testland is a friendly place with one big tiger.'.split(' '))
    expect(t.starts).toHaveLength(t.words.length)
    expect(t.ends).toHaveLength(t.words.length)
  })

  it('keeps word timings inside the clip duration', () => {
    const t = timings()['testland.intro']
    expect(t.starts[0]).toBe(0)
    expect(t.ends[t.ends.length - 1]).toBeLessThanOrEqual(t.duration + 0.01)
  })

  it('resolves the word-index cue to a real time inside the clip', () => {
    const t = timings()['testland.intro']
    expect(t.cues).toHaveLength(1)
    expect(t.cues[0].arg).toBe('tiger-growl')
    expect(t.cues[0].t).toBe(t.starts[7])
    expect(t.cues[0].t).toBeGreaterThan(0)
    expect(t.cues[0].t).toBeLessThan(t.duration)
  })

  it('stores a relative audio path that assetUrl can use', () => {
    expect(timings()['testland.intro'].audio).toBe('audio/en/testland.intro.m4a')
    expect(timings()['testland.intro'].audio.startsWith('/')).toBe(false)
  })
})

// Regression coverage for the --only + --force interaction: `force` must
// clear the render cache without also clearing the merge base that --only
// relies on, or a partial re-render silently deletes every other place's
// entry from timings.json. Uses its own scratch dir and its own two-place
// fixture pair so it doesn't interfere with the single-fixture suite above.
describe('cache reuse, --only, and --force semantics', () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'tts-test2-'))
  const AUDIO2 = join(dir2, 'audio')
  const TIMINGS2 = join(dir2, 'timings.json')
  const CACHE2 = join(dir2, 'cache.json')

  const FIRST = 'aaastateone'
  const SECOND = 'zzzstatetwo'
  const fixturePath = (id) => `content/places/${id}.json`

  const place = (id, cap) => ({
    id, name: id, type: 'state', capital: cap, ambience: 'plains',
    intro: line(`${id}.intro`, 'intro', `${id} welcomes every visitor warmly today.`,
                [{ word: 1, do: 'playSfx', arg: 'chime' }]),
    card: {
      animal: line(`${id}.card.animal`, 'card', 'An animal lives here.'),
      food: line(`${id}.card.food`, 'card', 'People eat well.'),
      festival: line(`${id}.card.festival`, 'card', 'They celebrate often.'),
      hello: line(`${id}.card.hello`, 'card', 'People say hello.'),
    },
    landmarks: Array.from({ length: 5 }, (_, i) => ({
      id: `${id}.lm${i}`, name: `Spot ${i}`, photoQuery: `Spot ${i}`, scene: 'plains',
      line: line(`${id}.lm${i}.line`, 'landmark', `Spot number ${i} is nice.`),
    })),
  })

  const run = (...args) => execFileSync('node', [
    'scripts/tts.mjs', '--provider=say',
    `--audio-dir=${AUDIO2}`, `--timings=${TIMINGS2}`, `--cache=${CACHE2}`,
    ...args,
  ], { encoding: 'utf8' })

  const timings2 = () => JSON.parse(readFileSync(TIMINGS2, 'utf8'))
  const introMtime = (id) => statSync(join(AUDIO2, `${id}.intro.m4a`)).mtimeMs

  beforeAll(() => {
    mkdirSync('content/places', { recursive: true })
    writeFileSync(fixturePath(FIRST), JSON.stringify(place(FIRST, 'Aaapur')))
    writeFileSync(fixturePath(SECOND), JSON.stringify(place(SECOND, 'Zzzpur')))
  })

  afterAll(() => {
    rmSync(fixturePath(FIRST), { force: true })
    rmSync(fixturePath(SECOND), { force: true })
    rmSync(dir2, { recursive: true, force: true })
  })

  // Every it() below shells out to the real say -> afconvert pipeline, which
  // is far slower than vitest's 5s default test timeout (30 fresh lines take
  // ~20s on this machine). Hook timeouts default higher, which is why the
  // single-fixture beforeAll above didn't need this, but these run inside
  // it() bodies, so they need explicit budgets.

  it('renders both fixture places on a full run', () => {
    const out = run()
    console.log(out)
    const ids = Object.keys(timings2())
    expect(ids.some(k => k.startsWith(FIRST))).toBe(true)
    expect(ids.some(k => k.startsWith(SECOND))).toBe(true)
  }, 60_000)

  it('reuses cached audio and preserves the other place when --only is used', () => {
    const before = introMtime(FIRST)
    const out = run(`--only=${FIRST}`)
    console.log(out)
    expect(out).toMatch(/0 rendered, 10 reused from cache/)
    expect(Object.keys(timings2()).some(k => k.startsWith(SECOND))).toBe(true)
    expect(introMtime(FIRST)).toBe(before)
  }, 30_000)

  it('REGRESSION: --only combined with --force must not delete the other place\'s entries', () => {
    run(`--only=${FIRST}`, '--force')
    const ids = Object.keys(timings2())
    expect(ids.some(k => k.startsWith(SECOND)), `${SECOND}'s entries were deleted by --only + --force`).toBe(true)
  }, 30_000)

  it('REGRESSION: --only combined with --force must not wipe the other place\'s cache entries', () => {
    // Inspects the cache file left behind by the previous test's
    // `--only=${FIRST} --force` run, rather than issuing a new one: this is
    // the artifact --force was wiping wholesale (Finding 4), even though
    // the timings file (checked by the test above) survived thanks to the
    // Finding 1 fix. A wiped cache doesn't lose data on its own, but it
    // makes the *next* unscoped run re-render, and on the paid provider
    // re-bill, every place --force didn't touch — proven by the next test.
    const cache = JSON.parse(readFileSync(CACHE2, 'utf8'))
    const ids = Object.keys(cache)
    expect(ids.some(k => k.startsWith(SECOND)), `${SECOND}'s cache keys were wiped by --only + --force`).toBe(true)
  })

  it('a subsequent unscoped run reuses both places instead of re-rendering (re-billing) them', () => {
    const beforeFirst = introMtime(FIRST)
    const beforeSecond = introMtime(SECOND)
    const out = run()
    console.log(out)
    // content/places also holds the single-fixture suite's "testland" while
    // this file runs, so don't assert an exact total — just that at least
    // both of ours (10 + 10) came from cache, and neither was touched.
    const reused = Number(out.match(/(\d+) reused from cache/)?.[1])
    expect(reused).toBeGreaterThanOrEqual(20)
    expect(introMtime(FIRST)).toBe(beforeFirst)
    expect(introMtime(SECOND), `${SECOND} was re-rendered instead of reused from cache`).toBe(beforeSecond)
  }, 30_000)

  it('moving a cue updates its time without re-rendering the audio', () => {
    const before = introMtime(FIRST)
    const fixture = JSON.parse(readFileSync(fixturePath(FIRST), 'utf8'))
    fixture.intro.cues = [{ word: 2, do: 'playSfx', arg: 'chime' }]
    writeFileSync(fixturePath(FIRST), JSON.stringify(fixture))

    run(`--only=${FIRST}`)

    const t = timings2()[`${FIRST}.intro`]
    expect(t.cues[0].t).toBe(t.starts[2])
    expect(introMtime(FIRST)).toBe(before)
  }, 30_000)
})
