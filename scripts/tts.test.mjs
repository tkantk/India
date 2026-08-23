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

// The ordering fix: persist() must run before the temp-directory cleanup,
// and the cleanup must not be able to stop it. Provoked with a real
// filesystem failure — chflags uchg (BSD "user immutable") on the scratch
// directory tts.mjs creates for itself — rather than a mock, so this
// exercises the actual rmSync(tmp, { recursive: true, force: true }) call in
// tts.mjs, not a stand-in for it. force:true only swallows an already-missing
// path; it does nothing for a real permission error, which is the point.
describe.skipIf(!MACOS)('a cleanup failure must not lose the persisted state', () => {
  const WORK4 = mkdtempSync(join(tmpdir(), 'tts-cleanup-work-'))
  const OUT4 = mkdtempSync(join(tmpdir(), 'tts-cleanup-out-'))
  const AUDIO4 = join(OUT4, 'audio')
  const TIMINGS4 = join(OUT4, 'timings.json')
  const CACHE4 = join(OUT4, 'cache.json')
  const SCRIPT4 = join(process.cwd(), 'scripts/tts.mjs')
  const STUB4 = join(WORK4, 'stub-provider.mjs')
  // The stub records tts.mjs's own scratch directory here so afterAll can
  // find and un-poison it — tts.mjs's cleanup is expected to fail on
  // purpose, so nothing else removes it.
  const TMP_RECORD = join(WORK4, 'poisoned-tmp-path.txt')

  const PLACE = 'poisonland'
  const ORDER = [
    `${PLACE}.intro`, `${PLACE}.card.animal`, `${PLACE}.card.food`,
    `${PLACE}.card.festival`, `${PLACE}.card.hello`,
    ...Array.from({ length: 5 }, (_, i) => `${PLACE}.lm${i}.line`),
  ]
  const FAIL_AT = 4                       // 1-based: the fourth line synthesised
  const DONE_IDS = ORDER.slice(0, FAIL_AT - 1)

  const place = (id) => ({
    id, name: id, type: 'state', capital: 'Poisonpur', ambience: 'plains',
    intro: line(`${id}.intro`, 'intro', `${id} is a place where cleanup itself will fail.`),
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

  // On the FAIL_AT call, poisons tts.mjs's own tmpDir (chflags uchg blocks
  // adding/removing entries in a directory, without needing root) and then
  // throws, so the same call both stops the render loop AND dooms the
  // rmSync(tmp, ...) cleanup that runs afterwards.
  const stubSource = `
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
export const name = 'stub'
export const signature = () => 'stub:v1'
let calls = 0
export async function synth(text, { tmpDir, id }) {
  calls++
  writeFileSync(${JSON.stringify(TMP_RECORD)}, tmpDir)
  if (calls === ${FAIL_AT}) {
    execFileSync('chflags', ['uchg', tmpDir])
    throw new Error(\`stub provider failed on purpose at call \${calls} ("\${id}")\`)
  }
  const out = join(tmpDir, \`\${id}.aiff\`)
  execFileSync('say', ['-v', 'Tara', '-r', '130', '-o', out, text])
  return { audioPath: out, alignment: null }
}
`

  beforeAll(() => {
    mkdirSync(join(WORK4, 'content/places'), { recursive: true })
    writeFileSync(join(WORK4, 'content/places', `${PLACE}.json`), JSON.stringify(place(PLACE)))
    writeFileSync(STUB4, stubSource)
  })

  afterAll(() => {
    // tts.mjs's cleanup failed on purpose, so the poisoned directory it left
    // behind is still there and still immutable — un-poison it by hand so
    // this suite doesn't leak a stuck directory into the real OS temp folder.
    if (existsSync(TMP_RECORD)) {
      const poisoned = readFileSync(TMP_RECORD, 'utf8')
      if (existsSync(poisoned)) {
        execFileSync('chflags', ['nouchg', poisoned])
        rmSync(poisoned, { recursive: true, force: true })
      }
    }
    rmSync(WORK4, { recursive: true, force: true })
    rmSync(OUT4, { recursive: true, force: true })
  })

  it('still persists every already-rendered line to timings.json and the cache, even though cleanup itself throws', () => {
    const args = [SCRIPT4, `--provider=${STUB4}`,
      `--audio-dir=${AUDIO4}`, `--timings=${TIMINGS4}`, `--cache=${CACHE4}`]
    let result
    try {
      result = { code: 0, output: execFileSync('node', args, { encoding: 'utf8', cwd: WORK4, stdio: 'pipe' }) }
    } catch (e) {
      result = { code: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }

    expect(result.code, 'a failed render must not exit 0').not.toBe(0)
    // Proves the cleanup itself is the thing that broke, not just the render.
    expect(result.output).toContain('could not remove temp directory')

    expect(existsSync(TIMINGS4), 'timings.json was never written — persist() was skipped').toBe(true)
    expect(existsSync(CACHE4), 'the render cache was never written — persist() was skipped').toBe(true)

    const timings = JSON.parse(readFileSync(TIMINGS4, 'utf8'))
    const cache = JSON.parse(readFileSync(CACHE4, 'utf8'))
    for (const id of DONE_IDS) {
      expect(Object.keys(timings), `${id} was rendered but its bookkeeping was lost`).toContain(id)
      expect(Object.keys(cache), `${id} is not cached — it will be re-rendered and re-billed`).toContain(id)
    }
  }, 60_000)
})

// -----------------------------------------------------------------------
// Task 6a: the tts:draft footgun. `npm run tts:draft` runs --provider=say,
// whose cache key misses on every line the instant a different provider
// produced them, and nothing before this guard stopped `say` from silently
// overwriting a paid clip with the macOS robot voice. The guard fires
// BEFORE any provider.synth() call, so the "refuses" half of these needs no
// audio pipeline at all and runs on every platform; only the "--yes bypasses
// and actually renders" half needs the real say pipeline.
// -----------------------------------------------------------------------
describe('Task 6a: provider-change guard refuses before rendering anything', () => {
  const WORK5 = mkdtempSync(join(tmpdir(), 'tts-guard-work-'))
  const OUT5 = mkdtempSync(join(tmpdir(), 'tts-guard-out-'))
  const AUDIO5 = join(OUT5, 'audio')
  const TIMINGS5 = join(OUT5, 'timings.json')
  const CACHE5 = join(OUT5, 'cache.json')
  const SCRIPT5 = join(process.cwd(), 'scripts/tts.mjs')
  const PLACE = 'guardland'

  const place = (id) => ({
    id, name: id, type: 'state', capital: 'Guardpur', ambience: 'plains',
    intro: line(`${id}.intro`, 'intro', `${id} welcomes every visitor warmly today.`),
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

  beforeAll(() => {
    mkdirSync(join(WORK5, 'content/places'), { recursive: true })
    writeFileSync(join(WORK5, 'content/places', `${PLACE}.json`), JSON.stringify(place(PLACE)))
    mkdirSync(AUDIO5, { recursive: true })
    // Pretend a previous, DIFFERENT provider already rendered every line: a
    // fake .m4a on disk for each, plus a cache sidecar recording a signature
    // that is not `say`'s.
    for (const id of [
      `${PLACE}.intro`, `${PLACE}.card.animal`, `${PLACE}.card.food`,
      `${PLACE}.card.festival`, `${PLACE}.card.hello`,
      ...Array.from({ length: 5 }, (_, i) => `${PLACE}.lm${i}.line`),
    ]) {
      writeFileSync(join(AUDIO5, `${id}.m4a`), 'not real audio, just needs to exist')
    }
    writeFileSync(CACHE5, JSON.stringify({ __signature__: 'elevenlabs:some-other-voice:v1' }))
  })

  afterAll(() => {
    rmSync(WORK5, { recursive: true, force: true })
    rmSync(OUT5, { recursive: true, force: true })
  })

  const run = (...args) => {
    const fullArgs = [SCRIPT5, '--provider=say',
      `--audio-dir=${AUDIO5}`, `--timings=${TIMINGS5}`, `--cache=${CACHE5}`, ...args]
    try {
      return { code: 0, output: execFileSync('node', fullArgs, { encoding: 'utf8', cwd: WORK5, stdio: 'pipe' }) }
    } catch (e) {
      return { code: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }

  it('a changed provider with existing clips on disk exits without --yes, and touches nothing', () => {
    const { code, output } = run(`--only=${PLACE}`)
    expect(code, 'the guard must exit non-zero, not silently proceed').not.toBe(0)
    expect(output).toMatch(/Refusing to render/i)
    expect(existsSync(TIMINGS5), 'must not have started rendering — no timings file written').toBe(false)
  })

  it("the refusal message never prints the raw recorded signature — only a redacted fingerprint", () => {
    const { output } = run(`--only=${PLACE}`)
    // The exact string beforeAll wrote into the cache sidecar must never
    // appear verbatim on stdout/stderr — a real ElevenLabs signature embeds
    // the account's voice id, and this message is safe-to-log by design.
    expect(output).not.toContain('elevenlabs:some-other-voice:v1')
    expect(output).toMatch(/\(none recorded\)|[0-9a-f]{8}/)
  })
})

// These two only pass when the guard does NOT fire, so the script goes on to
// render for real through the say -> afconvert pipeline — macOS-only, same
// as every other real-pipeline suite in this file.
describe.skipIf(!MACOS)('Task 6a: the guard does not block a legitimate render', () => {
  const WORK5b = mkdtempSync(join(tmpdir(), 'tts-guard-ok-work-'))
  const OUT5b = mkdtempSync(join(tmpdir(), 'tts-guard-ok-out-'))
  const AUDIO5b = join(OUT5b, 'audio')
  const TIMINGS5b = join(OUT5b, 'timings.json')
  const CACHE5b = join(OUT5b, 'cache.json')
  const SCRIPT5b = join(process.cwd(), 'scripts/tts.mjs')
  const PLACE = 'okland'

  const place = (id) => ({
    id, name: id, type: 'state', capital: 'Okpur', ambience: 'plains',
    intro: line(`${id}.intro`, 'intro', `${id} welcomes every visitor warmly today.`),
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

  beforeAll(() => {
    mkdirSync(join(WORK5b, 'content/places'), { recursive: true })
    writeFileSync(join(WORK5b, 'content/places', `${PLACE}.json`), JSON.stringify(place(PLACE)))
    mkdirSync(AUDIO5b, { recursive: true })
    writeFileSync(join(AUDIO5b, `${PLACE}.intro.m4a`), 'not real audio, just needs to exist')
  })

  afterAll(() => {
    rmSync(WORK5b, { recursive: true, force: true })
    rmSync(OUT5b, { recursive: true, force: true })
  })

  const run = (...args) => execFileSync('node', [
    SCRIPT5b, '--provider=say', `--only=${PLACE}`,
    `--audio-dir=${AUDIO5b}`, `--timings=${TIMINGS5b}`, `--cache=${CACHE5b}`, ...args,
  ], { encoding: 'utf8', cwd: WORK5b })

  it('--force on an unchanged provider is unaffected — the guard only fires on a provider SWAP', () => {
    writeFileSync(CACHE5b, JSON.stringify({ __signature__: 'say:Tara:130' }))
    const output = run('--force')
    expect(output).not.toMatch(/Refusing to render/i)
    expect(existsSync(TIMINGS5b)).toBe(true)
  }, 30_000)

  it('a fresh tree — no sidecar signature at all — prompts for nothing, even with clips already on disk', () => {
    const freshCache = join(OUT5b, 'fresh-cache.json')
    // No cache file at all: existsSync(CACHE) is false in tts.mjs, so `cache`
    // starts as {} and cache.__signature__ is undefined.
    const output = run(`--cache=${freshCache}`)
    expect(output).not.toMatch(/Refusing to render/i)
  }, 30_000)
})

describe.skipIf(!MACOS)('Task 6a: --yes bypasses the provider-change guard and renders for real', () => {
  const WORK6 = mkdtempSync(join(tmpdir(), 'tts-guard-yes-work-'))
  const OUT6 = mkdtempSync(join(tmpdir(), 'tts-guard-yes-out-'))
  const AUDIO6 = join(OUT6, 'audio')
  const TIMINGS6 = join(OUT6, 'timings.json')
  const CACHE6 = join(OUT6, 'cache.json')
  const SCRIPT6 = join(process.cwd(), 'scripts/tts.mjs')
  const PLACE = 'yesland'

  const place = (id) => ({
    id, name: id, type: 'state', capital: 'Yespur', ambience: 'plains',
    intro: line(`${id}.intro`, 'intro', `${id} welcomes every visitor warmly today.`),
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

  beforeAll(() => {
    mkdirSync(join(WORK6, 'content/places'), { recursive: true })
    writeFileSync(join(WORK6, 'content/places', `${PLACE}.json`), JSON.stringify(place(PLACE)))
    mkdirSync(AUDIO6, { recursive: true })
    writeFileSync(join(AUDIO6, `${PLACE}.intro.m4a`), 'not real audio, just needs to exist')
    writeFileSync(CACHE6, JSON.stringify({ __signature__: 'elevenlabs:some-other-voice:v1' }))
  })

  afterAll(() => {
    rmSync(WORK6, { recursive: true, force: true })
    rmSync(OUT6, { recursive: true, force: true })
  })

  it('--yes proceeds through a changed-provider guard and actually renders', () => {
    const args = [SCRIPT6, '--provider=say', `--only=${PLACE}`,
      `--audio-dir=${AUDIO6}`, `--timings=${TIMINGS6}`, `--cache=${CACHE6}`, '--yes']
    const output = execFileSync('node', args, { encoding: 'utf8', cwd: WORK6, stdio: 'pipe' })
    expect(output).not.toMatch(/Refusing to render/i)
    expect(existsSync(TIMINGS6)).toBe(true)
    const timings = JSON.parse(readFileSync(TIMINGS6, 'utf8'))
    expect(Object.keys(timings).some((k) => k.startsWith(PLACE))).toBe(true)
    // The sidecar now reflects `say`, closing the gap for the NEXT run.
    const cache = JSON.parse(readFileSync(CACHE6, 'utf8'))
    expect(cache.__signature__).toMatch(/^say:/)
  }, 30_000)
})

// -----------------------------------------------------------------------
// Task 6b: prosodic continuity. A stub provider stands in for ElevenLabs —
// same interface (signature/concurrency/synth/requestId), but ASYNC and
// non-blocking (a setTimeout delay, not a blocking child process), which is
// what makes real wall-clock parallelism observable at all: `say` itself is
// a blocking execFileSync call, so no stub built on it could ever show two
// requests genuinely overlapping in time. Every call is logged — id,
// previousRequestIds, nextText, start/end — to a file, because the stub runs
// in a spawned child process and cannot share memory with this test.
// Encoding (afconvert) still runs for real, on a single pre-rendered seed
// clip every call copies — that is the macOS dependency this whole suite is
// gated on, not the (fake) network request.
// -----------------------------------------------------------------------
describe.skipIf(!MACOS)('Task 6b: runs — serial within, parallel across, ids threaded, cache chaining, --only widening, id expiry', () => {
  const WORK7 = mkdtempSync(join(tmpdir(), 'tts-runs-work-'))
  const OUT7 = mkdtempSync(join(tmpdir(), 'tts-runs-out-'))
  const AUDIO7 = join(OUT7, 'audio')
  const TIMINGS7 = join(OUT7, 'timings.json')
  const CACHE7 = join(OUT7, 'cache.json')
  const SCRIPT7 = join(process.cwd(), 'scripts/tts.mjs')
  const STUB7 = join(WORK7, 'stub-chain.mjs')
  const SEED = join(WORK7, 'seed.aiff')
  const LOG = join(OUT7, 'calls.jsonl')
  const PLACE = 'onestate'
  const DELAY_MS = 200

  const place = (id) => ({
    id, name: id, type: 'state', capital: 'Onepur', ambience: 'plains',
    intro: line(`${id}.intro`, 'intro', `${id} welcomes every visitor warmly today.`),
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

  const beat = (n, text) => line(`tour.0${n}`, 'tour', text)
  const tour = (texts) => ({ beats: texts.map((t, i) => beat(i + 1, t)) })
  const FOUR_BEATS = [
    'Namaste! Come with me on a little walk.',
    'This is the very first stop on our way.',
    'Now we turn and see something else entirely.',
    'And here we are, right at the very end.',
  ]
  const tourPath = () => join(WORK7, 'content/tour.json')

  const stubSource = `
import { copyFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'stub-chain'
export const signature = () => 'stub-chain:v1'
export const concurrency = 4
const SEED = ${JSON.stringify(SEED)}
const LOG = ${JSON.stringify(LOG)}
const DELAY_MS = ${DELAY_MS}
export async function synth(text, { tmpDir, id, previousRequestIds, nextText }) {
  const startedAt = Date.now()
  await new Promise((r) => setTimeout(r, DELAY_MS))
  const out = join(tmpDir, \`\${id}.aiff\`)
  copyFileSync(SEED, out)
  const endedAt = Date.now()
  appendFileSync(LOG, JSON.stringify({
    id, previousRequestIds: previousRequestIds ?? null, nextText: nextText ?? null, startedAt, endedAt,
  }) + '\\n')
  return { audioPath: out, alignment: null, requestId: \`req_\${id}\` }
}
`

  beforeAll(() => {
    mkdirSync(join(WORK7, 'content/places'), { recursive: true })
    writeFileSync(join(WORK7, 'content/places', `${PLACE}.json`), JSON.stringify(place(PLACE)))
    writeFileSync(tourPath(), JSON.stringify(tour(FOUR_BEATS)))
    writeFileSync(STUB7, stubSource)
    // One real, tiny clip, generated once — every synth() call below just
    // copies it, so encoding is real but no test pays for eleven separate
    // blocking `say` invocations.
    execFileSync('say', ['-v', 'Tara', '-r', '130', '-o', SEED, 'Hello.'])
  })

  afterAll(() => {
    rmSync(WORK7, { recursive: true, force: true })
    rmSync(OUT7, { recursive: true, force: true })
  })

  const run = (...args) => execFileSync('node', [
    SCRIPT7, `--provider=${STUB7}`,
    `--audio-dir=${AUDIO7}`, `--timings=${TIMINGS7}`, `--cache=${CACHE7}`, ...args,
  ], { encoding: 'utf8', cwd: WORK7 })

  const readLog = () => existsSync(LOG)
    ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
  const resetLog = () => writeFileSync(LOG, '')
  const byId = (entries, id) => entries.find((e) => e.id === id)

  it('renders every place line and every tour beat on a full run', () => {
    resetLog()
    run()
    const entries = readLog()
    expect(entries.map((e) => e.id).sort()).toEqual(
      [
        `${PLACE}.intro`, `${PLACE}.card.animal`, `${PLACE}.card.food`, `${PLACE}.card.festival`, `${PLACE}.card.hello`,
        ...Array.from({ length: 5 }, (_, i) => `${PLACE}.lm${i}.line`),
        'tour.01', 'tour.02', 'tour.03', 'tour.04',
      ].sort(),
    )
  }, 30_000)

  it('a run-of-one (every place line) sends no previousRequestIds and no nextText', () => {
    const entries = readLog()
    for (const id of [`${PLACE}.intro`, `${PLACE}.card.animal`]) {
      const e = byId(entries, id)
      expect(e.previousRequestIds).toBeNull()
      expect(e.nextText).toBeNull()
    }
  })

  it('ids are threaded through the tour run, most recent last, capped at 3', () => {
    const entries = readLog()
    expect(byId(entries, 'tour.01').previousRequestIds).toBeNull()
    expect(byId(entries, 'tour.02').previousRequestIds).toEqual(['req_tour.01'])
    expect(byId(entries, 'tour.03').previousRequestIds).toEqual(['req_tour.01', 'req_tour.02'])
    expect(byId(entries, 'tour.04').previousRequestIds).toEqual(['req_tour.01', 'req_tour.02', 'req_tour.03'])
  })

  it('next_text is forward-only: each beat gets the NEXT beat\'s text, and the last beat gets none', () => {
    const entries = readLog()
    expect(byId(entries, 'tour.01').nextText).toBe(FOUR_BEATS[1])
    expect(byId(entries, 'tour.02').nextText).toBe(FOUR_BEATS[2])
    expect(byId(entries, 'tour.03').nextText).toBe(FOUR_BEATS[3])
    expect(byId(entries, 'tour.04').nextText).toBeNull()
  })

  it('the tour run is strictly serial: each beat starts only after the one before it ended', () => {
    const entries = readLog()
    const ordered = ['tour.01', 'tour.02', 'tour.03', 'tour.04'].map((id) => byId(entries, id))
    const SLACK_MS = 20 // clock/scheduling jitter, tiny next to the 200ms delay
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].startedAt, `${ordered[i].id} started before ${ordered[i - 1].id} ended`)
        .toBeGreaterThanOrEqual(ordered[i - 1].endedAt - SLACK_MS)
    }
  })

  it('independent runs (the place lines) genuinely overlap in wall-clock time — real parallelism, not a queue of one', () => {
    const entries = readLog()
    const placeCalls = entries.filter((e) => e.id.startsWith(PLACE))
    const overlaps = (a, b) => a.startedAt < b.endedAt && b.startedAt < a.endedAt
    let overlapping = false
    for (let i = 0; i < placeCalls.length && !overlapping; i++) {
      for (let j = i + 1; j < placeCalls.length; j++) {
        if (overlaps(placeCalls[i], placeCalls[j])) { overlapping = true; break }
      }
    }
    expect(overlapping, 'no two independent runs ever overlapped — the pool is not actually parallel').toBe(true)
  })

  it('--only=tour.02 widens to the whole 4-beat run, not just tour.02', () => {
    resetLog()
    run('--only=tour.02', '--force')
    const ids = readLog().map((e) => e.id).sort()
    expect(ids).toEqual(['tour.01', 'tour.02', 'tour.03', 'tour.04'])
  }, 30_000)

  it('--only with a value that matches nothing errors instead of silently rendering zero lines', () => {
    resetLog()
    let result
    try {
      result = { code: 0, output: execFileSync('node', [
        SCRIPT7, `--provider=${STUB7}`, '--only=tour.99',
        `--audio-dir=${AUDIO7}`, `--timings=${TIMINGS7}`, `--cache=${CACHE7}`,
      ], { encoding: 'utf8', cwd: WORK7, stdio: 'pipe' }) }
    } catch (e) {
      result = { code: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(/matched no lines/)
    expect(readLog()).toHaveLength(0)
  })

  it('editing only the LAST beat re-renders it and the beat before it, but leaves beats 1-2 cached', () => {
    resetLog()
    const edited = JSON.parse(readFileSync(tourPath(), 'utf8'))
    edited.beats[3].text = 'And here we are, at a very different end indeed.'
    writeFileSync(tourPath(), JSON.stringify(edited))

    run()

    const entries = readLog()
    expect(entries.map((e) => e.id).sort()).toEqual(['tour.03', 'tour.04'])
    // tour.03's chain still seeds from the CACHED (not re-rendered) tour.01
    // and tour.02 ids from the very first run above.
    expect(byId(entries, 'tour.03').previousRequestIds).toEqual(['req_tour.01', 'req_tour.02'])
    expect(byId(entries, 'tour.03').nextText).toBe(edited.beats[3].text)
  }, 30_000)

  it('stale (>2h old) preceding request ids restart the WHOLE run from its first line', () => {
    // Doctor the persisted cache: back-date tour.01 and tour.02's renderedAt
    // well past the 2-hour freshness window, so tour.03's would-be seed ids
    // are no longer good enough to condition a request on.
    const cache = JSON.parse(readFileSync(CACHE7, 'utf8'))
    const THREE_HOURS = 3 * 60 * 60 * 1000
    for (const id of ['tour.01', 'tour.02']) {
      cache[id] = { ...cache[id], renderedAt: Date.now() - THREE_HOURS }
    }
    writeFileSync(CACHE7, JSON.stringify(cache))

    resetLog()
    const edited = JSON.parse(readFileSync(tourPath(), 'utf8'))
    edited.beats[3].text = 'And here we are, at yet another different end.'
    writeFileSync(tourPath(), JSON.stringify(edited))

    run()

    const ids = readLog().map((e) => e.id).sort()
    expect(ids).toEqual(['tour.01', 'tour.02', 'tour.03', 'tour.04'])
    expect(byId(readLog(), 'tour.01').previousRequestIds).toBeNull()
  }, 30_000)
})
