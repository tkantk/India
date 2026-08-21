import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const line = (id, kind, text, cues) => ({ id, kind, text, ...(cues ? { cues } : {}) })

// The whole suite drives the real say -> afconvert pipeline, both of which
// are macOS-only, and CI runs on ubuntu-latest. Without this guard the first
// push to main fails the build job and the site never deploys.
const MACOS = process.platform === 'darwin'

// Runs the real pipeline (say -> afconvert -> timings), but reads and writes
// entirely inside scratch directories. tts.mjs's --audio-dir/--timings/--cache
// flags exist for exactly this: without them, running this suite would leave a
// "testland" clip and timings entry committed alongside real content. The
// fixture place goes in a scratch workspace for the same reason — written into
// the tracked content/places, an interrupted run leaves a stray testland.json
// behind, and an unscoped run would pick it up.
const dir = mkdtempSync(join(tmpdir(), 'tts-test-'))
const AUDIO_DIR = join(dir, 'audio')
const TIMINGS = join(dir, 'timings.json')
const CACHE = join(dir, 'cache.json')
const WORK1 = mkdtempSync(join(tmpdir(), 'tts-test-work-'))
const FIXTURE = join(WORK1, 'content/places/testland.json')
const SCRIPT1 = join(process.cwd(), 'scripts/tts.mjs')

describe.skipIf(!MACOS)('tts pipeline with the draft voice', () => {
  beforeAll(() => {
    mkdirSync(join(WORK1, 'content/places'), { recursive: true })
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
      SCRIPT1,
      '--provider=say',
      '--only=testland',
      `--audio-dir=${AUDIO_DIR}`,
      `--timings=${TIMINGS}`,
      `--cache=${CACHE}`,
    ], { stdio: 'inherit', cwd: WORK1 })
  })

  afterAll(() => {
    rmSync(WORK1, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

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
describe.skipIf(!MACOS)('cache reuse, --only, and --force semantics', () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'tts-test2-'))
  const AUDIO2 = join(dir2, 'audio')
  const TIMINGS2 = join(dir2, 'timings.json')
  const CACHE2 = join(dir2, 'cache.json')

  // These cases exercise the UNSCOPED run, which renders every line
  // tts.mjs can find. collectLines() reads content/places, content/tour.json
  // and content/ui.json relative to the child's cwd, so the child is given a
  // workspace holding nothing but this suite's two fixtures. Dropping the
  // fixtures into the real content/places instead would make an unscoped run
  // re-render the entire seed corpus into a cold scratch cache on every
  // assertion — minutes of `say`, and slower with every state Plan 3 adds.
  const WORK = mkdtempSync(join(tmpdir(), 'tts-work-'))
  const SCRIPT = join(process.cwd(), 'scripts/tts.mjs')

  const FIRST = 'aaastateone'
  const SECOND = 'zzzstatetwo'
  const fixturePath = (id) => join(WORK, 'content/places', `${id}.json`)

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
    SCRIPT, '--provider=say',
    `--audio-dir=${AUDIO2}`, `--timings=${TIMINGS2}`, `--cache=${CACHE2}`,
    ...args,
  ], { encoding: 'utf8', cwd: WORK })

  const timings2 = () => JSON.parse(readFileSync(TIMINGS2, 'utf8'))
  const introMtime = (id) => statSync(join(AUDIO2, `${id}.intro.m4a`)).mtimeMs

  beforeAll(() => {
    mkdirSync(join(WORK, 'content/places'), { recursive: true })
    writeFileSync(fixturePath(FIRST), JSON.stringify(place(FIRST, 'Aaapur')))
    writeFileSync(fixturePath(SECOND), JSON.stringify(place(SECOND, 'Zzzpur')))
  })

  afterAll(() => {
    rmSync(WORK, { recursive: true, force: true })
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
    // The workspace holds exactly these two places, ten lines each, so an
    // unscoped run must reuse all twenty and render none.
    expect(out).toMatch(/0 rendered, 20 reused from cache/)
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

// Every rendered line is already paid for on the paid provider. A failure
// partway through a run must therefore never discard the lines that already
// succeeded: their .m4a files are on disk, so if timings.json and the render
// cache do not record them, the next run re-renders — and re-bills — the lot.
// The triggers are all plausible: a quota 401, "gave up after 5 attempts", a
// missing alignment, the zero-duration guard.
describe.skipIf(!MACOS)('persisting partial progress when a run fails partway', () => {
  const WORK3 = mkdtempSync(join(tmpdir(), 'tts-fail-work-'))
  const OUT3 = mkdtempSync(join(tmpdir(), 'tts-fail-out-'))
  const AUDIO3 = join(OUT3, 'audio')
  const TIMINGS3 = join(OUT3, 'timings.json')
  const CACHE3 = join(OUT3, 'cache.json')
  const SCRIPT3 = join(process.cwd(), 'scripts/tts.mjs')
  const STUB = join(WORK3, 'stub-provider.mjs')

  const PLACE = 'failland'
  // collectLines() order for one place, which is also the order a POOL=1
  // provider is called in: intro, the four card lines, then the landmarks.
  const ORDER = [
    `${PLACE}.intro`, `${PLACE}.card.animal`, `${PLACE}.card.food`,
    `${PLACE}.card.festival`, `${PLACE}.card.hello`,
    ...Array.from({ length: 5 }, (_, i) => `${PLACE}.lm${i}.line`),
  ]
  const FAIL_AT = 4                       // 1-based: the fourth line synthesised
  const FAILED_ID = ORDER[FAIL_AT - 1]
  const DONE_IDS = ORDER.slice(0, FAIL_AT - 1)

  const place = (id) => ({
    id, name: id, type: 'state', capital: 'Failpur', ambience: 'plains',
    intro: line(`${id}.intro`, 'intro', `${id} is a place where one line will fail.`),
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

  // A provider with the same interface as say.mjs that throws on the Nth
  // call, standing in for the paid provider's failure modes without spending
  // anything. tts.mjs takes a path here, not just a bare provider name, so
  // this stub can live in scratch instead of scripts/tts-providers/.
  const stubSource = `
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
export const name = 'stub'
export const signature = () => 'stub:v1'
let calls = 0
export async function synth(text, { tmpDir, id }) {
  calls++
  const failAt = Number(process.env.STUB_FAIL_AT || 0)
  if (failAt && calls === failAt) throw new Error(\`stub provider failed on purpose at call \${calls} ("\${id}")\`)
  const out = join(tmpDir, \`\${id}.aiff\`)
  execFileSync('say', ['-v', 'Tara', '-r', '130', '-o', out, text])
  return { audioPath: out, alignment: null }
}
`

  const run = (failAt, ...extra) => {
    const args = [SCRIPT3, `--provider=${STUB}`,
      `--audio-dir=${AUDIO3}`, `--timings=${TIMINGS3}`, `--cache=${CACHE3}`, ...extra]
    const opts = { encoding: 'utf8', cwd: WORK3, stdio: 'pipe',
                   env: { ...process.env, STUB_FAIL_AT: String(failAt) } }
    try {
      return { code: 0, output: execFileSync('node', args, opts) }
    } catch (e) {
      return { code: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }

  beforeAll(() => {
    mkdirSync(join(WORK3, 'content/places'), { recursive: true })
    writeFileSync(join(WORK3, 'content/places', `${PLACE}.json`), JSON.stringify(place(PLACE)))
    writeFileSync(STUB, stubSource)
  })

  afterAll(() => {
    rmSync(WORK3, { recursive: true, force: true })
    rmSync(OUT3, { recursive: true, force: true })
  })

  const timings3 = () => JSON.parse(readFileSync(TIMINGS3, 'utf8'))

  it('fails the run, but still writes both bookkeeping files', () => {
    const { code } = run(FAIL_AT)
    expect(code, 'a failed render must not exit 0').not.toBe(0)
    expect(existsSync(TIMINGS3), 'timings.json was never written').toBe(true)
    expect(existsSync(CACHE3), 'the render cache was never written').toBe(true)
  }, 60_000)

  it('records the lines that completed before the failure', () => {
    const t = timings3()
    for (const id of DONE_IDS) {
      expect(existsSync(join(AUDIO3, `${id}.m4a`)), `${id}.m4a is missing`).toBe(true)
      expect(Object.keys(t), `${id} was rendered but not persisted`).toContain(id)
      expect(t[id].duration).toBeGreaterThan(0)
    }
    const cache = JSON.parse(readFileSync(CACHE3, 'utf8'))
    for (const id of DONE_IDS) expect(Object.keys(cache), `${id} is not cached`).toContain(id)
  })

  it('writes no timings entry for the line whose audio failed', () => {
    expect(Object.keys(timings3())).not.toContain(FAILED_ID)
    expect(Object.keys(JSON.parse(readFileSync(CACHE3, 'utf8')))).not.toContain(FAILED_ID)
  })

  it('does not re-render (re-bill) the completed lines on the next run', () => {
    const { code, output } = run(0)
    expect(code).toBe(0)
    expect(output).toMatch(new RegExp(`${10 - DONE_IDS.length} rendered, ${DONE_IDS.length} reused from cache`))
  }, 60_000)

  // A partial write must still be a VALID timings file, not just a non-empty
  // one. --only seeds it from the previous file so a scoped run does not
  // delete every other clip's entry; a failure partway through must not undo
  // that seeding and reintroduce the very data loss --only was fixed for.
  it('keeps the entries a --only run was seeded with when it fails partway', () => {
    const before = Object.keys(timings3())
    expect(before).toHaveLength(10)

    // --force re-renders all ten in scope; the third of them throws, so lines
    // four to ten are never reached at all.
    const { code } = run(3, `--only=${PLACE}`, '--force')
    expect(code).not.toBe(0)

    const after = timings3()
    expect(Object.keys(after)).not.toContain(ORDER[2])
    for (const id of [...ORDER.slice(0, 2), ...ORDER.slice(3)]) {
      expect(Object.keys(after), `${id} was dropped by the failed run`).toContain(id)
      expect(after[id].duration).toBeGreaterThan(0)
    }
  }, 60_000)

  // The unscoped half of the same guarantee. An unscoped run starts from an
  // empty timings object on purpose — that is what prunes clips whose line no
  // longer exists — so a partial write of that object would delete the entry
  // for every line the run never reached, and the next run would see no
  // previous timing, treat them as uncached, and re-render (re-bill) them.
  it('keeps the entries an unscoped run never reached when it fails partway', () => {
    const before = Object.keys(timings3())
    const untouched = before.filter(id => id !== ORDER[0] && id !== ORDER[1])
    expect(untouched.length).toBeGreaterThan(3)

    const { code } = run(2, '--force')
    expect(code).not.toBe(0)

    const after = timings3()
    for (const id of untouched) {
      expect(Object.keys(after), `${id} was never reached, yet its entry was deleted`).toContain(id)
    }
  }, 60_000)
})
