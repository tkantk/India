import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * THE INVARIANT, PROVED AGAINST THE REAL ENGINE.
 *
 * Every other test of `GrandTour` and `Controls` mocks `Narrator` — right
 * for asking "did the sequencer advance on the right signal," but useless
 * for the bug this task exists to fix: `replay()` bailing on `!this.buffer`
 * was invisible to every one of those doubles, because a `vi.fn()` cannot
 * fail to call itself. `Controls.test.tsx:12` and `GrandTour.test.tsx:120`
 * are now faithful (Step 1 of this task), but "faithful" still means
 * "modelled" — the only test that cannot be fooled by a model with a gap in
 * it is one running the actual `Narrator` class against a fake
 * `AudioContext`, which is what this file does.
 *
 * `fakeAudioContextClass` is the same shape `diagnostics.test.ts` and
 * `Narrator.test.ts` already use — a constructor (`getNarrator()` does
 * `new AC({...})`), because `Narrator` is a real class, not a double, and
 * `vi.resetModules()` + a fresh dynamic `import()` per test is what buys
 * each one its own isolated engine, `tourPosition` and `tracing` module,
 * the same way `diagnostics.test.ts`'s `freshDiagnostics()` does.
 *
 * The scenario is the father's own bug report, played out for real: start
 * the tour, tap a state on the map — a real `pointerdown`/`pointerup` on
 * the real hit layer, exactly as `GrandTour.map.test.tsx` already drives it
 * — which is the exact "stopped, buffer thrown away" state "Say it again"
 * used to answer with zero source nodes, zero fetches, zero emits. Then
 * every other control gets pressed in turn, each assertion reading the
 * REAL engine's own state (`n.playing`, `n.position`, the actual gain and
 * source nodes it created) rather than a mock's call log. That is "no
 * control may be pressable and do nothing" as a single, unmockable test.
 *
 * The test ends at Home on purpose, not merely to exercise it: pressing
 * "Say it again" AFTER a tap must work (the fixed bug), but pressing it
 * AFTER Home must not — Home's own promise is "back to the very
 * beginning," and resurrecting the last beat's audio over that exact idle
 * screen would contradict it. The real `n.canReplay`/`disabled` are what
 * prove the button is honestly unavailable there, not merely unclicked.
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

type FakeGain = {
  gain: {
    value: number
    cancelScheduledValues: Mock
    setValueAtTime: Mock
    linearRampToValueAtTime: Mock
  }
  connect: Mock
  disconnect: Mock
}

type FakeCtx = {
  currentTime: number
  state: string
  destination: object
  sampleRate: number
  resume: Mock
  createGain: Mock
  createBuffer: Mock
  createBufferSource: Mock
  decodeAudioData: Mock
  addEventListener: Mock
  removeEventListener: Mock
  /** Every source node ever created, newest last — the real audio nodes
   *  `startFrom`/`setRate` build, not a mock's recorded arguments. */
  sources: FakeSource[]
  /** Every gain node ever created, in construction order. The engine's own
   *  constructor builds `master` first (`Narrator.ts`), so `gains[0]` is
   *  always the master fader `setVolume` ramps. */
  gains: FakeGain[]
}

/** Builds a fake `AudioContext` *class*, because `getNarrator()` does
 *  `new AC({...})` — plus a handle on the one instance it constructs. */
function fakeAudioContextClass(): { Ctor: new (opts?: unknown) => FakeCtx; instance: () => FakeCtx } {
  let created: FakeCtx | null = null

  function Ctor(this: FakeCtx) {
    const sources: FakeSource[] = []
    const gains: FakeGain[] = []
    const gain = (): FakeGain => {
      const g: FakeGain = {
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(function (this: unknown) { return this }),
        disconnect: vi.fn(),
      }
      gains.push(g)
      return g
    }
    Object.defineProperty(this, 'currentTime', { get: () => 0 })
    this.state = 'running'
    this.destination = {}
    this.sampleRate = 48000
    this.resume = vi.fn(async () => {})
    this.createGain = vi.fn(gain)
    this.createBuffer = vi.fn(() => ({}))
    this.createBufferSource = vi.fn((): FakeSource => {
      const s: FakeSource = {
        buffer: null, loop: false, playbackRate: { value: 1 },
        connect: vi.fn(function (this: unknown) { return this }),
        disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null,
      }
      sources.push(s)
      return s
    })
    this.decodeAudioData = vi.fn(async () => ({ duration: 10 }))
    this.addEventListener = vi.fn()
    this.removeEventListener = vi.fn()
    this.sources = sources
    this.gains = gains
    created = this
  }

  return {
    Ctor: Ctor as unknown as new (opts?: unknown) => FakeCtx,
    instance: () => {
      if (!created) throw new Error('AudioContext was never constructed — mount GrandTour first')
      return created
    },
  }
}

/** Stub `window.AudioContext`, reset the module graph, and hand back a
 *  freshly imported `GrandTour` plus the real `getNarrator()` singleton it
 *  will build on first render — isolated from every other test in the repo
 *  the same way `diagnostics.test.ts`'s `freshDiagnostics()` is. */
async function freshGrandTour() {
  const { Ctor, instance } = fakeAudioContextClass()
  vi.stubGlobal('AudioContext', Ctor)
  vi.resetModules()
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch
  const [{ GrandTour }, { getNarrator }] = await Promise.all([
    import('./GrandTour'),
    import('../audio/Narrator'),
  ])
  return { GrandTour, getNarrator, instance }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

/** A real tap: pointerdown then pointerup, same pointer, same spot — the
 *  gesture `isTap` (`hitLayer.ts`) actually requires, exercised here for
 *  real rather than a bare `click()` the way `GrandTour.map.test.tsx`
 *  already does for the map-lighting tests. */
async function tap(el: Element) {
  await act(async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }))
  })
}

describe('the transport bar answers in every state — the real engine, not a double', () => {
  it('replays after a tap leaves the tour, and every other control still does something too', async () => {
    const { GrandTour, getNarrator, instance } = await freshGrandTour()
    const n = getNarrator()
    render(<GrandTour autoStart />)

    await waitFor(() => expect(n.playing).toBe(true))

    // The father's own bug: a real tap on the map interrupts the beat —
    // `n.stop()` throws the buffer away, `lastClip` is all that is left.
    const kerala = await screen.findByTestId('state-kerala')
    await tap(kerala)
    expect(n.playing).toBe(false)

    // "Say it again" in exactly the state that used to be a hard no-op:
    // zero source nodes, zero fetches, zero emits.
    await userEvent.click(screen.getByRole('button', { name: /again/i }))
    await waitFor(() => expect(n.playing).toBe(true))
    expect(n.position).toBeCloseTo(0, 1)

    // Slower: the node actually playing carries the new rate.
    await userEvent.click(screen.getByRole('button', { name: /slower/i }))
    expect(instance().sources.at(-1)!.playbackRate.value).toBeCloseTo(0.85)
    expect(screen.getByRole('button', { name: /normal speed/i })).toBeInTheDocument()

    // Sound off: the master gain — the first node the engine's own
    // constructor builds — actually ramps to zero.
    const master = instance().gains[0]
    await userEvent.click(screen.getByRole('button', { name: /sound/i }))
    expect(master.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.any(Number))

    // Pause, then Play: the transport really stops and starts, not a label
    // flip with nothing behind it.
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(n.playing).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
    await waitFor(() => expect(n.playing).toBe(true))

    // Home: stops everything for real and puts the big button back — and,
    // per the coordinator's own catch, genuinely forgets what was playing.
    // Home's promise is "back to the very beginning," and a "Say it again"
    // that quietly resurrected the last beat's audio over this exact idle
    // screen — no words lighting up, no visible cause — would contradict
    // that promise rather than honour it. The real engine's own
    // `canReplay` is what the button now reads instead of guessing.
    await userEvent.click(screen.getByRole('button', { name: /home/i }))
    expect(n.playing).toBe(false)
    expect(n.canReplay).toBe(false)
    expect(screen.getByRole('button', { name: /show me india/i })).toBeInTheDocument()
    const again = screen.getByRole('button', { name: /^say it again$/i })
    expect(again).toBeDisabled()
    await userEvent.click(again)
    expect(n.playing).toBe(false)   // disabled: the click could not fire at all
  })
})
