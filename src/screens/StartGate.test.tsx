import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StartGate } from './StartGate'

describe('StartGate', () => {
  it('does not report ready on the first tap alone', async () => {
    const onReady = vi.fn()
    render(<StartGate onReady={onReady} unlock={async () => {}} playTestSound={async () => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /begin/i }))
    // The tap unlocks audio, but we still do not know the iPad is audible.
    expect(onReady).not.toHaveBeenCalled()
  })

  it('reports ready once the child confirms they heard the sound', async () => {
    const onReady = vi.fn()
    render(<StartGate onReady={onReady} unlock={async () => {}} playTestSound={async () => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /begin/i }))
    await userEvent.click(screen.getByRole('button', { name: /yes/i }))
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('offers help rather than dead-ending when the child heard nothing', async () => {
    render(<StartGate onReady={vi.fn()} unlock={async () => {}} playTestSound={async () => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /begin/i }))
    await userEvent.click(screen.getByRole('button', { name: /no/i }))
    // There is no web API to read the mute switch, so the only cure is words.
    expect(screen.getByText(/volume|sound|silent/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByRole('button', { name: /yes/i })).toBeInTheDocument()
  })

  it('unlocks audio synchronously inside the tap handler', async () => {
    const order: string[] = []
    const unlock = vi.fn(async () => { order.push('unlock') })
    render(<StartGate onReady={vi.fn()} unlock={unlock} playTestSound={async () => { order.push('sound') }} />)
    await userEvent.click(screen.getByRole('button', { name: /begin/i }))
    // Unlock must happen before anything awaits, or iOS discards the gesture.
    expect(order).toEqual(['unlock', 'sound'])
  })

  it('gives every button the full child-sized tap target', () => {
    render(<StartGate onReady={vi.fn()} unlock={async () => {}} playTestSound={async () => {}} />)
    for (const b of screen.getAllByRole('button')) {
      expect(b.className).toContain('tap')
    }
  })
})
