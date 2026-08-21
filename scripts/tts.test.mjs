import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
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
