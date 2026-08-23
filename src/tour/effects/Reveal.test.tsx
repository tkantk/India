import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Card } from './Reveal'
import { PALETTE } from './art/palette'
import { DEFAULT_SUBJECT, SUBJECTS, subjectOf } from './subject'

/**
 * `Card` prints its page in whichever colour its `subject` prop's row of
 * `subject.ts` names — see that file's own top comment for why the mapping
 * has to live in one table rather than each piece of art hand-picking a hex.
 * The failure mode this guards against is a `Card` that quietly went back to
 * painting one fixed page (its old, pre-picture-book `--paper` constant)
 * regardless of what a caller asked for — every reveal in the tour would
 * still render, still pass a shallow "did something draw" test, and still
 * look like the single cream card the direction was built to retire.
 */
describe('Card', () => {
  const pageRect = (container: HTMLElement) =>
    container.querySelector('svg.cue-art')!.querySelector(':scope > rect')!

  it('takes its page colour from the subject prop, not a fixed constant', () => {
    const { container: lotus, unmount: unmountLotus } = render(
      <Card subject="lotus"><circle cx="60" cy="60" r="10" /></Card>
    )
    expect(pageRect(lotus)).toHaveAttribute('fill', subjectOf('lotus').page)
    unmountLotus()

    const { container: banyan, unmount: unmountBanyan } = render(
      <Card subject="banyan"><circle cx="60" cy="60" r="10" /></Card>
    )
    expect(pageRect(banyan)).toHaveAttribute('fill', subjectOf('banyan').page)
    unmountBanyan()

    // The two subjects must actually differ — a Card that painted every
    // subject the same page would pass each assertion above on its own.
    expect(subjectOf('lotus').page).not.toBe(subjectOf('banyan').page)
  })

  it('defaults to the app\'s own page when a caller names no subject', () => {
    const { container } = render(<Card><circle cx="60" cy="60" r="10" /></Card>)
    expect(pageRect(container)).toHaveAttribute('fill', DEFAULT_SUBJECT.page)
  })

  it('falls back the same way for a subject nobody coloured', () => {
    const { container } = render(<Card subject="unicorn"><circle cx="60" cy="60" r="10" /></Card>)
    expect(pageRect(container)).toHaveAttribute('fill', DEFAULT_SUBJECT.page)
  })

  it('keeps every subject in SUBJECTS painted from the mirrored art palette', () => {
    // Every colour subject.ts hands out is meant to be one of PALETTE's own
    // values, never a hex it invented — this is what would catch a subject
    // that drifted from the palette test's own mirror.
    const allowed = new Set(Object.values(PALETTE))
    for (const [name, { page, ink, accent }] of Object.entries(SUBJECTS)) {
      expect(allowed, `${name}.page (${page}) is not in PALETTE`).toContain(page)
      expect(allowed, `${name}.ink (${ink}) is not in PALETTE`).toContain(ink)
      expect(allowed, `${name}.accent (${accent}) is not in PALETTE`).toContain(accent)
    }
  })

  it('draws its rule in the subject\'s own ink, not the page it sits on', () => {
    const { container } = render(<Card subject="tiger"><circle cx="60" cy="60" r="10" /></Card>)
    const rects = container.querySelector('svg.cue-art')!.querySelectorAll(':scope > rect')
    const rule = rects[rects.length - 1]
    expect(rule).toHaveAttribute('stroke', subjectOf('tiger').ink)
    expect(rule).toHaveAttribute('vector-effect', 'non-scaling-stroke')
  })
})
