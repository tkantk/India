import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { Narrator } from './Narrator'

/** A fake AudioContext whose clock we advance by hand. */
function fakeContext() {
  let now = 0
  const gain = () => ({
    gain: {
      value: 1,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(function (this: unknown) { return this }),
    disconnect: vi.fn(),
  })
  return {
    get currentTime() { return now },
    advance(dt: number) { now += dt },
    state: 'running',
    destination: {},
    sampleRate: 48000,
    resume: vi.fn(async () => {}),
    createGain: vi.fn(gain),
    createBuffer: vi.fn(() => ({})),
    createBufferSource: vi.fn(() => ({
      buffer: null, loop: false, playbackRate: { value: 1 },
      connect: vi.fn(function (this: unknown) { return this }),
      disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null,
    })),
    decodeAudioData: vi.fn(async () => ({ duration: 10 })),
  }
}

/** The shape of one fake gain node, for the assertions that read its mocks. */
type FakeGain = { gain: { linearRampToValueAtTime: Mock } }

const CLIP = {
  audio: 'audio/en/x.m4a', duration: 10,
  words: ['one', 'two', 'three'], starts: [0, 1, 2], ends: [1, 2, 3],
  cues: [
    { t: 1, word: 1, do: 'playSfx', arg: 'growl' },
    { t: 2, word: 2, do: 'revealSymbol', arg: 'tiger' },
  ],
}

let ctx: ReturnType<typeof fakeContext>
let n: Narrator

beforeEach(() => {
  ctx = fakeContext()
  globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })) as never
  n = new Narrator(ctx as never)
})

// tick() schedules the next rAF, so an engine left playing keeps a loop alive
// after the test that started it. Harmless, but it muddies later assertions.
afterEach(() => { n.stop() })

describe('Narrator', () => {
  it('reports no current word before anything plays', () => {
    expect(n.getSnapshot()).toBe(-1)
  })

  it('advances the current word as the audio clock advances', async () => {
    await n.play(CLIP)
    expect(n.getSnapshot()).toBe(0)
    ctx.advance(1.01); n.tick()
    expect(n.getSnapshot()).toBe(1)
    ctx.advance(1.0); n.tick()
    expect(n.getSnapshot()).toBe(2)
  })

  it('fires every cue that fell due in a long frame, in order', async () => {
    const fired: string[] = []
    n.onCue = (c) => fired.push(`${c.do}:${c.arg}`)
    await n.play(CLIP)
    // One 3-second frame: both cues are now due. A `find` would drop one.
    ctx.advance(3); n.tick()
    expect(fired).toEqual(['playSfx:growl', 'revealSymbol:tiger'])
  })

  it('never fires the same cue twice', async () => {
    const fired: string[] = []
    n.onCue = (c) => fired.push(c.do)
    await n.play(CLIP)
    ctx.advance(3); n.tick(); n.tick(); n.tick()
    expect(fired).toHaveLength(2)
  })

  it('notifies subscribers only when the word actually changes', async () => {
    const seen = vi.fn()
    n.subscribe(seen)
    await n.play(CLIP)
    const after = seen.mock.calls.length
    ctx.advance(0.2); n.tick(); n.tick()   // still word 0
    expect(seen.mock.calls.length).toBe(after)
    ctx.advance(1); n.tick()               // now word 1
    expect(seen.mock.calls.length).toBeGreaterThan(after)
  })

  it('resumes from where it paused rather than restarting', async () => {
    await n.play(CLIP)
    ctx.advance(1.5)
    n.pause()
    expect(n.position).toBeCloseTo(1.5, 2)
    ctx.advance(100)                        // wall time passes while paused
    expect(n.position).toBeCloseTo(1.5, 2)  // position must not drift
  })

  it('scales position by the playback rate', async () => {
    await n.play(CLIP)
    n.setRate(0.85)
    ctx.advance(2)
    expect(n.position).toBeCloseTo(1.7, 2)
  })

  it('treats a missing sound effect as silence, not an error', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as never
    await expect(n.sfx('tiger-growl')).resolves.toBeUndefined()
  })

  it('survives a clip that fails to decode', async () => {
    ctx.decodeAudioData = vi.fn(async () => { throw new Error('EncodingError') })
    await expect(n.play(CLIP)).resolves.toBeUndefined()
    expect(n.playing).toBe(false)
  })

  it('keeps at most two decoded clips in memory', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await n.play({ ...CLIP, audio: `audio/en/${id}.m4a` })
    expect(n.decodedCount).toBeLessThanOrEqual(2)
  })

  it('ducks the ambient bed while narration plays and restores it after', async () => {
    await n.ambient('forest')
    const g = n.ambientGainForTest as unknown as FakeGain
    await n.play(CLIP)
    expect(g.gain.linearRampToValueAtTime).toHaveBeenCalledWith(expect.any(Number), expect.any(Number))
    const ducked = g.gain.linearRampToValueAtTime.mock.calls.at(-1)![0]
    n.stop()
    const restored = g.gain.linearRampToValueAtTime.mock.calls.at(-1)![0]
    expect(restored).toBeGreaterThan(ducked)
  })

  // Not in the brief's list, but these three behaviours carry the two highest
  // -severity audio failures on the target device, plus the "again" button.

  it('routes to the playback channel, so a muted-switch iPad is still audible', async () => {
    const session = { type: 'auto' }
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
    try {
      await n.unlock()
      expect(session.type).toBe('playback')
    } finally {
      Reflect.deleteProperty(navigator, 'audioSession')
    }
  })

  it('unlocks on a browser with no audioSession API at all', async () => {
    await expect(n.unlock()).resolves.toBeUndefined()
    // The silent one-sample buffer is what actually opens the output.
    expect(ctx.createBuffer).toHaveBeenCalled()
  })

  it('reports a context that will not leave the interrupted state', async () => {
    ctx.state = 'interrupted'              // WebKit 263627: resume() is not enough
    await expect(n.resumeContext()).resolves.toBe(false)
    expect(n.stuck).toBe(true)
    ctx.resume = vi.fn(async () => { ctx.state = 'running' })
    await expect(n.resumeContext()).resolves.toBe(true)
    expect(n.stuck).toBe(false)
  })

  it('replays the same clip from the beginning, cues and all', async () => {
    const fired: string[] = []
    n.onCue = (c) => fired.push(c.do)
    await n.play(CLIP)
    ctx.advance(3); n.tick()
    n.replay()
    expect(n.position).toBeCloseTo(0, 5)
    expect(n.getSnapshot()).toBe(0)
    ctx.advance(3); n.tick()
    expect(fired).toHaveLength(4)
  })

  it('has no current word once it is stopped', async () => {
    await n.play(CLIP)
    expect(n.getSnapshot()).toBe(0)
    n.stop()
    expect(n.getSnapshot()).toBe(-1)
    expect(n.playing).toBe(false)
  })
})
