import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Card, TONES } from './Reveal'
import { PALETTE } from './art/palette'

/**
 * `Card` prints its page in whichever of the eight tints its `tone` prop
 * names — see the big comment above `TONES` in Reveal.tsx for why the
 * mapping has to live in a table rather than each piece of art hand-picking
 * a hex. The failure mode this guards against is a `Card` that quietly went
 * back to painting one fixed page (its old, pre-picture-book `--paper`
 * constant) regardless of what a caller asked for — every reveal in the tour
 * would still render, still pass a shallow "did something draw" test, and
 * still look like the single cream card the direction was built to retire.
 */
describe('Card', () => {
  const pageRect = (container: HTMLElement) =>
    container.querySelector('svg.cue-art')!.querySelector(':scope > rect')!

  it('takes its page colour from the tone prop, not a fixed constant', () => {
    const { container: sky, unmount: unmountSky } = render(
      <Card tone="sky"><circle cx="60" cy="60" r="10" /></Card>
    )
    expect(pageRect(sky)).toHaveAttribute('fill', TONES.sky)
    unmountSky()

    const { container: sand, unmount: unmountSand } = render(
      <Card tone="sand"><circle cx="60" cy="60" r="10" /></Card>
    )
    expect(pageRect(sand)).toHaveAttribute('fill', TONES.sand)
    unmountSand()

    // The two tones must actually differ — a Card that painted every tone
    // the same colour would pass each assertion above on its own.
    expect(TONES.sky).not.toBe(TONES.sand)
  })

  it('defaults to the paper page when a caller names none', () => {
    const { container } = render(<Card><circle cx="60" cy="60" r="10" /></Card>)
    expect(pageRect(container)).toHaveAttribute('fill', TONES.paper)
  })

  it('keeps every tone in TONES painted from the mirrored art palette', () => {
    // TONES is meant to be built entirely out of PALETTE's own values (see
    // its own comment: "mirrors --mat-* in base.css"), never a hex it
    // invented — this is what would catch a tone that drifted from the
    // palette test's own mirror.
    for (const [tone, hex] of Object.entries(TONES)) {
      expect(Object.values(PALETTE), `${tone} (${hex}) is not in PALETTE`).toContain(hex)
    }
  })

  it('draws its rule in the one ink, not the tone it sits on', () => {
    const { container } = render(<Card tone="teal"><circle cx="60" cy="60" r="10" /></Card>)
    const rects = container.querySelector('svg.cue-art')!.querySelectorAll(':scope > rect')
    const rule = rects[rects.length - 1]
    expect(rule).toHaveAttribute('stroke', PALETTE.inkLine)
    expect(rule).toHaveAttribute('vector-effect', 'non-scaling-stroke')
  })
})
