import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MapStage, nearestPlace } from './MapStage'
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

  it('survives a tap on nothing in an environment with no SVG geometry', () => {
    // jsdom implements no getScreenCTM, so the snap cannot run here. It must
    // decline quietly rather than throw inside a pointerdown handler.
    const { onPick, container } = mount()
    const layer = container.querySelector('.hit')!
    expect(() => layer.dispatchEvent(
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

  it('shows the CC BY 4.0 credit the map data legally requires', () => {
    mount()
    // Not behind a tap, a menu or a colophon page: on the map, always.
    expect(screen.getByText(geo.attribution)).toBeVisible()
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
