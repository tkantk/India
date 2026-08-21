import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { Symbol } from './Symbol'
import { PALETTE } from './art/palette'
import { readFileSync } from 'node:fs'
import vocab from '../../../content/vocab.json'

/** Read, not imported: vitest hands back an empty string for a stylesheet,
 *  and an empty string would make the mirror test below pass for ever. */
const baseCss = readFileSync('src/styles/base.css', 'utf8')

describe('Symbol', () => {
  it('renders every symbol in the declared vocabulary', () => {
    for (const name of vocab.revealSymbol) {
      const { container, unmount } = render(<Symbol name={name} />)
      expect(container.querySelector('svg'), `${name} rendered nothing`).toBeTruthy()
      unmount()
    }
  })

  it('renders nothing for an unknown symbol rather than crashing', () => {
    const { container } = render(<Symbol name="unicorn" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing at all when the cue carried no argument', () => {
    const { container } = render(<Symbol name={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('gives every symbol something to draw, not an empty frame', () => {
    // `querySelector('svg')` passes on an empty <svg>. A symbol is only real
    // if there are shapes in it — one big one, in `outline`'s case, so this
    // weighs the drawing rather than counting its parts.
    for (const name of vocab.revealSymbol) {
      const { container, unmount } = render(<Symbol name={name} />)
      const shapes = container.querySelectorAll('path, circle, ellipse, rect, polygon, line, text')
      expect(shapes.length, `${name} drew nothing`).toBeGreaterThan(0)
      expect(container.innerHTML.length, `${name} is an empty frame`).toBeGreaterThan(400)
      unmount()
    }
  })

  it('paints every symbol out of the app palette and nothing else', () => {
    // The art has to sit on one beige map together. A stray colour in one
    // symbol is the thing that makes a set look bought rather than drawn.
    const allowed = new Set<string>([...Object.values(PALETTE), 'none', 'currentColor'])
    for (const name of vocab.revealSymbol) {
      const { container, unmount } = render(<Symbol name={name} />)
      for (const el of container.querySelectorAll('*')) {
        for (const attr of ['fill', 'stroke']) {
          const value = el.getAttribute(attr)
          if (value === null) continue
          expect(allowed.has(value), `${name}: ${attr}="${value}" is not in the palette`).toBe(true)
        }
      }
      unmount()
    }
  })

  it('keeps the art palette and base.css in step', () => {
    // PALETTE cannot read a CSS custom property — an SVG presentation
    // attribute on WebKit's legacy engine will not resolve var(). So the two
    // are mirrors, and this is what stops them drifting apart.
    for (const [name, hex] of Object.entries(PALETTE)) {
      expect(baseCss.toLowerCase(), `${name} (${hex}) is not declared in base.css`)
        .toContain(hex.toLowerCase())
    }
  })

  it('takes itself off stage rather than sitting on the map for ever', () => {
    // Nothing clears the overlay: cues run off the audio clock and there is no
    // onDone in the seam. Every effect has to end itself.
    vi.useFakeTimers()
    try {
      const { container } = render(<Symbol name="tiger" />)
      expect(container.querySelector('svg')).toBeTruthy()
      act(() => { vi.advanceTimersByTime(60_000) })
      expect(container.querySelector('svg')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})
