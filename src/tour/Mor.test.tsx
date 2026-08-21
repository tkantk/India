import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { Mor } from './Mor'
import { Peacock } from './effects/art/Peacock'
import { PALETTE } from './effects/art/palette'

/** Every drawn shape, as a string that ignores styles and transforms — so
 *  two drawings compare by their GEOMETRY and their paint, which is what
 *  "the same bird" means. */
const GEOMETRY = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points']
const PAINT = ['fill', 'stroke', 'stroke-width']

function shapes(root: Element): string[] {
  return [...root.querySelectorAll('path, circle, ellipse, line, polygon, rect')].map((el) =>
    [el.tagName, ...[...GEOMETRY, ...PAINT].map((a) => `${a}=${el.getAttribute(a) ?? ''}`)].join('|'),
  )
}

/** How far apart Motion has actually put the two outermost feathers, in
 *  degrees — which is what "the fan is open" means. Not one feather's own
 *  angle: the whole bundle also swings back over his shoulder when it folds,
 *  and that moves every feather together without opening anything. */
function fanSpread(container: HTMLElement): number {
  const feathers = container.querySelectorAll('.mor__tail > g')
  const angle = (g: Element) =>
    Number(/rotate\((-?[\d.]+)deg\)/.exec((g as SVGElement).style.transform)?.[1] ?? NaN)
  return Math.abs(angle(feathers[feathers.length - 1]) - angle(feathers[0]))
}

describe('Mor', () => {
  it('is idle when nothing is playing', () => {
    const { container } = render(<Mor playing={false} showing={null} />)
    expect(container.firstElementChild).toHaveAttribute('data-state', 'idle')
  })

  it('is talking while narration plays', () => {
    const { container } = render(<Mor playing showing={null} />)
    expect(container.firstElementChild).toHaveAttribute('data-state', 'talking')
  })

  it('fans his tail when a symbol is on stage', () => {
    const { container } = render(<Mor playing showing="tiger" />)
    expect(container.firstElementChild).toHaveAttribute('data-state', 'showing')
  })

  it('is hidden from assistive technology, because the narration carries the content', () => {
    const { container } = render(<Mor playing={false} showing={null} />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('holds a single pose under reduced motion', () => {
    const { container } = render(
      <MotionConfig reducedMotion="always"><Mor playing showing={null} /></MotionConfig>,
    )
    expect(container.firstElementChild).toHaveAttribute('data-still', 'true')
  })

  it('says so when nobody asked for stillness, so the flag means something', () => {
    // Without this the whole reduced-motion test above is satisfied by an
    // attribute hardcoded to "true".
    const { container } = render(<Mor playing showing={null} />)
    expect(container.firstElementChild).toHaveAttribute('data-still', 'false')
  })

  // --------------------------------------------------------------------
  // Beyond the brief: three things a person would otherwise have to catch
  // by looking, and one of them nobody would catch at all.

  it('goes on framing the art when the child pauses in the middle of a reveal', () => {
    // Pausing does not take the tiger off the map, so it must not drop Mor
    // back to a folded tail either: what is on stage outranks the transport.
    const { container } = render(<Mor playing={false} showing="tiger" />)
    expect(container.firstElementChild).toHaveAttribute('data-state', 'showing')
  })

  it('opens the fan wider the more he has to show', () => {
    // The states are only worth having if the tail actually moves between
    // them. This reads the rotation Motion put on a real feather, not a
    // class name that could be applied to nothing.
    const idle = render(<Mor playing={false} showing={null} />).container
    const talking = render(<Mor playing showing={null} />).container
    const showing = render(<Mor playing showing="tiger" />).container
    expect(fanSpread(idle)).toBeGreaterThan(0)
    expect(fanSpread(talking)).toBeGreaterThan(fanSpread(idle))
    expect(fanSpread(showing)).toBeGreaterThan(fanSpread(talking))
  })

  it('is the same peacock beat 8 reveals, shape for shape — "and that is me"', () => {
    // The narration says it out loud while the reveal is on screen, so a
    // child has to recognise the two as one bird. Sharing the drawing is the
    // only way to guarantee that; this fails the moment Mor is redrawn.
    const mor = render(<Mor playing={false} showing={null} />).container
    const reveal = render(<Peacock />).container
    const drawn = new Set(shapes(mor))
    const bird = shapes(reveal).filter((s) => !s.startsWith('rect|'))   // not the card
    expect(bird.length).toBeGreaterThan(20)
    for (const shape of bird) expect(drawn).toContain(shape)
  })

  it('paints out of the app palette and nothing else', () => {
    const allowed = new Set<string>([...Object.values(PALETTE), 'none', 'currentColor'])
    const { container } = render(<Mor playing showing="tiger" />)
    for (const el of container.querySelectorAll('*')) {
      for (const attr of ['fill', 'stroke']) {
        const value = el.getAttribute(attr)
        if (value === null) continue
        expect(allowed.has(value), `${attr}="${value}" is not in the palette`).toBe(true)
      }
    }
  })
})
