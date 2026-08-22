import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MapStage, nearestPlace } from './MapStage'
import { PICK_ROOT } from './hitLayer'
import { camera } from './camera'
import { useMapNodes } from './useMapNodes'
import geo from '../data/geo.json'
import hit from '../data/hit.json'

const slugs = Object.keys(geo.places)
const mount = (onPick = vi.fn()) => ({ onPick, ...render(<MapStage onPick={onPick} />) })

describe('MapStage', () => {
  it('draws all 36 states and union territories', () => {
    const { container } = mount()
    expect(container.querySelectorAll('.base path')).toHaveLength(36)
  })

  it('makes the visible art inert, so a tap is never tested against it', () => {
    // The visible paths are several thousand points each. Hit-testing them
    // is what makes Safari take hundreds of milliseconds to answer a tap.
    const { container } = mount()
    const group = container.querySelector('.base g')!
    expect(group.getAttribute('pointer-events')).toBe('none')
  })

  it('stays inside the interaction budget: 36 outlines plus pins, under 80 nodes', () => {
    const { container } = mount()
    const nodes = container.querySelectorAll('.hit *')
    expect(nodes.length).toBeLessThanOrEqual(80)
    expect(container.querySelectorAll('.hit path')).toHaveLength(36)
  })

  it('costs nothing to rasterise: no fill, no stroke, and no stroke hit test', () => {
    const { container } = mount()
    for (const el of container.querySelectorAll('.hit *')) {
      expect(el.getAttribute('fill')).toBe('none')
      expect(el.getAttribute('stroke')).toBe('none')
      // `fill` (not `all`, not `visiblePainted`) sets canHitStroke=false in
      // WebKit's PointerEventsHitRules, which skips CGPathCreateStrokedPath —
      // it would otherwise build a whole new stroked path on every tap.
      expect(el.getAttribute('pointer-events')).toBe('fill')
    }
  })

  it('gives a pin to the places too small for a fingertip, and only those', () => {
    const { container } = mount()
    const pinned = [...container.querySelectorAll('.hit circle')]
      .map((c) => c.getAttribute('data-slug'))
    // Derived from the largest circle that fits inside each shape, not from a
    // list: a pin is only worth drawing where it reaches past the real shape.
    expect(pinned.sort()).toEqual(
      slugs.filter((s) => hit.places[s as keyof typeof hit.places].r < 22).sort(),
    )
    for (const slug of ['goa', 'sikkim', 'delhi', 'chandigarh', 'puducherry', 'lakshadweep',
      'andaman-nicobar', 'dadra-and-nagar-haveli-and-daman-and-diu', 'tripura', 'nagaland',
      'manipur', 'meghalaya']) {
      expect(pinned, `${slug} is too small to tap without a pin`).toContain(slug)
    }
    expect(pinned).not.toContain('rajasthan')
  })

  it('paints every pin after every outline, so a tiny place wins the tap', () => {
    // Delhi's pin overlaps Haryana. SVG hit testing takes the last painted
    // node, so the order of these children decides who gets the child's tap.
    const { container } = mount()
    const kids = [...container.querySelector('.hit')!.children]
    const lastPath = kids.findLastIndex((el) => el.tagName === 'path')
    const firstPin = kids.findIndex((el) => el.tagName === 'circle')
    expect(firstPin).toBeGreaterThan(lastPath)
  })

  it('reports the state a child taps, once', async () => {
    const { onPick } = mount()
    await userEvent.click(screen.getByTestId('state-rajasthan'))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('rajasthan')
  })

  it('reports the small place when its pin is tapped, not the state underneath', async () => {
    const { onPick } = mount()
    await userEvent.click(screen.getByTestId('pin-delhi'))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('delhi')
  })

  it('gives every place a stable test handle', () => {
    mount()
    for (const slug of slugs) expect(screen.getByTestId(`state-${slug}`)).toBeInTheDocument()
  })

  it('puts the camera on an HTML wrapper, never on an SVG group', () => {
    // WebKit's legacy SVG engine derives LegacyRenderSVGModelObject from
    // RenderElement, so an SVG child can never own a compositor layer.
    // Transforming a <g> is a main-thread repaint of all 36 paths per frame.
    const { container } = mount()
    expect(container.querySelector('.stage')).toBeInstanceOf(HTMLDivElement)
  })

  it('uses no SVG filter anywhere', () => {
    // WebKit blurs SVG filters on the CPU in three passes; feDropShadow has
    // been a performance cliff since 2012. The glow is a CSS drop-shadow().
    const { container } = mount()
    expect(container.querySelectorAll('filter, feDropShadow, feGaussianBlur')).toHaveLength(0)
    expect(container.innerHTML).not.toContain('filter="url(')
  })

  // The three tests below exist because of a bug none of the others could
  // see. The listener used to sit on `.hit`, whose root is
  // `pointer-events: none` so that its children can be `fill` — so a tap that
  // landed on no place never targeted anything inside it and the handler was
  // never called. Measured in Chrome: of 13,761 taps that hit no place,
  // 13,761 targeted `svg.base` and 0 reached `svg.hit`. Every pick test still
  // passed, because they all dispatch on an element that IS a place.

  it('hangs the listener above every layer, not on one of them', () => {
    // The structural half. jsdom does no hit testing at all, so no test here
    // can discover which element a stray tap lands on — but it can check that
    // whichever one it is, the handler is above it.
    const { container } = mount()
    const host = container.querySelector(`.${PICK_ROOT}`)!
    for (const layer of ['svg.base', 'svg.hit', 'svg.glow']) {
      const el = container.querySelector(layer)!
      expect(host.contains(el), `${layer} is outside the pick root`).toBe(true)
      expect(host, `the pick root must not BE ${layer}`).not.toBe(el)
    }
  })

  it('keeps the shape the headless probe rebuilds', () => {
    // scripts/probe-map-hits.mjs writes its own page shell — it cannot render
    // React — so this is the contract that stops the two drifting apart. The
    // markup inside the layers is shared code; only this skeleton is copied.
    const { container } = mount()
    const map = container.querySelector('.map')!
    const root = map.querySelector(`:scope > .${PICK_ROOT}`)!
    expect([...root.children].map((el) => `${el.tagName}.${el.getAttribute('class')}`))
      .toEqual(['svg.base', 'svg.hit', 'svg.glow'])
    expect(root.querySelector(':scope > svg.base > g')!.getAttribute('pointer-events')).toBe('none')
    // The credit is a SIBLING of .map, not a child of it (Task 4): .map gets
    // framed narrower than the stage to leave the read-along room, and a
    // credit still positioned against .map's own box would be dragged up
    // with it. map.css's `.map + .credit` only matches if the DOM agrees.
    expect(container.querySelector(':scope > p.credit')).not.toBeNull()
    expect(map.querySelector('p.credit')).toBeNull()
  })

  it('picks from an event that arrives via a different layer', () => {
    // The behavioural half. `svg.base` is where a stray tap actually lands,
    // measured in Chrome — an element the hit layer does not contain. If the
    // handler cannot be reached from there, the snap is dead code.
    const { onPick, container } = mount()
    const fromBase = container.querySelector('.base path[data-slug="rajasthan"]')!
    fromBase.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('rajasthan')
  })

  it('survives a tap on nothing in an environment with no SVG geometry', () => {
    // jsdom implements no getScreenCTM, so the snap cannot run here. It must
    // decline quietly rather than throw inside a pointerdown handler.
    const { onPick, container } = mount()
    const stray = container.querySelector('svg.base')!
    expect(() => stray.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }),
    )).not.toThrow()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('never puts a CSS filter on an SVG child, and keeps drop-shadow last', () => {
    // An SVG child is a LegacyRenderSVGModelObject — RenderElement, not
    // RenderLayerModelObject — so it can never own a compositor layer, and a
    // filter on one runs through WebKit's software three-pass box blur. Only
    // the <svg> root, a replaced element, can composite it. Vitest does not
    // process CSS, so this reads the stylesheet as the source of truth.
    const css = readFileSync('src/map/map.css', 'utf8')
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => /(^|[^-\w])filter\s*:/.test(body))

    expect(rules.length, 'no filter rule at all — did the glow lose its shadow?')
      .toBeGreaterThan(0)
    for (const [, selector, body] of rules) {
      expect(selector.trim(), 'a filter on an SVG child is a CPU blur')
        .not.toMatch(/\b(path|circle|g|polygon|rect|line|ellipse)\b/)
      const value = /(?:^|[^-\w])filter\s*:([^;]*)/.exec(body)![1].trim()
      // `var()` is substitution, not a filter operation, so it does not count.
      const ops = [...value.matchAll(/([a-z-]+)\(/g)]
        .map((m) => m[1])
        .filter((fn) => fn !== 'var')
      expect(ops.at(-1), 'drop-shadow must be the LAST filter operation')
        .toBe('drop-shadow')
    }
  })

  it('hands the camera its own stage element, not a class name to look up', async () => {
    // The camera has to transform the stage and rewrite every layer's
    // viewBox. Finding them with querySelector('.stage') would keep working
    // right up until the class was renamed, and then fail in silence.
    const { container } = mount()
    expect(camera.view()).toEqual(geo.viewBox)
    await camera.flyTo(geo.places.delhi.bbox as [number, number, number, number], { duration: 0 })

    const flown = container.querySelector('svg.base')!.getAttribute('viewBox')
    expect(flown).not.toBe(geo.viewBox.join(' '))
    // All three, together. The hit layer is what a tap is tested against: if
    // it kept the old viewBox the map would go dead the moment a child zoomed.
    for (const layer of ['svg.base', 'svg.hit', 'svg.glow']) {
      expect(container.querySelector(layer)!.getAttribute('viewBox'), layer).toBe(flown)
    }
    await camera.home({ duration: 0 })
  })

  it('lets the camera go when the map unmounts', () => {
    const { unmount } = mount()
    expect(camera.view()).not.toBeNull()
    unmount()
    expect(camera.view()).toBeNull()
  })

  it('leaves the glow layer out entirely when the child has asked for less motion', () => {
    // The glow is a full-screen composited layer the moment its filter turns
    // on — about 12.6 MB on a 2048x1536 iPad. On the hardware that cannot
    // afford it, the layer should not exist to be turned on.
    vi.stubGlobal('matchMedia', (media: string) => ({
      media, matches: media.includes('prefers-reduced-motion'), onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }))
    const { container } = mount()
    expect(container.querySelector('svg.glow')).toBeNull()
    // The map still works: the art and the targets are untouched.
    expect(container.querySelectorAll('.base path')).toHaveLength(36)
    expect(container.querySelectorAll('.hit path')).toHaveLength(36)
    vi.unstubAllGlobals()
  })

  it('shows the CC BY 4.0 credit the map data legally requires', () => {
    mount()
    // Not behind a tap, a menu or a colophon page: on the map, always.
    expect(screen.getByText(geo.attribution)).toBeVisible()
  })

  it('carries the way in to the credits for the other 31 files', () => {
    // The boundaries are one of 32 third-party assets, and the other 31 —
    // 20 photographs and 11 sounds, 25 of which legally require a credit —
    // cannot all fit on the map. This link is where they live. It hangs off
    // the credit line rather than the control bar because it is for the
    // adult and for the licensor, not for the six-year-old whose five
    // buttons must not have to compete with a sixth.
    const { container } = mount()
    const credit = container.querySelector('p.credit')!
    const link = credit.querySelector('a')!
    // A plain hash link, not <Link>: MapStage is mounted here and by the
    // headless probes with no Router around it, and under HashRouter this
    // navigates identically.
    expect(link).toHaveAttribute('href', '#/credits')
    expect(link.textContent).toMatch(/credits/i)
  })

  it('keeps the very same path elements across a re-render', () => {
    // The whole architecture rests on this. `useMapNodes` caches the 36
    // visible paths once, on mount, and highlights a state by toggling a
    // class on the cached element — never through React. If a re-render
    // hands the DOM a fresh set of paths, every one of those references is
    // detached and every highlight after it lands on a node nobody can see:
    // no error, no warning, a map that simply stops lighting up.
    //
    // React 19 compares `dangerouslySetInnerHTML` by object identity, so a
    // `{{ __html: ... }}` literal in the JSX is exactly that failure. Nothing
    // re-rendered this component before the tour existed; the tour
    // re-renders it on every one of the fourteen beats.
    const onPick = vi.fn()
    const { container, rerender } = render(<MapStage onPick={onPick} />)
    const before = [...container.querySelectorAll('.base path')]
    const hitsBefore = [...container.querySelectorAll('.hit path')]
    rerender(<MapStage onPick={onPick} />)
    expect([...container.querySelectorAll('.base path')]).toEqual(before)
    expect([...container.querySelectorAll('.hit path')]).toEqual(hitsBefore)
    expect(before[0].isConnected).toBe(true)
  })

  it('goes on lighting states after a re-render', () => {
    // The behaviour the identity above exists for, stated in the terms a
    // child would notice.
    const onPick = vi.fn()
    const { container, rerender } = render(<MapStage onPick={onPick} />)
    rerender(<MapStage onPick={onPick} />)
    const api = useMapNodes()
    api.highlight('kerala', true)
    expect(container.querySelector('[data-slug="kerala"]')!.classList.contains('lit')).toBe(true)
    api.clear()
  })
})

/**
 * The snapping half of the pick. jsdom implements no SVG coordinate API at
 * all — no getScreenCTM, no createSVGPoint, no DOMMatrix — so the browser
 * plumbing cannot be exercised here; this tests the geometry it feeds.
 * Distances are viewBox units.
 */
describe('nearestPlace', () => {
  it('finds nothing out in the open ocean', () => {
    // A child who taps the empty sea meant to tap the empty sea. This point
    // is in the deep Bay of Bengal, 255 units from the nearest coast — and
    // 16.7% of the water inside the viewBox is that remote, so the ocean
    // stays inert at any snap radius the map could reasonably use.
    expect(nearestPlace(650, 1094, 157)).toBeNull()
  })

  it('finds the place a hair outside its own simplified outline', () => {
    // Rajasthan's pole, nudged out past where its coarse outline can be.
    const [x, y] = hit.places.rajasthan.pin
    expect(nearestPlace(x, y, 130)).toBe('rajasthan')
  })

  it('recovers an island the simplifier dropped', () => {
    // Andaman & Nicobar loses most of its 52 islands to the point budget, so
    // a tap on one is a tap on nothing. It is also the territory a child is
    // least able to find in the first place.
    const [x, y] = geo.places['andaman-nicobar'].centroid
    expect(nearestPlace(x, y, 130)).toBe('andaman-nicobar')
  })

  it('respects the reach it is given', () => {
    const [x, y] = hit.places.lakshadweep.pin
    expect(nearestPlace(x + 200, y, 130)).not.toBe('lakshadweep')
    expect(nearestPlace(x + 5, y, 130)).toBe('lakshadweep')
  })

  it('never invents a place that is not on the map', () => {
    for (const probe of [[0, 0], [999, 1099], [500, 550], [1, 1]]) {
      const got = nearestPlace(probe[0], probe[1], 130)
      if (got !== null) expect(slugs).toContain(got)
    }
  })
})
