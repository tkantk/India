import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MapStage } from './MapStage'
import { useMapNodes } from './useMapNodes'
import type { MapApi } from './useMapNodes'
import geo from '../data/geo.json'

/**
 * These tests render the real `MapStage`, not a hand-built SVG double. The
 * node cache's whole job is to find the elements that component actually
 * emits, so a double here would only ever prove that the cache can find a
 * double.
 */
function mount() {
  let renders = 0
  let api!: MapApi
  function Probe() {
    renders++
    api = useMapNodes()
    return <MapStage onPick={() => {}} />
  }
  const view = render(<Probe />)
  return { view, api, renderCount: () => renders }
}

const lit = (api: MapApi, slug: string) => api.nodes.get(slug)!.classList.contains('lit')

afterEach(() => { vi.useRealTimers() })

describe('useMapNodes', () => {
  it('caches every one of the 36 places once the map is mounted', () => {
    const { view, api } = mount()
    expect(api.nodes.size).toBe(36)
    for (const slug of Object.keys(geo.places)) {
      const node = api.nodes.get(slug)
      // jsdom has no SVGPathElement, so the shape of the node is checked
      // rather than its constructor.
      expect(node?.tagName, `${slug} is not in the cache`).toBe('path')
      expect(node?.getAttribute('d')?.length, `${slug} has no geometry`).toBeGreaterThan(50)
    }
    // The cache must hold the *visible* paths — those are the ones a
    // highlight recolours. The hit layer's copies are invisible by design.
    const visible = new Set(view.container.querySelectorAll('.base path'))
    for (const node of api.nodes.values()) expect(visible.has(node)).toBe(true)
  })

  it('lights a state by touching the DOM, without re-rendering React', () => {
    const { api, renderCount } = mount()
    const before = renderCount()
    expect(before, 'the render counter is not counting').toBeGreaterThan(0)

    // Ten states, the size of a real cue wave. If any of this went through
    // React state, the reconciler would walk 269 KB of path data ten times.
    const ten = Object.keys(geo.places).slice(0, 10)
    for (const slug of ten) api.highlight(slug, true)

    expect(renderCount()).toBe(before)
    for (const slug of ten) expect(lit(api, slug), `${slug} did not light`).toBe(true)
  })

  it('turns a state back off again', () => {
    const { api } = mount()
    api.highlight('goa', true)
    api.highlight('goa', false)
    expect(lit(api, 'goa')).toBe(false)
  })

  it('ignores a slug it has never heard of instead of throwing', () => {
    // `highlightState` and `lightNeighbour` are dispatched from narration
    // cues. A typo in the content must not end a child's tour.
    const { api } = mount()
    expect(() => api.highlight('atlantis', true)).not.toThrow()
  })

  it('clears every lit state at once', () => {
    const { api } = mount()
    api.highlight('kerala', true)
    api.highlight('bihar', true)
    api.clear()
    expect(lit(api, 'kerala')).toBe(false)
    expect(lit(api, 'bihar')).toBe(false)
  })

  it('runs a staggered wave, so the states arrive one after another', () => {
    vi.useFakeTimers()
    const { api } = mount()
    api.highlightMany(['punjab', 'haryana', 'delhi'], 50)

    expect(lit(api, 'punjab')).toBe(true)
    expect(lit(api, 'haryana')).toBe(false)
    vi.advanceTimersByTime(50)
    expect(lit(api, 'haryana')).toBe(true)
    expect(lit(api, 'delhi')).toBe(false)
    vi.advanceTimersByTime(50)
    expect(lit(api, 'delhi')).toBe(true)
  })

  it('cancels a wave still in flight when the map is cleared', () => {
    // The 28-state wave takes about two seconds. If the child taps a state
    // one second in, the rest of the wave must not keep arriving over the
    // top of wherever the tour has gone.
    vi.useFakeTimers()
    const { api } = mount()
    api.highlightMany(['punjab', 'haryana', 'delhi'], 50)
    api.clear()
    vi.advanceTimersByTime(1000)
    expect(lit(api, 'punjab')).toBe(false)
    expect(lit(api, 'haryana')).toBe(false)
    expect(lit(api, 'delhi')).toBe(false)
  })

  it('does not let a wave from a torn-down map light up the next one', () => {
    // A wave outlives the beat that started it by a couple of seconds. If it
    // survives the map being torn down, it lands on whatever map replaces it
    // — states lighting themselves with nothing being said about them.
    vi.useFakeTimers()
    const first = mount()
    first.api.highlightMany(['punjab', 'haryana', 'delhi'], 50)
    first.view.unmount()

    const second = mount()
    vi.advanceTimersByTime(1000)
    expect(lit(second.api, 'haryana')).toBe(false)
    expect(lit(second.api, 'delhi')).toBe(false)
  })

  it('copies the lit path into the glow layer, and takes it away again', () => {
    const { view, api } = mount()
    const glow = view.container.querySelector('.glow path')!

    api.highlight('rajasthan', true)
    expect(glow.getAttribute('d')).toBe(api.nodes.get('rajasthan')!.getAttribute('d'))

    api.highlight('rajasthan', false)
    expect(glow.getAttribute('d')).toBeNull()
  })
})
