import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GrandTour, comesHome, stageHold } from './GrandTour'
import { HOLD, FADE_MS } from './effects/Reveal'
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
})

afterEach(() => { narrator.cut() })

const ids = tour.beats.map((b: { id: string }) => b.id)
const CLIPS = timings as unknown as Record<string, Clip>
const idOf = (audio: string) => audio.replace(/.*\/(.*)\.m4a/, '$1')

const mount = (props: Record<string, unknown> = {}) => render(<GrandTour {...props} />)

const whole = { timeout: 4000 }

describe('GrandTour', () => {
  it('plays all fourteen beats in the authored order', async () => {
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(ids.length), whole)
    expect(played.map(idOf)).toEqual(ids)
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
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(ids.length), whole)
    const authored = tour.beats.flatMap((b: { cues?: { do: string }[] }) => b.cues ?? [])
    // tour.07 carries revealSymbol then playSfx; neither may double-fire.
    expect(dispatched.filter((d) => d === 'playSfx'))
      .toHaveLength(authored.filter((c) => c.do === 'playSfx').length)
    expect(dispatched).toHaveLength(authored.length)
  })

  it('lets a tap on a state abandon the tour', async () => {
    autoEnd = false
    const onPick = vi.fn()
    mount({ autoStart: true, onPickState: onPick })
    await waitFor(() => expect(played).toHaveLength(1))
    await userEvent.click(await screen.findByTestId('state-rajasthan'))
    expect(onPick).toHaveBeenCalledWith('rajasthan')
    expect(narrator.stop).toHaveBeenCalled()
  })

  it('does not carry on to the next beat after the tour is abandoned', async () => {
    autoEnd = false
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(1))
    await userEvent.click(await screen.findByTestId('state-rajasthan'))
    // stop() is not a natural end, so nothing may advance — and if the
    // sequencer had left its onEnd hooked up, finishing the abandoned clip
    // would prove it.
    await act(async () => { narrator.finish() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(played).toHaveLength(1)
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
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(ids.length), whole)
    // Every beat but the last one is dropped once the tour has moved past it.
    expect(evicted.map(idOf)).toEqual(ids.slice(0, -1))
  })

  it('offers to play again when it reaches the end', async () => {
    mount({ autoStart: true })
    await waitFor(
      () => expect(screen.getByRole('button', { name: /show me again/i })).toBeInTheDocument(),
      whole,
    )
  })

  it('shimmers the whole map once at the end, then leaves it calm', async () => {
    const { container } = mount({ autoStart: true })
    await waitFor(
      () => expect(screen.getByRole('button', { name: /show me again/i })).toBeInTheDocument(),
      whole,
    )
    // The wave is staggered; its first place lands in the same tick.
    expect(container.querySelector('.base path.lit')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.base path.lit')).toBeNull(), { timeout: 6000 })
  }, 12000)

  it('skips a beat whose audio rejects rather than stranding the child', async () => {
    failOn = ids[3]
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(ids.length - 1), whole)
    expect(played.some((a) => a.includes(ids[4]))).toBe(true)
  })

  it('skips a beat whose audio 404s — which the engine reports as silence, not an error', async () => {
    // The real failure mode: Narrator.play() resolves, plays nothing, and
    // never fires onEnd. Waiting for an end that cannot come would leave the
    // child looking at a map that stopped talking.
    silentOn = ids[3]
    mount({ autoStart: true })
    await waitFor(() => expect(played).toHaveLength(ids.length), whole)
    expect(played.map(idOf)).toEqual(ids)
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
    mount({ autoStart: true })
    await waitFor(
      () => expect(screen.getByRole('button', { name: /show me again/i })).toBeInTheDocument(),
      whole,
    )
    const soFar = played.length
    autoEnd = false
    await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
    await waitFor(() => expect(played.length).toBe(soFar + 1))
    expect(idOf(played[played.length - 1])).toBe(ids[0])
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
