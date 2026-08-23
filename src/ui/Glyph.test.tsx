import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Glyph } from './Glyph'
import type { GlyphName } from './Glyph'

/**
 * The nine marks `Controls.tsx` and `StartGate.tsx` actually reach for.
 * Hardcoded rather than derived from the module, on purpose: `MARKS` is not
 * exported (nothing outside this file should be able to paint from it
 * directly — see `Glyph`'s own note on why `size` is the only prop), so this
 * list is the outside world's own record of the contract. If a name is ever
 * removed from `GlyphName` without a matching removal here, `tsc -b` catches
 * it (the array is typed `GlyphName[]`); if a name draws nothing, this file
 * catches that.
 */
const NAMES: GlyphName[] = [
  'play', 'pause', 'loading', 'again', 'slower', 'normal',
  'sound-on', 'sound-off', 'home',
]

describe('Glyph', () => {
  it('draws something for every mark the control bar and the start gate use', () => {
    // `querySelector('svg')` alone would pass for an empty <svg />; this
    // instead weighs what is actually inside it, the same rule
    // Symbol.test.tsx applies to the tour's art.
    for (const name of NAMES) {
      const { container, unmount } = render(<Glyph name={name} />)
      const shapes = container.querySelectorAll('path, circle, rect, ellipse, polygon, line')
      expect(shapes.length, `${name} drew nothing`).toBeGreaterThan(0)
      unmount()
    }
  })

  it('is a 24-unit box painted in currentColor, not a colour of its own', () => {
    // No colour prop on purpose (see the file's own note): a glyph that could
    // be given its own colour is one that can fall out of step with the word
    // beside it.
    const { container } = render(<Glyph name="play" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('fill', 'currentColor')
  })

  it('is invisible to a screen reader, so the word next to it is the only accessible name', () => {
    const { container } = render(<Glyph name="home" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('sizes itself from the one prop it takes, in em by default', () => {
    const { container: withDefault } = render(<Glyph name="play" />)
    expect(withDefault.querySelector('svg')).toHaveAttribute('width', '1em')

    const { container: withSize } = render(<Glyph name="play" size="32px" />)
    const sized = withSize.querySelector('svg')
    expect(sized).toHaveAttribute('width', '32px')
    expect(sized).toHaveAttribute('height', '32px')
  })
})
