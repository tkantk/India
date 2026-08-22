import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
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

/**
 * The clamp, on its own.
 *
 * `Math.min(target, ...)` in Counter is invisible to every test above,
 * because Motion's `easeOut` never overshoots numerically: delete the clamp
 * and all six still pass. It is there for the easing nobody has chosen yet —
 * a spring, an `backOut` — and the day someone chooses one, a child counting
 * along with the narrator would hear "twenty-eight" and see 29.
 *
 * So this drives the counter's own onUpdate with a value an overshooting
 * easing really would hand it, through the real component.
 */
describe("the counter's clamp", () => {
  it('never shows a number past the target, whatever the easing hands it', async () => {
    let onUpdate: ((v: number) => void) | undefined
    vi.resetModules()
    vi.doMock('motion/react', async () => {
      const actual = await vi.importActual<typeof import('motion/react')>('motion/react')
      return {
        ...actual,
        animate: (_from: number, _to: number, opts: { onUpdate?: (v: number) => void }) => {
          onUpdate = opts.onUpdate
          return { stop: () => {} }
        },
      }
    })

    try {
      const { Counter } = await import('./Counter')
      const { container } = render(<Counter to={28} durationMs={1000} />)
      expect(onUpdate, 'the counter never started an animation').toBeTypeOf('function')

      // What a springy easing does on its way to 28.
      act(() => onUpdate!(29.7))
      expect(container.textContent).toBe('28')
      act(() => onUpdate!(28.4))
      expect(container.textContent).toBe('28')
      // And it still counts on the way up.
      act(() => onUpdate!(12.6))
      expect(container.textContent).toBe('13')
    } finally {
      vi.doUnmock('motion/react')
      vi.resetModules()
    }
  })
})
