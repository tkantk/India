import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { Counter } from './Counter'

/**
 * The counter is the one effect with real logic, and the one a child is
 * invited to join in with ("Count them with me"). Everything here is about
 * the NUMBER being right — the ticking is decoration.
 */
describe('Counter', () => {
  it('counts from one up to the target', async () => {
    render(<Counter to={28} durationMs={100} />)
    await waitFor(() => expect(screen.getByText('28')).toBeInTheDocument())
  })

  it('shows whole numbers only, never a decimal', async () => {
    const { container } = render(<Counter to={24} durationMs={100} />)
    await waitFor(() => expect(container.textContent).toMatch(/^\d+$/))
  })

  it('lands exactly on the target and stops', async () => {
    render(<Counter to={8} durationMs={50} />)
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('jumps straight to the target under reduced motion', () => {
    // The number is the information; the ticking is decoration.
    render(
      <MotionConfig reducedMotion="always">
        <Counter to={28} durationMs={5000} />
      </MotionConfig>,
    )
    expect(screen.getByText('28')).toBeInTheDocument()
  })

  it('never counts past the target on the way up', async () => {
    // A child counting along with the narrator hears "twenty-eight" once. An
    // easing that overshoots and settles back would show 29 for two frames.
    const { container } = render(<Counter to={28} durationMs={120} />)
    const seen: number[] = []
    await waitFor(() => {
      seen.push(Number(container.textContent))
      expect(screen.getByText('28')).toBeInTheDocument()
    })
    expect(Math.max(...seen)).toBeLessThanOrEqual(28)
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(1)
  })

  it('shows something sensible for a target it was never meant to get', () => {
    // The argument comes off authored content as a string. cues.ts guarantees
    // nothing about it, and a NaN on stage is worse than no counter at all.
    const { container } = render(<Counter to={Number('twenty-eight')} durationMs={50} />)
    expect(container.textContent).not.toMatch(/nan/i)
  })
})
