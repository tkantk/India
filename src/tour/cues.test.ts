import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { CUES, dispatch } from './cues'
import { FADE_MS } from './effects/Reveal'
import timings from '../data/timings.json'
import vocab from '../../content/vocab.json'
import geo from '../data/geo.json'
import hit from '../data/hit.json'
import { PLACE_PADDING } from '../map/camera'

/** Every verb any content actually uses. */
const usedVerbs = new Set(
  Object.values(timings as Record<string, { cues: { do: string }[] }>)
    .flatMap((c) => c.cues.map((q) => q.do)),
)

/** Every (verb, arg) pair any content actually fires — the registry's real
 *  interaction budget, not just its declared vocabulary. */
const usedCues = Object.values(timings as Record<string, { cues: { do: string; arg?: string }[] }>)
  .flatMap((c) => c.cues)

describe('cue registry', () => {
  it('handles every verb the content actually uses', () => {
    for (const verb of usedVerbs) {
      expect(CUES[verb], `no handler for "${verb}"`).toBeTypeOf('function')
    }
  })

  it('has exactly one entry per verb — the twelve the content uses', () => {
    // Guards a duplicate or a stray extra entry as much as a missing one:
    // "exactly one entry per verb" is the brief's own phrase.
    expect(Object.keys(CUES).sort()).toEqual([...usedVerbs].sort())
    expect(Object.keys(CUES)).toHaveLength(12)
  })

  it('handles every revealSymbol argument in the declared vocabulary', () => {
    const api = fakeApi()
    for (const symbol of vocab.revealSymbol) {
      expect(() => dispatch({ t: 0, word: 0, do: 'revealSymbol', arg: symbol }, api)).not.toThrow()
      expect(api.setOverlay, `revealSymbol ${symbol} did nothing`).toHaveBeenCalled()
      api.setOverlay.mockClear()
    }
  })

  it('handles every showScript greeting', () => {
    const api = fakeApi()
    for (const g of vocab.showScript) {
      dispatch({ t: 0, word: 0, do: 'showScript', arg: g }, api)
      expect(api.setOverlay).toHaveBeenCalled()
      api.setOverlay.mockClear()
    }
  })

  it('handles every declared river', () => {
    const api = fakeApi()
    for (const river of vocab.rivers) {
      dispatch({ t: 0, word: 0, do: 'traceRiver', arg: river }, api)
      expect(api.setOverlay).toHaveBeenCalled()
      api.setOverlay.mockClear()
    }
  })

  it('handles the no-argument art cues (unfurlFlag, raiseMountains)', () => {
    const api = fakeApi()
    for (const verb of ['unfurlFlag', 'raiseMountains']) {
      dispatch({ t: 0, word: 0, do: verb }, api)
      expect(api.setOverlay, `${verb} did nothing`).toHaveBeenCalled()
      api.setOverlay.mockClear()
    }
  })

  it('handles every countTo value in use (28, 8, 24)', () => {
    const api = fakeApi()
    for (const n of ['28', '8', '24']) {
      dispatch({ t: 0, word: 0, do: 'countTo', arg: n }, api)
      expect(api.setOverlay).toHaveBeenCalled()
      api.setOverlay.mockClear()
    }
  })

  it('ignores an unknown verb instead of crashing the tour', () => {
    // A child mid-tour must never see a blank screen because of a typo.
    expect(() => dispatch({ t: 0, word: 0, do: 'wobble' }, fakeApi())).not.toThrow()
  })

  it('logs an unknown verb at debug level, not error or warn', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    dispatch({ t: 0, word: 0, do: 'wobble' }, fakeApi())
    expect(debug).toHaveBeenCalledOnce()
  })

  it('ignores a known verb with a nonsense argument', () => {
    expect(() => dispatch({ t: 0, word: 0, do: 'zoomTo', arg: 'atlantis' }, fakeApi())).not.toThrow()
  })

  it('never throws for any verb, paired with a nonsense argument or none at all', () => {
    for (const verb of Object.keys(CUES)) {
      expect(() => dispatch({ t: 0, word: 0, do: verb, arg: 'not-a-real-thing' }, fakeApi())).not.toThrow()
      expect(() => dispatch({ t: 0, word: 0, do: verb }, fakeApi())).not.toThrow()
    }
  })

  it('never throws for any cue any real clip actually fires', () => {
    // Every (verb, arg) pair fourteen tour beats and every place's content
    // actually dispatches, replayed against a fresh double each time.
    for (const cue of usedCues) {
      expect(() => dispatch({ t: 0, word: 0, ...cue }, fakeApi())).not.toThrow()
    }
  })

  it('does not crash even if a handler itself throws — the last line of defence', () => {
    const api = fakeApi()
    api.map.highlight.mockImplementation(() => { throw new Error('boom') })
    expect(() => dispatch({ t: 0, word: 0, do: 'highlightState', arg: 'kerala' }, api)).not.toThrow()
  })

  it('routes zoomTo through the camera with the real bbox, padded for the place\'s own pin', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }, api)
    // Delhi's own pinR (16.1) is smaller than PLACE_PADDING, so this is the
    // floor, not the ceiling — the case that matters for Delhi specifically
    // is asserted separately below.
    expect(api.camera.flyTo)
      .toHaveBeenCalledWith(geo.places.delhi.bbox, { padding: PLACE_PADDING })
  })

  it('pads a small-pinR place at the house-style floor, not its own tiny pinR', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'zoomTo', arg: 'delhi' }, api)
    const [, opts] = (api.camera.flyTo as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(opts.padding).toBe(PLACE_PADDING)
    expect(opts.padding).toBeGreaterThan(hit.places.delhi.pinR)
  })

  it('pads a place whose own pinR exceeds the house style with that pinR instead', () => {
    // Andaman & Nicobar's pinR (112.6) is real content this task shipped —
    // zoomTo has no cue that flies there today, but the same handler code
    // path must still ask for the right amount of room if content ever
    // does.
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'zoomTo', arg: 'andaman-nicobar' }, api)
    expect(api.camera.flyTo).toHaveBeenCalledWith(
      geo.places['andaman-nicobar'].bbox,
      { padding: hit.places['andaman-nicobar'].pinR },
    )
  })

  it('does not fly the camera for zoomTo with no argument at all', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'zoomTo' }, api)
    expect(api.camera.flyTo).not.toHaveBeenCalled()
  })

  it('lights exactly the 28 states for highlightAllStates', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'highlightAllStates' }, api)
    expect(api.map.highlightMany).toHaveBeenCalledOnce()
    expect(api.map.highlightMany.mock.calls[0][0]).toHaveLength(28)
  })

  it('lights exactly the 8 union territories', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'highlightUnionTerritories' }, api)
    expect(api.map.highlightMany.mock.calls[0][0]).toHaveLength(8)
  })

  it('derives the state/UT lists from geo.json, not a hardcoded copy', () => {
    const places = geo.places as Record<string, { type: string }>
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'highlightAllStates' }, api)
    dispatch({ t: 0, word: 0, do: 'highlightUnionTerritories' }, api)
    const [states]: string[][] = api.map.highlightMany.mock.calls[0]
    const [uts]: string[][] = api.map.highlightMany.mock.calls[1]
    for (const slug of states) expect(places[slug].type).toBe('state')
    for (const slug of uts) expect(places[slug].type).toBe('ut')
    // Together they are every place on the map, with no overlap.
    expect(new Set([...states, ...uts]).size).toBe(Object.keys(places).length)
  })

  it('treats a missing sound as silence', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'playSfx', arg: 'tiger-growl' }, api)
    expect(api.sfx).toHaveBeenCalledWith('tiger-growl')
    // The engine resolves absent files to a no-op; the registry must not guard.
  })

  it('does not call sfx for playSfx with no argument', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'playSfx' }, api)
    expect(api.sfx).not.toHaveBeenCalled()
  })

  it('highlights the named state for highlightState and lightNeighbour', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'highlightState', arg: 'kerala' }, api)
    expect(api.map.highlight).toHaveBeenCalledWith('kerala', true)
    dispatch({ t: 0, word: 0, do: 'lightNeighbour', arg: 'tamil-nadu' }, api)
    expect(api.map.highlight).toHaveBeenCalledWith('tamil-nadu', true)
  })

  it('does not touch the map for highlightState/lightNeighbour with no argument', () => {
    const api = fakeApi()
    dispatch({ t: 0, word: 0, do: 'highlightState' }, api)
    dispatch({ t: 0, word: 0, do: 'lightNeighbour' }, api)
    expect(api.map.highlight).not.toHaveBeenCalled()
  })
})

/**
 * The one seam between `Cue.hold` and the screen: `dispatch` reads
 * `cue.hold` and passes it to the handler, which — for an art verb — is
 * `art()`, which passes it to `OVERLAYS[verb]`, which passes it to the
 * effect. Every other test of `hold` in this codebase (`overlays.test.tsx`,
 * `GrandTour.test.tsx`) enters one layer below this one, calling
 * `OVERLAYS[verb](arg, hold)` directly — so none of them would notice
 * `dispatch`/`art()` silently dropping the third argument (e.g. `art()`
 * calling `render(arg)` instead of `render(arg, hold)`): every effect would
 * just fall back to its own constant, which is indistinguishable from
 * working unless something dispatches a REAL cue and watches the actual
 * dismiss time.
 */
describe("dispatch carries a cue's derived hold all the way to the art on screen", () => {
  it("keeps the art up until the cue's own hold, not the effect's fallback constant", () => {
    vi.useFakeTimers()
    try {
      const api = fakeApi()
      // Far short of HOLD.symbol (6000ms, Reveal.tsx): if `hold` were
      // dropped anywhere between here and the effect, the art driven by the
      // 6000ms fallback would still be up at both checks below.
      const hold = 1000
      dispatch({ t: 0, word: 0, do: 'revealSymbol', arg: 'tiger', hold }, api)

      expect(api.setOverlay).toHaveBeenCalledOnce()
      const node = api.setOverlay.mock.calls[0][0]
      const { container } = render(node)

      // `.cue-figure`/`.cue-layer` is `Reveal`'s own wrapper (Reveal.tsx) —
      // present while the effect has not yet dismissed itself, gone once it
      // has. The always-mounted `.cue` div from `overlays.tsx` cannot be the
      // signal: it never unmounts.
      const artUp = () => container.querySelector('.cue-figure, .cue-layer') !== null
      expect(artUp()).toBe(true)

      act(() => { vi.advanceTimersByTime(hold + FADE_MS - 100) })
      expect(artUp()).toBe(true)

      act(() => { vi.advanceTimersByTime(200) })
      expect(artUp()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reaches the accumulating seas the same way, through the sea special-case in overlays.tsx', () => {
    vi.useFakeTimers()
    try {
      const api = fakeApi()
      const hold = 1000
      dispatch({ t: 0, word: 0, do: 'revealSymbol', arg: 'arabian-sea', hold }, api)

      const node = api.setOverlay.mock.calls[0][0]
      const { container } = render(node)
      expect(container.querySelector('.cue-layer')).toBeTruthy()

      act(() => { vi.advanceTimersByTime(hold + FADE_MS + 100) })
      expect(container.querySelector('.cue-layer')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

afterEach(() => { vi.restoreAllMocks() })

/** A faithful `CueApi` double — every field of the real interfaces it stands
 *  in for, `nodes` included, even though no handler under test touches it.
 *  An incomplete double is worse than none: it would only prove a handler
 *  that never asks for `nodes` works, which is not the same claim. */
function fakeApi() {
  return {
    map: { nodes: new Map(), highlight: vi.fn(), highlightMany: vi.fn(), clear: vi.fn() },
    camera: { flyTo: vi.fn(), home: vi.fn() },
    sfx: vi.fn(),
    setOverlay: vi.fn(),
  }
}
