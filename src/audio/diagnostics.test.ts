import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { formatSnapshot } from './diagnostics'
import type { DiagnosticSnapshot } from './diagnostics'

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

    // isCheap() and why it landed there — Outline.tsx's finger-tracing
    // gesture (and every other art effect gated on `!isCheap()`) simply
    // never mounts if this latches true, so the panel has to answer it.
    expect(typeof snap.cheapMode.cheap).toBe('boolean')
    expect(typeof snap.cheapMode.decided).toBe('boolean')
    expect(typeof snap.cheapMode.slow).toBe('boolean')
    expect(typeof snap.cheapMode.prefersReducedMotion).toBe('boolean')
    expect(snap.cheapMode.medianFrameMs === null || typeof snap.cheapMode.medianFrameMs === 'number').toBe(true)

    expect(typeof snap.state).toBe('string')
    expect(typeof snap.currentTime).toBe('number')
    expect(snap.wallDelta === null || typeof snap.wallDelta === 'number').toBe(true)
    expect(snap.clockAdvancing === null || typeof snap.clockAdvancing === 'boolean').toBe(true)
    expect(Array.isArray(snap.lastStateChanges)).toBe(true)
    expect(snap.lastResumeSettled === null || typeof snap.lastResumeSettled === 'boolean').toBe(true)
    expect(snap.lastResumeMs === null || typeof snap.lastResumeMs === 'number').toBe(true)
    expect(typeof snap.stuck).toBe('boolean')
    expect(typeof snap.playing).toBe('boolean')
    expect(Array.isArray(snap.recentTapRejections)).toBe(true)

    // Nothing has happened yet: no resume attempted, no state changes seen,
    // and — this is the one call in the whole file where it is guaranteed —
    // no sample window has had a chance to close, so the clock reading must
    // not default to a verdict.
    expect(snap.lastResumeSettled).toBeNull()
    expect(snap.lastResumeMs).toBeNull()
    expect(snap.lastStateChanges).toEqual([])
    expect(snap.clockAdvancing).toBeNull()
    expect(snap.wallDelta).toBeNull()
    expect(snap.recentTapRejections).toEqual([])
  })

  it('logs a tap the gesture gate declined, most recent last, capped at the last few', async () => {
    // MapStage never calls this in a unit test — it is exercised directly
    // here, the same way `instance().fireStateChange(...)` stands in for a
    // real browser event a few tests up. The point is what the panel does
    // with the log, not how MapStage produces one entry of it.
    const { audioDiagnostics, recordTapRejection } = await freshDiagnostics()

    recordTapRejection('moved', 34.5, 120)
    let snap = audioDiagnostics()
    expect(snap.recentTapRejections).toHaveLength(1)
    expect(snap.recentTapRejections[0]).toMatchObject({ reason: 'moved', distancePx: 34.5, durationMs: 120 })
    expect(typeof snap.recentTapRejections[0].at).toBe('number')

    recordTapRejection('slow', 3, 1400)
    snap = audioDiagnostics()
    expect(snap.recentTapRejections.map((r) => r.reason)).toEqual(['moved', 'slow'])

    // Bounded, not just happened-to-be-few: nine more and the oldest is
    // gone, the same way `lastStateChanges` is bounded to three above.
    for (let i = 0; i < 9; i++) recordTapRejection('pointer', 0, 0)
    expect(audioDiagnostics().recentTapRejections).toHaveLength(8)
    expect(audioDiagnostics().recentTapRejections[0].reason).toBe('pointer')
  })

  it('reports no verdict before the first sample window closes, then a real one after', async () => {
    const { audioDiagnostics } = await freshDiagnostics()
    const nowSpy = vi.spyOn(performance, 'now')

    // First-ever read: no window has had a chance to close yet. Defaulting
    // this to "advancing" would read as healthy for the entire first second
    // after every mount — precisely the window WebKit bug 273511
    // (interrupted at construction, resume() does nothing) presents in, so a
    // false-healthy reading here would hide the one bug that needs this
    // check most.
    nowSpy.mockReturnValue(0)
    const first = audioDiagnostics()
    expect(first.clockAdvancing).toBeNull()
    expect(first.wallDelta).toBeNull()

    // Still inside the window: the same "no verdict yet" answer, not a
    // stale default sitting in for it.
    nowSpy.mockReturnValue(400)
    const stillWaiting = audioDiagnostics()
    expect(stillWaiting.clockAdvancing).toBeNull()
    expect(stillWaiting.wallDelta).toBeNull()

    // The window closes: now, and only now, a real verdict.
    nowSpy.mockReturnValue(1000)
    const settled = audioDiagnostics()
    expect(settled.clockAdvancing).not.toBeNull()
    expect(settled.wallDelta).not.toBeNull()
    expect(typeof settled.clockAdvancing).toBe('boolean')
    expect(typeof settled.wallDelta).toBe('number')

    nowSpy.mockRestore()
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

/** A full, valid `DiagnosticSnapshot`, overridable per test — the base state
 *  is "nothing has happened yet", the same state `audioDiagnostics()`'s own
 *  first call reports. */
function fakeSnapshot(overrides: Partial<DiagnosticSnapshot> = {}): DiagnosticSnapshot {
  return {
    cheapMode: { cheap: false, decided: false, slow: false, prefersReducedMotion: false, medianFrameMs: null },
    state: 'running',
    currentTime: 0,
    wallDelta: null,
    clockAdvancing: null,
    lastStateChanges: [],
    lastResumeSettled: null,
    lastResumeMs: null,
    stuck: false,
    playing: false,
    recentTapRejections: [],
    ...overrides,
  }
}

describe('formatSnapshot — the isCheap() line', () => {
  it('shows "still probing" rather than a fast-looking verdict before the probe decides', () => {
    const text = formatSnapshot(fakeSnapshot())
    expect(text).toContain('isCheap()     false  (still probing — reducedMotion false)')
  })

  it('shows the latched verdict plus the median frame time once decided', () => {
    const text = formatSnapshot(fakeSnapshot({
      cheapMode: { cheap: true, decided: true, slow: true, prefersReducedMotion: false, medianFrameMs: 33.4 },
    }))
    expect(text).toContain('isCheap()     true  (slow true, medianFrame 33.4ms, reducedMotion false)')
  })

  it('tells a latched slow verdict apart from a live reduced-motion one, both making isCheap() true', () => {
    const text = formatSnapshot(fakeSnapshot({
      cheapMode: { cheap: true, decided: true, slow: false, prefersReducedMotion: true, medianFrameMs: 9.1 },
    }))
    expect(text).toContain('isCheap()     true  (slow false, medianFrame 9.1ms, reducedMotion true)')
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
    expect(container.textContent).toMatch(/isCheap\(\)/)
    expect(container.textContent).toMatch(/state/i)
    expect(container.textContent).toMatch(/rejected taps/i)
    window.location.hash = ''
  })
})
