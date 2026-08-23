import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { act, render } from '@testing-library/react'
import type { Clip } from '../types'

/**
 * TASK 5: A HOLD RUNS ON THE MEDIA CLOCK, NOT THE WALL CLOCK.
 *
 * `Reveal.tsx` used to schedule how long a picture stays up with a plain
 * `setTimeout(hold)`, in wall-clock milliseconds — while the CUE that puts
 * the picture up in the first place fires off `Narrator`'s media clock:
 * rate-scaled, and frozen across a pause. The two clocks agree only at rate
 * 1 with nothing ever paused, which is exactly why the bug shipped
 * invisibly: every pre-existing test in `effects/` either renders `Reveal`
 * on its own (no narrator anywhere in the loop) or exercises the real tour
 * only at the default rate.
 *
 * So this is the first test to run the REAL `Narrator` — a fake
 * `AudioContext`, not a double, the same reasoning
 * `GrandTour.controls.test.tsx` gives for its own fake-context tests: a
 * mocked engine cannot fail in the shape this bug needs — through the REAL
 * `TourStage`, so a hold is timed by the one clock a parent's "slower" and
 * "pause" buttons actually touch.
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

/** The same fake `AudioContext` *class* shape `Narrator.test.ts` and
 *  `GrandTour.controls.test.tsx` already use — a constructor, because
 *  `getNarrator()` does `new AC({...})`. */
function fakeAudioContextClass(): { Ctor: new (opts?: unknown) => FakeCtx; instance: () => FakeCtx } {
  let created: FakeCtx | null = null
  function Ctor(this: FakeCtx) {
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
    Object.defineProperty(this, 'currentTime', { get: () => now })
    this.advance = (dt: number) => { now += dt }
    this.state = 'running'
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
    this.decodeAudioData = vi.fn(async () => ({ duration: 5 }))
    this.addEventListener = vi.fn()
    this.removeEventListener = vi.fn()
    created = this
  }
  return {
    Ctor: Ctor as unknown as new (opts?: unknown) => FakeCtx,
    instance: () => {
      if (!created) throw new Error('AudioContext was never constructed — mount TourStage and play() first')
      return created
    },
  }
}

/** One cue, one card, five nominal seconds of hold — small enough to
 *  hand-drive a rate and a pause through by exact numbers. `hold` equals
 *  `duration`: the picture is authored to last exactly as long as the clip,
 *  the same shape a real beat's derived hold takes. */
const CLIP: Clip = {
  audio: 'audio/en/x.m4a',
  duration: 5,
  words: ['one'],
  starts: [0],
  ends: [5],
  cues: [{ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger', hold: 5000 }],
}

async function freshTourStage() {
  const { Ctor, instance } = fakeAudioContextClass()
  vi.stubGlobal('AudioContext', Ctor)
  vi.resetModules()
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch
  const [{ TourStage }, { getNarrator }] = await Promise.all([
    import('./TourStage'),
    import('../audio/Narrator'),
  ])
  return { TourStage, getNarrator, instance }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

/** Still on stage: `Reveal`'s own `.cue-figure`/`.cue-layer`, not merely the
 *  `overlays.tsx` wrapper div, which stays mounted throughout — the same
 *  helper `overlays.test.tsx` uses. */
const stillUp = (container: HTMLElement) => container.querySelector('.cue-figure, .cue-layer') !== null

describe('a hold runs on the media clock, not the wall clock', () => {
  it('keeps the picture up through the moment old code would already have removed it, at a slower rate', async () => {
    vi.useFakeTimers()
    try {
      const { TourStage, getNarrator, instance } = await freshTourStage()
      const n = getNarrator()
      const { container } = render(<TourStage />)

      await act(async () => { await n.play(CLIP) })
      n.setRate(0.85)
      const ctx = instance()

      // The cue fires at t=0, so the picture is up immediately.
      expect(stillUp(container)).toBe(true)

      // 5500 REAL/wall milliseconds pass. The OLD `setTimeout(hold)` read
      // its 5000ms hold as wall time regardless of rate, so it would have
      // taken the picture down — and, 450ms of fade later, fully off stage —
      // well before this point. At rate 0.85 those same 5500 wall ms are
      // only 4.675 nominal seconds — short of the 5-second hold — so the
      // fix must still show it up.
      act(() => {
        ctx.advance((5500 / 1000) * 0.85)
        n.tick()
        vi.advanceTimersByTime(5500)
      })
      expect(stillUp(container)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('freezes the hold across a pause, rather than letting a stopped clock use it up', async () => {
    vi.useFakeTimers()
    try {
      const { TourStage, getNarrator, instance } = await freshTourStage()
      const n = getNarrator()
      const { container } = render(<TourStage />)

      await act(async () => { await n.play(CLIP) })
      const ctx = instance()

      // Two of the picture's own five nominal seconds have played.
      act(() => { ctx.advance(2); n.tick(); vi.advanceTimersByTime(2000) })
      expect(stillUp(container)).toBe(true)

      act(() => { n.pause() })

      // Thirty real/wall seconds pass with nothing playing — long past
      // where the OLD wall-clock `setTimeout(hold)` would have fired
      // regardless of pause. Nothing here advances `ctx` or calls `tick()`:
      // that is the point — a paused engine's own media clock does not
      // move no matter how much wall time passes, and nothing is polling
      // it to find out.
      act(() => { vi.advanceTimersByTime(30_000) })
      expect(stillUp(container)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
