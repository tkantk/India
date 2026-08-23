import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { Narrator } from './Narrator'

/** One fake AudioBufferSourceNode. Kept so a test can end it naturally. */
type FakeSource = {
  buffer: unknown
  loop: boolean
  playbackRate: { value: number }
  connect: Mock
  disconnect: Mock
  start: Mock
  stop: Mock
  onended: (() => void) | null
}

/** A fake AudioContext whose clock we advance by hand. */
function fakeContext() {
  let now = 0
  const sources: FakeSource[] = []
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
    createBufferSource: vi.fn((): FakeSource => {
      const s: FakeSource = {
        buffer: null, loop: false, playbackRate: { value: 1 },
        connect: vi.fn(function (this: unknown) { return this }),
        disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null,
      }
      sources.push(s)
      return s
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 10 })),
    /** Every source ever created, newest last. */
    sources,
  }
}

/** End the clip that is playing right now, the way the hardware would. */
function endNaturally(ctx: ReturnType<typeof fakeContext>) {
  const s = ctx.sources.at(-1)
  if (!s?.onended) throw new Error('no live source to end')
  s.onended()
}

/** The shape of one fake gain node, for the assertions that read its mocks. */
type FakeGain = { gain: { linearRampToValueAtTime: Mock } }

/** The gain node the constructor builds first, which is the master. */
function masterGain(ctx: ReturnType<typeof fakeContext>) {
  return ctx.createGain.mock.results[0].value as unknown as FakeGain
}

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

  it('treats a sound that fails to load as silence, not an error', async () => {
    // `elephant` IS in sound-credits.json, so this really does reach the
    // fetch and exercise the !res.ok branch.
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as never
    await expect(n.sfx('elephant')).resolves.toBeUndefined()
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('does not even ask for a sound the build never fetched', async () => {
    // `tiger-growl` is one of the five the content wants and we do not have.
    // The manifest short-circuits it, so there is no 404 in the network log
    // for a parent to worry about.
    await expect(n.sfx('tiger-growl')).resolves.toBeUndefined()
    await expect(n.ambient('desert')).resolves.toBeUndefined()
    expect(globalThis.fetch).not.toHaveBeenCalled()
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

  it('answers "say it again" even after stop() threw the buffer away — the button that used to be a hard no-op', async () => {
    // The actual defect: `replay()` bailed on `!this.buffer`, and `stop()`'s
    // teardown() is exactly what nulls it. Every stopped state a control can
    // be pressed from — after a tap, after Home, after the tour ends — looks
    // like this to the engine.
    const fired: string[] = []
    n.onCue = (c) => fired.push(c.do)
    await n.play(CLIP)
    ctx.advance(3); n.tick()
    n.stop()
    expect(n.playing).toBe(false)
    expect(n.position).toBe(0)
    fired.length = 0   // only what happens AFTER the replay is under test

    await n.replay()

    expect(n.playing).toBe(true)
    expect(n.position).toBeCloseTo(0, 5)
    expect(n.getSnapshot()).toBe(0)
    // A fresh node, not the one stop() already tore down.
    expect(ctx.sources.at(-1)!.start).toHaveBeenCalledWith(0, 0)
    ctx.advance(3); n.tick()
    expect(fired).toHaveLength(2)   // both cues, from the top, exactly once
  })

  it('does not fight its own in-flight load when replay is pressed before play() has resolved', async () => {
    // Pressing "again" while beat 1 — never prefetched — is still decoding.
    const fired: string[] = []
    n.onCue = (c) => fired.push(c.do)
    const first = n.play(CLIP)
    expect(n.loading).toBe(true)
    expect(n.playing).toBe(false)

    await n.replay()   // must not throw, double-fetch, or otherwise misfire
    await first

    expect(n.playing).toBe(true)
    expect(n.position).toBeCloseTo(0, 5)
    expect(globalThis.fetch).toHaveBeenCalledOnce()   // no duplicate request
    ctx.advance(3); n.tick()
    expect(fired).toHaveLength(2)   // each cue exactly once, not twice
  })

  it('publishes loading for the span of play()\'s own decode, so the bar never lies about "Play"', async () => {
    expect(n.loading).toBe(false)
    const p = n.play(CLIP)
    expect(n.loading).toBe(true)
    await p
    expect(n.loading).toBe(false)
    expect(n.playing).toBe(true)
  })

  it('does not stay "loading" forever when the clip 404s', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as never
    const p = n.play(CLIP)
    expect(n.loading).toBe(true)
    await p
    expect(n.loading).toBe(false)
    expect(n.playing).toBe(false)
  })

  it('reports the natural end of a clip, so the tour can move to the next beat', async () => {
    const ended = vi.fn()
    n.onEnd = ended
    await n.play(CLIP)
    ctx.advance(10)
    endNaturally(ctx)
    expect(ended).toHaveBeenCalledOnce()
    expect(n.playing).toBe(false)
    expect(n.getSnapshot()).toBe(-1)
    expect(n.position).toBeCloseTo(CLIP.duration, 5)
  })

  it('does not report an end when we stopped it ourselves', async () => {
    const ended = vi.fn()
    n.onEnd = ended
    await n.play(CLIP)
    ctx.advance(1)
    n.pause()
    n.stop()
    expect(ended).not.toHaveBeenCalled()
  })

  it('resumes the paused clip from its offset, not from the top', async () => {
    await n.play(CLIP)
    ctx.advance(1.5); n.tick()
    n.pause()
    ctx.advance(50)                       // the child wandered off
    n.resume()
    expect(n.playing).toBe(true)
    expect(n.position).toBeCloseTo(1.5, 5)
    // A one-shot node cannot be re-started, so this is a fresh one seeked to
    // where we left off.
    expect(ctx.sources.at(-1)!.start).toHaveBeenCalledWith(0, expect.closeTo(1.5, 5))
    ctx.advance(0.6); n.tick()
    expect(n.getSnapshot()).toBe(2)
  })

  it('prefetches ahead, reuses what it has, and evicts on request', async () => {
    const a = { ...CLIP, audio: 'audio/en/a.m4a' }
    const b = { ...CLIP, audio: 'audio/en/b.m4a' }
    await n.prefetch([a, b])
    expect(n.decodedCount).toBe(2)
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2)
    await n.prefetch([a])                 // already decoded: no second decode
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2)
    await n.play(a)
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2)
    n.evict([a, b])
    expect(n.decodedCount).toBe(0)
  })

  it('ramps the master gain for volume, clamped, rather than an element volume', () => {
    const master = masterGain(ctx)
    n.setVolume(0.5)
    expect(master.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.5, expect.any(Number))
    n.setVolume(4)
    expect(master.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.any(Number))
    n.setVolume(-1)
    expect(master.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.any(Number))
  })

  it('lets the bed back up when the clip it ducked for never plays', async () => {
    await n.ambient('forest')
    const g = n.ambientGainForTest as unknown as FakeGain
    await n.play(CLIP)
    const ducked = g.gain.linearRampToValueAtTime.mock.calls.at(-1)![0]
    ctx.decodeAudioData = vi.fn(async () => { throw new Error('EncodingError') })
    await n.play({ ...CLIP, audio: 'audio/en/broken.m4a' })
    expect(n.playing).toBe(false)
    // Nothing is speaking, so nothing may be ducking.
    expect(g.gain.linearRampToValueAtTime.mock.calls.at(-1)![0]).toBeGreaterThan(ducked)
  })

  it('holds the bed steady across consecutive clips instead of pumping', async () => {
    vi.useFakeTimers()
    try {
      await n.ambient('forest')
      const g = n.ambientGainForTest as unknown as FakeGain
      const ramps = g.gain.linearRampToValueAtTime
      await n.play(CLIP)
      const ducked = ramps.mock.calls.at(-1)![0]
      const settledAt = ramps.mock.calls.length

      // Three tour beats back to back, each ending naturally.
      for (const id of ['b', 'c', 'd']) {
        ctx.advance(10)
        endNaturally(ctx)
        await n.play({ ...CLIP, audio: `audio/en/${id}.m4a` })
      }
      const between = ramps.mock.calls.slice(settledAt).map((c) => c[0] as number)
      expect(Math.max(0, ...between)).toBeLessThanOrEqual(ducked)

      // ...but a real silence does get its birdsong back.
      ctx.advance(10)
      endNaturally(ctx)
      await vi.advanceTimersByTimeAsync(2000)
      expect(ramps.mock.calls.at(-1)![0]).toBeGreaterThan(ducked)
    } finally {
      vi.useRealTimers()
    }
  })

  it('has no current word once it is stopped', async () => {
    await n.play(CLIP)
    expect(n.getSnapshot()).toBe(0)
    n.stop()
    expect(n.getSnapshot()).toBe(-1)
    expect(n.playing).toBe(false)
  })
})
