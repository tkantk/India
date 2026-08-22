import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'

/**
 * THE DOUBLE IS FAITHFUL TO THE REAL AudioContext, and here that matters more
 * than usual: `Narrator.test.ts`'s fake context leaves `addEventListener` off
 * (Narrator calls it as `ctx.addEventListener?.(...)`, so the optional chain
 * quietly no-ops) because nothing there needs `statechange` to actually
 * fire. This module's whole job is reading that event's log, so a double
 * that dropped it would let `diagStateChanges` drift untested — exactly the
 * "incomplete double, production code drifts" failure this project already
 * paid for once. So this is a fresh double, modelled on that one's shape,
 * extended with a real listener registry and a `fireStateChange` that flips
 * `state` and notifies the way the browser actually does.
 *
 * `audioDiagnostics()` is deliberately zero-argument (that is the brief's
 * interface) and reaches the engine through the module-scoped
 * `getNarrator()` singleton — so every test that wants an isolated engine
 * resets the module graph and re-imports, rather than constructing a
 * `Narrator` directly the way `Narrator.test.ts` can.
 */
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

type FakeCtx = {
  currentTime: number
  advance(dt: number): void
  state: string
  fireStateChange(next: string): void
  destination: object
  sampleRate: number
  resume: Mock
  createGain: Mock
  createBuffer: Mock
  createBufferSource: Mock
  decodeAudioData: Mock
  addEventListener: Mock
  removeEventListener: Mock
}

/** Builds a fake `AudioContext` *class* (constructor), because
 *  `getNarrator()` does `new AC({...})` — plus a handle on the one instance
 *  it constructs, so a test can drive its clock and fire real events on it
 *  after the engine exists. */
function fakeAudioContextClass(): { Ctor: new (opts?: unknown) => FakeCtx; instance: () => FakeCtx } {
  let created: FakeCtx | null = null

  function Ctor(this: FakeCtx) {
    let now = 0
    let state = 'running'
    const listeners = new Map<string, Set<() => void>>()
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
    Object.defineProperties(this, {
      currentTime: { get: () => now },
      state: { get: () => state, set: (v: string) => { state = v } },
    })
    this.advance = (dt: number) => { now += dt }
    this.fireStateChange = (next: string) => {
      state = next
      for (const fn of listeners.get('statechange') ?? []) fn()
    }
    this.destination = {}
    this.sampleRate = 48000
    this.resume = vi.fn(async () => {})
    this.createGain = vi.fn(gain)
    this.createBuffer = vi.fn(() => ({}))
    this.createBufferSource = vi.fn((): FakeSource => ({
      buffer: null, loop: false, playbackRate: { value: 1 },
      connect: vi.fn(function (this: unknown) { return this }),
      disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null,
    }))
    this.decodeAudioData = vi.fn(async () => ({ duration: 10 }))
    this.addEventListener = vi.fn((type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    })
    this.removeEventListener = vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn)
    })
    created = this
  }

  return {
    Ctor: Ctor as unknown as new (opts?: unknown) => FakeCtx,
    instance: () => {
      if (!created) throw new Error('AudioContext was never constructed — call audioDiagnostics() or getNarrator() first')
      return created
    },
  }
}

/** Stub `window.AudioContext`, reset the module graph, and hand back a
 *  freshly imported `diagnostics` module plus the fake context it will
 *  construct on first use. `getNarrator()`'s engine is module-scoped, so
 *  this is what buys each test its own isolated engine instead of sharing
 *  one across the whole file. */
async function freshDiagnostics() {
  const { Ctor, instance } = fakeAudioContextClass()
  vi.stubGlobal('AudioContext', Ctor)
  vi.resetModules()
  const mod = await import('./diagnostics')
  return { ...mod, instance }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('audioDiagnostics', () => {
  it('returns the full snapshot shape', async () => {
    const { audioDiagnostics } = await freshDiagnostics()
    const snap = audioDiagnostics()

    expect(typeof snap.state).toBe('string')
    expect(typeof snap.currentTime).toBe('number')
    expect(typeof snap.wallDelta).toBe('number')
    expect(typeof snap.clockAdvancing).toBe('boolean')
    expect(Array.isArray(snap.lastStateChanges)).toBe(true)
    expect(snap.lastResumeSettled === null || typeof snap.lastResumeSettled === 'boolean').toBe(true)
    expect(snap.lastResumeMs === null || typeof snap.lastResumeMs === 'number').toBe(true)
    expect(typeof snap.stuck).toBe('boolean')
    expect(typeof snap.playing).toBe('boolean')

    // Nothing has happened yet: no resume attempted, no state changes seen.
    expect(snap.lastResumeSettled).toBeNull()
    expect(snap.lastResumeMs).toBeNull()
    expect(snap.lastStateChanges).toEqual([])
  })

  it('derives clockAdvancing from currentTime versus performance.now(), never from state', async () => {
    const { audioDiagnostics, instance } = await freshDiagnostics()
    const nowSpy = vi.spyOn(performance, 'now')

    // Baseline sample. The context claims to be running throughout — if
    // clockAdvancing ever looked at `state` instead of the clock, it would
    // read true for the rest of this test no matter what the clock does.
    nowSpy.mockReturnValue(0)
    audioDiagnostics()
    expect(instance().state).toBe('running')

    // A full second of wall-clock time passes. The audio clock does not
    // move at all — this is exactly bug 263627/283419's signature.
    nowSpy.mockReturnValue(1200)
    const frozen = audioDiagnostics()
    expect(frozen.state).toBe('running')
    expect(frozen.clockAdvancing).toBe(false)

    // Now the clock actually advances in step with wall time.
    instance().advance(1.2)
    nowSpy.mockReturnValue(2400)
    const healthy = audioDiagnostics()
    expect(healthy.state).toBe('running')
    expect(healthy.clockAdvancing).toBe(true)

    nowSpy.mockRestore()
  })

  it('bounds the state-change log to the last three events', async () => {
    const { audioDiagnostics, instance } = await freshDiagnostics()
    audioDiagnostics() // constructs the engine, wiring up the statechange listener

    for (const s of ['interrupted', 'running', 'interrupted', 'running', 'closed']) {
      instance().fireStateChange(s)
    }

    const { lastStateChanges } = audioDiagnostics()
    expect(lastStateChanges).toHaveLength(3)
    expect(lastStateChanges.map((c) => c.state)).toEqual(['interrupted', 'running', 'closed'])
    // Genuinely bounded, not just happened-to-be-three: one more push and
    // the oldest of these three falls off too.
    instance().fireStateChange('suspended')
    expect(audioDiagnostics().lastStateChanges.map((c) => c.state))
      .toEqual(['running', 'closed', 'suspended'])
  })

  it('reports whether the last resumeContext() settled, and reads null before any attempt', async () => {
    const { audioDiagnostics } = await freshDiagnostics()
    const { getNarrator } = await import('./Narrator')
    const n = getNarrator()

    expect(audioDiagnostics().lastResumeSettled).toBeNull()

    await n.resumeContext()
    const snap = audioDiagnostics()
    expect(snap.lastResumeSettled).toBe(true)
    expect(snap.lastResumeMs).not.toBeNull()
    expect(snap.lastResumeMs).toBeGreaterThanOrEqual(0)
  })
})

describe('AudioDebugPanel', () => {
  it('renders nothing without the debug flag', async () => {
    window.location.hash = '#/'
    const { AudioDebugPanel } = await freshDiagnostics()
    const { container } = render(createElement(AudioDebugPanel))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the hash carries other queries but not debug=audio', async () => {
    window.location.hash = '#/?foo=bar'
    const { AudioDebugPanel } = await freshDiagnostics()
    const { container } = render(createElement(AudioDebugPanel))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a live readout when the hash is #/?debug=audio', async () => {
    window.location.hash = '#/?debug=audio'
    const { AudioDebugPanel } = await freshDiagnostics()
    const { container } = render(createElement(AudioDebugPanel))
    expect(container).not.toBeEmptyDOMElement()
    expect(container.textContent).toMatch(/state/i)
    window.location.hash = ''
  })
})
