import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The frame probe and the media query are both module state that latches, so
 * every test imports a fresh copy of the module.
 */
type Tick = (now: number) => void

/**
 * A faithful stand-in for `requestAnimationFrame`: it hands the callback a
 * DOMHighResTimeStamp and returns a handle, and it fires once per call — the
 * only two things the real one promises. The clock is ours, so a 20 fps
 * device and a 60 fps device differ only in the number we advance it by.
 */
function fakeFrames() {
  const queue: Tick[] = []
  let handle = 0
  let now = 1000 // rAF timestamps start wherever the page started, not at 0
  vi.stubGlobal('requestAnimationFrame', (cb: Tick) => {
    queue.push(cb)
    return ++handle
  })
  return {
    /** Paint `count` frames, each `ms` after the one before it. */
    paint(count: number, ms: number) {
      for (let i = 0; i < count; i++) {
        const cb = queue.shift()
        if (!cb) return
        now += ms
        cb(now)
      }
    },
    /** How many frames the probe is still waiting for. */
    pending: () => queue.length,
  }
}

/** A faithful MediaQueryList: the shape `matchMedia` actually returns. */
function stubReducedMotion(matches: boolean) {
  const asked: string[] = []
  vi.stubGlobal('matchMedia', (media: string) => {
    asked.push(media)
    return {
      media,
      matches: media.includes('prefers-reduced-motion') ? matches : false,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }
  })
  return asked
}

const load = async () => await import('./cheapMode')

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cheap mode', () => {
  it('assumes the hardware is fine until it has actually measured it', async () => {
    const frames = fakeFrames()
    const { isCheap, startFrameProbe } = await load()
    // Downgrading on suspicion would rob every fast iPad of the animation.
    expect(isCheap()).toBe(false)
    startFrameProbe()
    frames.paint(10, 50)
    expect(isCheap(), 'decided before it had watched for two seconds').toBe(false)
  })

  it('measures nothing until the app asks it to', async () => {
    // Otherwise the probe runs under every test that renders the map, and
    // jsdom's own frame clock sits close enough to the threshold that the
    // suite would convict the test machine of being a slow iPad.
    const frames = fakeFrames()
    const { isCheap } = await load()
    isCheap()
    isCheap()
    expect(frames.pending()).toBe(0)
  })

  it('starts watching only once, however often it is asked', async () => {
    const frames = fakeFrames()
    const { startFrameProbe } = await load()
    startFrameProbe()
    startFrameProbe()
    startFrameProbe()
    expect(frames.pending()).toBe(1)
  })

  it('latches cheap on hardware that cannot hold 50 fps', async () => {
    const frames = fakeFrames()
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 50) // 20 fps
    expect(isCheap()).toBe(true)
  })

  it('leaves a 60 fps device alone', async () => {
    const frames = fakeFrames()
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 16.7)
    expect(isCheap()).toBe(false)
  })

  it('diagnostics report "not decided yet" as its own state, not a fast-looking false', async () => {
    const frames = fakeFrames()
    const { cheapModeDiagnostics, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(10, 50) // short of MIN_SAMPLES / PROBE_MS — no verdict yet
    const d = cheapModeDiagnostics()
    expect(d.decided).toBe(false)
    expect(d.cheap).toBe(false)
    expect(d.slow).toBe(false)
    expect(d.medianFrameMs).toBeNull()
  })

  it('diagnostics expose the median frame time behind a latched slow verdict', async () => {
    const frames = fakeFrames()
    const { cheapModeDiagnostics, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 50) // 20 fps, well past SLOW_FRAME_MS
    const d = cheapModeDiagnostics()
    expect(d.decided).toBe(true)
    expect(d.slow).toBe(true)
    expect(d.cheap).toBe(true)
    expect(d.medianFrameMs).toBe(50)
    expect(d.prefersReducedMotion).toBe(false)
  })

  it('diagnostics tell a latched-slow verdict apart from a live reduced-motion one', async () => {
    // Both make isCheap() true, but a device test needs to know which: one
    // is a hardware measurement, the other is a setting a parent can toggle.
    const frames = fakeFrames()
    const asked = stubReducedMotion(true)
    const { cheapModeDiagnostics, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 16.7) // fast hardware
    const d = cheapModeDiagnostics()
    expect(d.cheap).toBe(true)
    expect(d.slow).toBe(false)
    expect(d.prefersReducedMotion).toBe(true)
    expect(asked).toContain('(prefers-reduced-motion: reduce)')
  })

  it('stops sampling the moment it has decided', async () => {
    const frames = fakeFrames()
    const { startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(300, 16.7)
    // A probe that never stops is a rAF loop running under the whole tour.
    expect(frames.pending()).toBe(0)
  })

  it('stays decided: one good stretch cannot undo a slow verdict', async () => {
    const frames = fakeFrames()
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 50)
    expect(isCheap()).toBe(true)
    // Nothing is left to feed, which is the point: the decision is final.
    frames.paint(200, 8)
    expect(isCheap()).toBe(true)
  })

  it('will not decide from a handful of frames', async () => {
    // A backgrounded tab paints rarely. Two seconds of wall clock with five
    // frames in it says nothing about the hardware.
    const frames = fakeFrames()
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(5, 600)
    expect(isCheap()).toBe(false)
    expect(frames.pending(), 'the probe gave up instead of waiting').toBe(1)
  })

  it('is cheap when the child has asked for less motion, whatever the hardware says', async () => {
    const frames = fakeFrames()
    const asked = stubReducedMotion(true)
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 16.7)
    expect(isCheap()).toBe(true)
    expect(asked).toContain('(prefers-reduced-motion: reduce)')
  })

  it('keeps measuring while reduced motion is on, so withdrawing it gives a real answer', async () => {
    // Reduced motion is a setting and can be turned off mid-session. If the
    // probe had bowed out at boot, nothing would ever restart it and the app
    // would go back to the expensive animations without ever having checked
    // whether this iPad can hold them.
    const frames = fakeFrames()
    stubReducedMotion(true)
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    expect(frames.pending(), 'the probe never started').toBe(1)
    frames.paint(200, 50)
    stubReducedMotion(false)
    expect(isCheap(), 'the hardware verdict did not survive the setting').toBe(true)
  })

  it('does not convict a fast iPad on the strength of a backgrounded tab', async () => {
    // rAF is throttled to about 1 Hz in a background tab, and stops entirely
    // in a hidden one. A median of a thousand milliseconds is not a slow
    // device; it is a child who opened another app for a moment.
    const frames = fakeFrames()
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(40, 1000)
    expect(isCheap(), 'latched cheap on a throttled clock').toBe(false)
    // And it heals: the frames that come back are the ones that count.
    frames.paint(200, 16.7)
    expect(isCheap()).toBe(false)
  })

  it('still catches hardware that is genuinely, miserably slow', async () => {
    // 5 fps. The throttle guard must sit well above anything a real device
    // does, or it would throw away the very evidence it exists to collect.
    const frames = fakeFrames()
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 200)
    expect(isCheap()).toBe(true)
  })

  it('honours reduced motion switched on after a fast verdict', async () => {
    const frames = fakeFrames()
    stubReducedMotion(false)
    const { isCheap, startFrameProbe } = await load()
    startFrameProbe()
    frames.paint(200, 16.7)
    expect(isCheap()).toBe(false)
    stubReducedMotion(true)
    // The setting is the child's, not the hardware's: it is read every time.
    expect(isCheap()).toBe(true)
  })

  it('is started by the app at boot, so nothing else has to remember to', () => {
    // The probe measures nothing until somebody starts it, which makes this
    // one line the difference between cheap mode existing and not.
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/startFrameProbe\(\)/)
  })

  it('survives a host with no matchMedia and no frames at all', async () => {
    // The headless probe loads this module in Node, where neither exists.
    vi.stubGlobal('matchMedia', undefined)
    vi.stubGlobal('requestAnimationFrame', undefined)
    const { isCheap, startFrameProbe } = await load()
    expect(() => startFrameProbe()).not.toThrow()
    expect(() => isCheap()).not.toThrow()
    expect(isCheap()).toBe(false)
  })
})
