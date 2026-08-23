import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GrandTour, comesHome, stageHold } from './GrandTour'
import { parked, clearPark } from './tourPosition'
import { HOLD, FADE_MS } from './effects/Reveal'
import { isTracing, setTracing } from './effects/tracing'
import tour from '../../content/tour.json'
import timings from '../data/timings.json'
import geo from '../data/geo.json'
import type { Bbox, Clip, Cue } from '../types'

/**
 * THE DOUBLE IS FAITHFUL TO THE REAL ENGINE, and on this task that is not a
 * formality — it is the difference between a tour that runs and a tour that
 * stops dead on beat four in front of a child.
 *
 * Three things about `Narrator` shape everything the sequencer does, and a
 * double that got any of them wrong would let the production code be built
 * around the gap (the plan-wide rule Task 4 paid for):
 *
 *  1. `play()` resolves when the clip STARTS, not when it ends. The advance
 *     signal is `onEnd`, which fires only on a natural end — never on
 *     `stop()`, never on `pause()`.
 *  2. A clip whose audio file 404s does NOT reject. `play()` catches it,
 *     degrades to silence, resolves, and `onEnd` never comes. That beat would
 *     hang the tour for ever, so the double models it (`silentOn`) as well as
 *     the outright throw the brief asked for (`failOn`).
 *  3. Cues arrive through `onCue`, off the audio clock, WHILE the clip plays
 *     — one at a time, in order, exactly once each.
 *
 * The rest of the surface is here because something GrandTour renders reads
 * it: `subscribe`/`playing` for Mor, `subscribe`/`getSnapshot` for ReadAlong,
 * `pause`/`resume`/`replay`/`setRate`/`setVolume`/`stuck`/`resumeContext` for
 * the control bar, `sfx` for TourStage's cue api.
 */
const played: string[] = []
const dispatched: string[] = []
const prefetched: string[] = []
const evicted: string[] = []

/** A clip whose audio rejects outright. */
let failOn: string | null = null
/** A clip whose audio 404s: play() resolves, nothing sounds, onEnd never comes. */
let silentOn: string | null = null
/**
 * Whether a clip runs to its end by itself.
 *
 * A real beat lasts eleven seconds, so anything that wants to look at the
 * tour WHILE a beat is playing turns this off and ends the clip by hand.
 * Left on, the fourteen beats run back to back in fourteen macrotasks, which
 * is what makes the whole-tour tests take milliseconds instead of 2:41.
 */
let autoEnd = true

let listeners: (() => void)[] = []
let ending: ReturnType<typeof setTimeout> | null = null

const narrator = {
  playing: false,
  stuck: false,
  /** What `getSnapshot` hands back: the word being spoken, or -1. */
  word: -1,
  onCue: (() => {}) as (cue: Cue) => void,
  onEnd: null as (() => void) | null,

  play: vi.fn(async (clip: Clip) => {
    narrator.cut()
    narrator.playing = false
    if (failOn && clip.audio.includes(failOn)) throw new Error('404')
    played.push(clip.audio)
    // The 404 path: silence, and no end. See (2) above.
    if (silentOn && clip.audio.includes(silentOn)) {
      narrator.emit()
      return
    }
    narrator.playing = true
    narrator.emit()
    narrator.current = clip
    if (autoEnd) narrator.run(clip)
  }),

  /** The clip currently in the engine, the way the real one holds it. */
  current: null as Clip | null,

  /** The clip's own lifetime, compressed into one macrotask: its cues fire in
   *  order while it plays, then it ends. A macrotask and not a microtask,
   *  because the real engine cannot possibly end a clip before `play()`'s own
   *  promise has resolved, and the sequencer checks `playing` on that line. */
  run(clip: Clip) {
    ending = setTimeout(() => {
      ending = null
      for (const cue of clip.cues) narrator.onCue(cue)
      narrator.playing = false
      narrator.word = -1
      narrator.emit()
      narrator.onEnd?.()
    }, 0)
  },

  cut() {
    if (ending) clearTimeout(ending)
    ending = null
  },

  /** Run the current clip out to its natural end, now. What the audio clock
   *  would do eleven seconds later. */
  finish() {
    const clip = narrator.current
    if (!clip) return
    narrator.cut()
    for (const cue of clip.cues) narrator.onCue(cue)
    narrator.playing = false
    narrator.word = -1
    narrator.emit()
    narrator.onEnd?.()
  },

  pause: vi.fn(() => { narrator.playing = false; narrator.cut(); narrator.emit() }),
  resume: vi.fn(() => { narrator.playing = true; narrator.emit() }),
  replay: vi.fn(),
  // stop() never fires onEnd — that is the whole reason abandoning the tour
  // does not advance it.
  stop: vi.fn(() => { narrator.playing = false; narrator.cut(); narrator.word = -1; narrator.emit() }),
  prefetch: vi.fn(async (clips: Clip[]) => { for (const c of clips) prefetched.push(c.audio) }),
  evict: vi.fn((clips: Clip[]) => { for (const c of clips) evicted.push(c.audio) }),
  sfx: vi.fn(async () => {}),
  ambient: vi.fn(async () => {}),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  resumeContext: vi.fn(async () => true),
  subscribe: (fn: () => void) => {
    listeners.push(fn)
    return () => { listeners = listeners.filter((l) => l !== fn) }
  },
  getSnapshot: () => narrator.word,
  emit: () => { for (const fn of [...listeners]) fn() },
}

vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))
vi.mock('./cues', () => ({
  dispatch: (cue: { do: string }) => dispatched.push(cue.do),
  CUES: {},
}))

beforeEach(() => {
  played.length = 0
  dispatched.length = 0
  prefetched.length = 0
  evicted.length = 0
  failOn = null
  silentOn = null
  narrator.cut()
  autoEnd = true
  narrator.current = null
  narrator.playing = false
  narrator.word = -1
  narrator.onEnd = null
  narrator.onCue = () => {}
  listeners = []
  vi.clearAllMocks()
  // tourPosition is module-scoped on purpose (GrandTour.tsx explains why:
  // it has to outlive the component it is parking for). That means it also
  // outlives any one test in this file unless something clears it here.
  clearPark()
  // Same reasoning: `tracing.ts`'s published value is module-scoped too.
  setTracing(false)
})

afterEach(() => { narrator.cut() })

const ids = tour.beats.map((b: { id: string }) => b.id)
const CLIPS = timings as unknown as Record<string, Clip>
const idOf = (audio: string) => audio.replace(/.*\/(.*)\.m4a/, '$1')

const mount = (props: Record<string, unknown> = {}) => render(<GrandTour {...props} />)

const whole = { timeout: 4000 }

/**
 * Plan 4 / Task 3: tour.02 (beat index 1) is now authored with an invite —
 * the real tour holds it open for up to 25 real seconds after its audio
 * ends, waiting for a finger that these whole-tour tests never provide.
 * Fake timers, armed BEFORE beat 2's `onEnd` fires (so the dwell timer's own
 * `setTimeout` calls are the ones being faked, not real ones already
 * ticking in the background — switching timer implementations does not
 * retroactively convert an already-scheduled real timer), let this skip
 * straight past the wait rather than a test actually waiting up to 25
 * seconds. `shouldAdvanceTime: true` keeps real-time-dependent work — this
 * file's own `waitFor` polling, and `userEvent`'s internal delays — working
 * exactly as it does under real timers.
 *
 * The wait itself — the floor, the extension while tracing, the hard cap,
 * and every path that must clear it — has its own dedicated tests below
 * ("the invitation waits"); this helper exists so every OTHER test in this
 * file can treat beat 2 as "a beat like any other" again.
 */
const skipTour02Invite = async () => {
  await waitFor(() => expect(played.length).toBeGreaterThanOrEqual(2))
  await act(async () => { vi.advanceTimersByTime(25000) })
}

describe('GrandTour', () => {
  it('plays all fourteen beats in the authored order', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true })
      await skipTour02Invite()
      await waitFor(() => expect(played).toHaveLength(ids.length), whole)
      expect(played.map(idOf)).toEqual(ids)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for the beat to END before starting the next one', async () => {
    // The engine resolves play() when the clip STARTS. A sequencer that
    // advanced on that promise would fire all fourteen beats in one tick and
    // the child would hear the last one over the first thirteen.
    autoEnd = false
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(played).toHaveLength(1)
    await act(async () => { narrator.finish() })
    await waitFor(() => expect(played).toHaveLength(2))
  })

  it('dispatches each cue exactly once, as it fires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true })
      await skipTour02Invite()
      await waitFor(() => expect(played).toHaveLength(ids.length), whole)
      const authored = tour.beats.flatMap((b: { cues?: { do: string }[] }) => b.cues ?? [])
      // tour.07 carries revealSymbol then playSfx; neither may double-fire.
      expect(dispatched.filter((d) => d === 'playSfx'))
        .toHaveLength(authored.filter((c) => c.do === 'playSfx').length)
      expect(dispatched).toHaveLength(authored.length)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a tap on a state leave the tour at once — the offer is never a cage', async () => {
    autoEnd = false
    const onPick = vi.fn()
    mount({ autoStart: true, onPickState: onPick })
    await waitFor(() => expect(played).toHaveLength(1))
    await userEvent.click(await screen.findByTestId('state-rajasthan'))
    expect(onPick).toHaveBeenCalledWith('rajasthan')
    expect(narrator.stop).toHaveBeenCalled()
  })

  it('does not carry on to the next beat by itself once a tap has left it', async () => {
    autoEnd = false
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    await userEvent.click(await screen.findByTestId('state-rajasthan'))
    // stop() is not a natural end, so nothing may advance on its own — and if
    // the sequencer had left its onEnd hooked up, finishing the abandoned
    // clip would prove it. "Carry on" resuming the beat is a deliberate tap
    // on the button, tested separately below; this is what must NOT happen
    // by itself.
    await act(async () => { narrator.finish() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(played).toHaveLength(1)
  })

  /**
   * LEAVING IS NOT FORGETTING. A tap still ends the tour at once — nothing
   * below relitigates that — but a child touches the map because that is
   * what a map is *for*, and the tour used to punish exactly that instinct
   * by discarding up to four minutes of narration the child had already sat
   * through: coming back from a tapped-away beat 8 restarted at beat 1. The
   * offer stands even after it is taken: the beat that was in the air is
   * parked (`tourPosition.ts`) and "Carry on" — a third label beside "Show
   * me India" and "Show me again" — picks it back up from its first word.
   */
  describe('a tap leaves, and the tour remembers where it was', () => {
    it('offers "Carry on" instead of the top, once a tap has left the tour', async () => {
      autoEnd = false
      mount({ autoStart: true })
      await waitFor(() => expect(played).toHaveLength(1))
      await userEvent.click(await screen.findByTestId('state-rajasthan'))
      expect(await screen.findByRole('button', { name: /carry on/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /show me india/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /show me again/i })).not.toBeInTheDocument()
    })

    it("resumes the tapped-away beat from the bar's Play button, not from the top", async () => {
      autoEnd = false
      mount({ autoStart: true })
      await waitFor(() => expect(played).toHaveLength(1))
      // Move on to beat 1 first, so "resumes beat 0" could not pass this by
      // accident the way it would if the tap landed on the very first beat.
      await act(async () => { narrator.finish() })
      await waitFor(() => expect(played).toHaveLength(2))
      await userEvent.click(await screen.findByTestId('state-rajasthan'))
      expect(played).toHaveLength(2)
      await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
      await waitFor(() => expect(played).toHaveLength(3))
      expect(idOf(played[2])).toBe(ids[1])
    })

    it('resumes the tapped-away beat from "Carry on" too, from its first word', async () => {
      autoEnd = false
      mount({ autoStart: true })
      await waitFor(() => expect(played).toHaveLength(1))
      await act(async () => { narrator.finish() })
      await waitFor(() => expect(played).toHaveLength(2))
      await userEvent.click(await screen.findByTestId('state-rajasthan'))
      await userEvent.click(await screen.findByRole('button', { name: /carry on/i }))
      await waitFor(() => expect(played).toHaveLength(3))
      expect(idOf(played[2])).toBe(ids[1])
      // Not mid-sentence: a fresh play() from the top of the same clip.
      expect(narrator.play).toHaveBeenLastCalledWith(CLIPS[ids[1]])
    })

    it('remembers the beat across a full unmount and remount — the credits round trip', async () => {
      // The credits link at the bottom of the map (`MapStage.tsx`'s
      // `.credit__more`) changes the route, which unmounts this component,
      // and `Credits.tsx`'s "Back to the map" mounts a brand new one. Nothing
      // about that round trip is exercised here — this is the same unmount
      // GrandTour itself goes through either way, which is exactly why
      // parking on unmount (rather than only in `pick`) is what fixes it.
      autoEnd = false
      const { unmount } = mount({ autoStart: true })
      await waitFor(() => expect(played).toHaveLength(1))
      await act(async () => { narrator.finish() })
      await waitFor(() => expect(played).toHaveLength(2))
      unmount()
      expect(parked()).toBe(1)

      mount({})
      const carryOn = await screen.findByRole('button', { name: /carry on/i })
      await userEvent.click(carryOn)
      await waitFor(() => expect(played).toHaveLength(3))
      expect(idOf(played[2])).toBe(ids[1])
    })

    it('clears the remembered beat when the child goes home', async () => {
      autoEnd = false
      mount({ autoStart: true })
      await waitFor(() => expect(played).toHaveLength(1))
      await userEvent.click(await screen.findByTestId('state-rajasthan'))
      expect(await screen.findByRole('button', { name: /carry on/i })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /home/i }))
      // Home is documented as the beginning, not "wherever I left off".
      expect(screen.getByRole('button', { name: /show me india/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /carry on/i })).not.toBeInTheDocument()
      expect(parked()).toBeNull()
    })

    it('clears the remembered beat once the tour finishes on its own', async () => {
      autoEnd = false
      mount({ autoStart: true })
      await waitFor(() => expect(played).toHaveLength(1))
      await userEvent.click(await screen.findByTestId('state-rajasthan'))
      expect(await screen.findByRole('button', { name: /carry on/i })).toBeInTheDocument()
      autoEnd = true
      // "Carry on" resumes beat 0, so the rest of this pass runs straight
      // through beat 2's invite — fake timers from here on, after the
      // click, so `userEvent` itself still runs against a real clock.
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await userEvent.click(screen.getByRole('button', { name: /carry on/i }))
        await skipTour02Invite()
        await waitFor(
          () => expect(screen.getByRole('button', { name: /show me again/i })).toBeInTheDocument(),
          whole,
        )
      } finally {
        vi.useRealTimers()
      }
      expect(screen.queryByRole('button', { name: /carry on/i })).not.toBeInTheDocument()
      expect(parked()).toBeNull()
    }, 6000)
  })

  it('replays only the current beat, not the whole tour', async () => {
    autoEnd = false
    mount({ autoStart: true })
    await waitFor(() => expect(played.length).toBeGreaterThan(0))
    const soFar = played.length
    await userEvent.click(screen.getByRole('button', { name: /again/i }))
    expect(narrator.replay).toHaveBeenCalledOnce()
    expect(played.length).toBe(soFar)
  })

  it('prefetches the next beat while the current one plays', async () => {
    mount({ autoStart: true })
    await waitFor(() => expect(narrator.prefetch).toHaveBeenCalled())
    const asked = narrator.prefetch.mock.calls[0][0] as Clip[]
    expect(asked[0].audio).toContain(ids[1])
  })

  it('evicts the beat before last, so at most a handful of clips stay decoded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true })
      await skipTour02Invite()
      await waitFor(() => expect(played).toHaveLength(ids.length), whole)
      // Every beat but the last one is dropped once the tour has moved past it.
      expect(evicted.map(idOf)).toEqual(ids.slice(0, -1))
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers to play again when it reaches the end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true })
      await skipTour02Invite()
      await waitFor(
        () => expect(screen.getByRole('button', { name: /show me again/i })).toBeInTheDocument(),
        whole,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('shimmers the whole map once at the end, then leaves it calm', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let container: HTMLElement
    try {
      ;({ container } = mount({ autoStart: true }))
      await skipTour02Invite()
      await waitFor(
        () => expect(screen.getByRole('button', { name: /show me again/i })).toBeInTheDocument(),
        whole,
      )
      // The wave is staggered; its first place lands in the same tick.
      expect(container.querySelector('.base path.lit')).toBeTruthy()
      await waitFor(() => expect(container.querySelector('.base path.lit')).toBeNull(), { timeout: 6000 })
    } finally {
      vi.useRealTimers()
    }
  }, 12000)

  it('skips a beat whose audio rejects rather than stranding the child', async () => {
    failOn = ids[3]
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true })
      await skipTour02Invite()
      await waitFor(() => expect(played).toHaveLength(ids.length - 1), whole)
      expect(played.some((a) => a.includes(ids[4]))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a beat whose audio 404s — which the engine reports as silence, not an error', async () => {
    // The real failure mode: Narrator.play() resolves, plays nothing, and
    // never fires onEnd. Waiting for an end that cannot come would leave the
    // child looking at a map that stopped talking.
    silentOn = ids[3]
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true })
      await skipTour02Invite()
      await waitFor(() => expect(played).toHaveLength(ids.length), whole)
      expect(played.map(idOf)).toEqual(ids)
    } finally {
      vi.useRealTimers()
    }
  })

  it('makes the bar\'s play button start the tour when nothing is playing', async () => {
    // It used to call `Narrator.resume()`, which returns early with no
    // buffer — a 104px target labelled "Play" that did nothing, next to a
    // working one labelled "Show me again".
    autoEnd = false
    mount()
    expect(played).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
    await waitFor(() => expect(played.map(idOf)).toEqual([ids[0]]))
  })

  it('pauses and resumes the beat in the air, rather than starting over', async () => {
    autoEnd = false
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(narrator.pause).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
    expect(narrator.resume).toHaveBeenCalledOnce()
    expect(played).toHaveLength(1)
  })

  it('plays it all again from the bar once the tour has finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true })
      await skipTour02Invite()
      await waitFor(
        () => expect(screen.getByRole('button', { name: /show me again/i })).toBeInTheDocument(),
        whole,
      )
      const soFar = played.length
      autoEnd = false
      await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
      await waitFor(() => expect(played.length).toBe(soFar + 1))
      expect(idOf(played[played.length - 1])).toBe(ids[0])
    } finally {
      vi.useRealTimers()
    }
  }, 12000)

  it('goes home: stops the tour and puts the big button back', async () => {
    autoEnd = false
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /show me/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /home/i }))
    expect(narrator.stop).toHaveBeenCalled()
    // The beginning, not "again" — home is where the child came in.
    expect(screen.getByRole('button', { name: /show me india/i })).toBeInTheDocument()
    // And it stays stopped: finishing the abandoned clip must not advance it.
    await act(async () => { narrator.finish() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(played).toHaveLength(1)
  })

  it('goes quiet when the screen is left, rather than talking to nobody', async () => {
    // There is somewhere else to go now: the credits page hangs off the map's
    // licence line. The engine is module-scoped and outlives this component,
    // so unmounting alone would leave the beat playing on the next screen.
    autoEnd = false
    const { unmount } = mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    expect(narrator.stop).not.toHaveBeenCalled()
    unmount()
    expect(narrator.stop).toHaveBeenCalled()
  })

  it('starts on the big button, which carries a word and a child-sized target', async () => {
    autoEnd = false
    mount()
    const play = screen.getByRole('button', { name: /show me india/i })
    expect(play.className).toContain('tap')
    expect(played).toHaveLength(0)
    await userEvent.click(play)
    await waitFor(() => expect(played.map(idOf)).toEqual([ids[0]]))
    // While the tour is running the big button is out of the way; the bar's
    // own play/pause is what a child uses.
    expect(screen.queryByRole('button', { name: /show me/i })).not.toBeInTheDocument()
  })

  it('lights up the words of the beat being spoken', async () => {
    autoEnd = false
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    const first = CLIPS[ids[0]]
    expect(screen.getByText(first.words[0])).toBeInTheDocument()
    await act(async () => { narrator.word = 3; narrator.emit() })
    const lit = document.querySelectorAll('.word[data-current]')
    expect(lit).toHaveLength(1)
    expect(lit[0].textContent).toBe(first.words[3])
  })
})

/**
 * Plan 4 / Task 3: "it did not give any time to trace which the lady
 * mentions and switches quickly to next." tour.02 (beat index 1, `ids[1]`)
 * is authored with `invite: { gesture: 'trace', min: 6, max: 25 }`
 * (content/tour.json) — the tour now waits at least the floor, longer for
 * as long as a finger is on the trace corridor, and never past the cap.
 *
 * Every test here runs under fake timers, armed BEFORE the invite opens —
 * switching timer implementations does not retroactively convert an
 * already-scheduled real timer, so `reachInvite` (which fires tour.02's
 * `onEnd`) must run AFTER `vi.useFakeTimers()`, not before.
 */
describe('the invitation waits', () => {
  /** Play tour.01 to its end, then tour.02 to its end — landing exactly on
   *  the moment `handleEnd` (GrandTour.tsx) either advances at once (no
   *  invite) or arms the dwell timer (tour.02 has one). Requires fake
   *  timers already active and `autoEnd = false`, set by each test. */
  const reachInvite = async () => {
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    await act(async () => { narrator.finish() })
    await waitFor(() => expect(played).toHaveLength(2))
    expect(idOf(played[1])).toBe(ids[1])
    await act(async () => { narrator.finish() }) // tour.02's own audio ends
  }

  it("does not advance the instant tour.02's audio ends — the 41ms bug this task fixes", async () => {
    autoEnd = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await reachInvite()
      await act(async () => { await Promise.resolve() })
      expect(played).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds for at least the authored floor (6s) when nobody ever touches the map', async () => {
    autoEnd = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await reachInvite()
      await act(async () => { vi.advanceTimersByTime(5900) })
      expect(played).toHaveLength(2) // still short of the 6s floor
      await act(async () => { vi.advanceTimersByTime(200) })
      await waitFor(() => expect(played).toHaveLength(3))
      expect(idOf(played[2])).toBe(ids[2])
    } finally {
      vi.useRealTimers()
    }
  })

  it('extends the wait for as long as a finger stays on the corridor, past the floor', async () => {
    autoEnd = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await reachInvite()
      act(() => setTracing(true))
      // Well past the 6s floor, finger still down: must not have advanced.
      await act(async () => { vi.advanceTimersByTime(15000) })
      expect(played).toHaveLength(2)
      act(() => setTracing(false))
      // Not settled yet — under SETTLE_MS (2.5s) since the lift.
      await act(async () => { vi.advanceTimersByTime(2400) })
      expect(played).toHaveLength(2)
      await act(async () => { vi.advanceTimersByTime(200) })
      await waitFor(() => expect(played).toHaveLength(3))
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-arms the settle window on every new touch, not only the first lift', async () => {
    autoEnd = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await reachInvite()
      act(() => setTracing(true))
      await act(async () => { vi.advanceTimersByTime(7000) }) // past the floor
      act(() => setTracing(false))
      await act(async () => { vi.advanceTimersByTime(1500) }) // partway to settling
      // A second touch before the corridor ever went quiet for the full
      // window: the settle must restart, not merely continue.
      act(() => setTracing(true))
      await act(async () => { vi.advanceTimersByTime(3000) })
      act(() => setTracing(false))
      await act(async () => { vi.advanceTimersByTime(2400) })
      expect(played).toHaveLength(2) // still under 2.5s since the SECOND lift
      await act(async () => { vi.advanceTimersByTime(200) })
      await waitFor(() => expect(played).toHaveLength(3))
    } finally {
      vi.useRealTimers()
    }
  })

  it('never waits past the hard cap (25s), however long a finger stays down', async () => {
    autoEnd = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await reachInvite()
      act(() => setTracing(true))
      await act(async () => { vi.advanceTimersByTime(24900) })
      expect(played).toHaveLength(2) // just short of the cap
      await act(async () => { vi.advanceTimersByTime(200) })
      await waitFor(() => expect(played).toHaveLength(3))
      // Cleanup: the double never fires an "up" for this synthetic gesture.
      act(() => setTracing(false))
    } finally {
      vi.useRealTimers()
    }
  })

  it('disarms the map for the duration of the invite — a tap neither picks nor disturbs the wait', async () => {
    autoEnd = false
    const onPick = vi.fn()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ autoStart: true, onPickState: onPick })
      await waitFor(() => expect(played).toHaveLength(1))
      await act(async () => { narrator.finish() })
      await waitFor(() => expect(played).toHaveLength(2))
      await act(async () => { narrator.finish() })

      const kerala = await screen.findByTestId('state-kerala')
      await act(async () => {
        kerala.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }),
        )
        kerala.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }),
        )
      })
      expect(onPick).not.toHaveBeenCalled()
      expect(played).toHaveLength(2) // `at` is untouched — still on tour.02
      expect(narrator.stop).not.toHaveBeenCalled()

      // The wait itself is undisturbed by the tap and still completes on
      // its own ordinary schedule.
      await act(async () => { vi.advanceTimersByTime(25000) })
      await waitFor(() => expect(played).toHaveLength(3))
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * "No pending advance timer survives pick, home, pause, replay or
   * unmount." Each of these abandons whatever wait is open WITHOUT running
   * its `advance` — verified by clearing fake timers well past the 25s hard
   * cap afterward and confirming nothing further plays. `pick` itself is
   * not exercised here: it is unreachable through the map while an invite
   * is open (the test just above IS that guarantee), so its own
   * `abandonInvite()` call is defence in depth rather than something a tap
   * can currently trigger mid-wait.
   */
  describe('no pending timer survives an abandoned invite', () => {
    it('via Home', async () => {
      autoEnd = false
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await reachInvite()
        await userEvent.click(screen.getByRole('button', { name: /home/i }))
        await act(async () => { vi.advanceTimersByTime(30000) })
        expect(played).toHaveLength(2)
        expect(screen.getByRole('button', { name: /show me india/i })).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it("via the bar's Play/Pause — which finishes the wait at once rather than leaving a dead button", async () => {
      autoEnd = false
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await reachInvite()
        await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
        // Finishes immediately — no need to wait for the floor or the cap.
        await waitFor(() => expect(played).toHaveLength(3))
        await act(async () => { vi.advanceTimersByTime(30000) })
        // And exactly once — the original floor/settle/cap must not also
        // fire and advance a second time.
        expect(played).toHaveLength(3)
      } finally {
        vi.useRealTimers()
      }
    })

    it('via Say it again — which would otherwise leave the old wait ticking against replayed audio', async () => {
      autoEnd = false
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await reachInvite()
        await userEvent.click(screen.getByRole('button', { name: /again/i }))
        expect(narrator.replay).toHaveBeenCalledOnce()
        await act(async () => { vi.advanceTimersByTime(30000) })
        expect(played).toHaveLength(2) // the double's replay() plays nothing new
      } finally {
        vi.useRealTimers()
      }
    })

    it('via unmount', async () => {
      autoEnd = false
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        const { unmount } = await (async () => {
          const r = render(<GrandTour autoStart />)
          await waitFor(() => expect(played).toHaveLength(1))
          await act(async () => { narrator.finish() })
          await waitFor(() => expect(played).toHaveLength(2))
          await act(async () => { narrator.finish() })
          return r
        })()
        unmount()
        await act(async () => { vi.advanceTimersByTime(30000) })
        expect(played).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('clears whatever the last test left tracing, so this file never leaks between tests', () => {
    // Not a test of GrandTour at all — a guard on the guard: `beforeEach`
    // resets `tracing.ts`'s module-scoped store, and this would be the
    // symptom if it stopped doing that.
    expect(isTracing()).toBe(false)
  })
})

/**
 * Mor's `showing` prop is the one thing the overlay seam cannot give him.
 * Nothing ever clears the overlay slot — `OverlayRenderer` has no `onDone`,
 * deliberately, and every effect dismisses itself — so "the last thing a cue
 * put on stage" would leave him fanned out from beat 2 to the end of the
 * tour. The lifetime has to be computed here, from the same HOLD table the
 * art itself uses.
 */
describe("Mor's showing has a lifetime", () => {
  const state = () => document.querySelector('.mor')?.getAttribute('data-state')

  it('opens his fan when a cue puts art on stage and folds it when the art leaves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount()
      expect(state()).toBe('idle')
      act(() => { narrator.onCue({ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger' }) })
      expect(state()).toBe('showing')
      act(() => { vi.advanceTimersByTime(HOLD.symbol + FADE_MS - 100) })
      expect(state()).toBe('showing')
      act(() => { vi.advanceTimersByTime(200) })
      expect(state()).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fan him out for a cue that puts nothing on stage', () => {
    mount()
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'highlightAllStates' }) })
    expect(state()).toBe('idle')
  })
})

/**
 * "Hold on, we are flying there now. Look down." The flight lands at word 20
 * and India Gate does not rise until word 36 — six seconds during which a
 * child was told to look at a beige field, because at that zoom Delhi's own
 * fill is the same colour as every other state.
 */
describe('the look-down marker', () => {
  const marker = () => document.querySelector('.cue-map circle')

  it('puts something to look at where the camera has just landed', () => {
    mount()
    expect(marker()).toBeNull()
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }) })
    const ring = marker()
    expect(ring).toBeTruthy()
    // In the map's own coordinates, on the middle of the place flown to.
    const delhi = (geo.places as Record<string, { bbox: number[] }>).delhi.bbox
    expect(Number(ring!.getAttribute('cx'))).toBeCloseTo(delhi[0] + delhi[2] / 2, 3)
    expect(Number(ring!.getAttribute('cy'))).toBeCloseTo(delhi[1] + delhi[3] / 2, 3)
  })

  it('does not light the state instead, which at that zoom is a screen full of saffron', () => {
    const { container } = mount()
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }) })
    expect(container.querySelector('[data-slug="delhi"]')?.classList.contains('lit')).toBe(false)
  })

  it('draws nothing for a place nobody has heard of', () => {
    mount()
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'narnia' }) })
    expect(marker()).toBeNull()
  })

  it('takes it away when the child goes home', async () => {
    mount({ autoStart: true })
    act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }) })
    expect(marker()).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /home/i }))
    expect(marker()).toBeNull()
  })

  it('dismisses at the zoomTo cue\'s own derived hold, not the HOLD.here fallback', () => {
    // Task 3: zoomTo is an art verb precisely because this ring is what its
    // derived hold times (the brief's own worked example — beat 5's ring
    // used to die three seconds before India Gate arrived on the same spot).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount()
      act(() => { narrator.onCue({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi', hold: 1000 }) })
      expect(marker()).toBeTruthy()
      // Short of HOLD.here (5600ms) + FADE_MS, but past the given hold.
      act(() => { vi.advanceTimersByTime(1000 + FADE_MS + 50) })
      expect(marker()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('stageHold', () => {
  const hold = (verb: string, arg?: string) => stageHold({ t: 0, word: 0, do: verb, arg })

  it('gives every cue that draws something the same life the drawing has', () => {
    expect(hold('revealSymbol', 'tiger')).toBe(HOLD.symbol)
    expect(hold('revealSymbol', 'outline')).toBe(HOLD.outline)
    expect(hold('revealSymbol', 'bay-of-bengal')).toBe(HOLD.sea)
    expect(hold('unfurlFlag')).toBe(HOLD.flag)
    expect(hold('countTo', '28')).toBe(HOLD.counter)
    expect(hold('traceRiver', 'ganga')).toBe(HOLD.river)
    expect(hold('raiseMountains')).toBe(HOLD.mountains)
    expect(hold('showScript', 'namaste')).toBe(HOLD.script)
  })

  it('gives no life at all to a cue that draws nothing', () => {
    for (const verb of ['playSfx', 'highlightAllStates', 'highlightUnionTerritories', 'zoomTo', 'wobble']) {
      expect(hold(verb)).toBe(0)
    }
  })

  it('prefers the cue\'s own derived hold over the constant, when it has one', () => {
    // Task 3: the constants in Reveal.tsx are a fallback now, not the
    // primary source — a cue's own `hold`, derived from the real audio,
    // wins whenever it is present.
    expect(stageHold({ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger', hold: 14480 })).toBe(14480)
    expect(stageHold({ t: 0, word: 0, do: 'countTo', arg: '28', hold: 1631 })).toBe(1631)
    // Even where the derived hold happens to be shorter than the constant.
    expect(stageHold({ t: 0, word: 0, do: 'showScript', arg: 'namaste', hold: 500 })).toBe(500)
  })

  it('covers every art verb the content actually uses', () => {
    const drawn = new Set(Object.keys({
      revealSymbol: 1, unfurlFlag: 1, countTo: 1, traceRiver: 1, raiseMountains: 1, showScript: 1,
    }))
    for (const beat of tour.beats) {
      for (const cue of (beat as { cues?: { do: string; arg?: string }[] }).cues ?? []) {
        if (drawn.has(cue.do)) expect(hold(cue.do, cue.arg)).toBeGreaterThan(0)
      }
    }
  })
})

/**
 * Beat 5 flies to Delhi and the content has no verb for coming back. Task 8
 * made map-registered art follow the camera, so this is no longer a
 * correctness bug — but beats 10, 11 and 12 are the Ganga, the Himalaya and
 * the three seas, which are the whole country, and a child who was taken
 * somewhere should be brought home again.
 */
describe('comesHome', () => {
  const HOME = geo.viewBox as Bbox
  const DELHI: Bbox = [430, 190, 96, 106]
  const clip = (id: string) => CLIPS[id]

  it('brings the camera home at the start of the beat after the one that flew away', () => {
    expect(comesHome(clip('tour.06'), DELHI)).toBe(true)
  })

  it('does not fly home during the beat that is flying somewhere', () => {
    expect(comesHome(clip('tour.05'), HOME)).toBe(false)
    expect(comesHome(clip('tour.05'), DELHI)).toBe(false)
  })

  it('does not fly home when it is already home', () => {
    expect(comesHome(clip('tour.06'), HOME)).toBe(false)
    expect(comesHome(clip('tour.10'), HOME)).toBe(false)
  })

  it('does nothing at all when there is no map to ask', () => {
    expect(comesHome(clip('tour.06'), null)).toBe(false)
  })
})
