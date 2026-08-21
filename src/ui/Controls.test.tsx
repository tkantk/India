import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Controls } from './Controls'

const narrator = {
  playing: true, pause: vi.fn(), resume: vi.fn(), replay: vi.fn(),
  setRate: vi.fn(), setVolume: vi.fn(), stuck: false,
}
vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

describe('Controls', () => {
  it('labels every control with a word, not only a symbol', () => {
    render(<Controls />)
    for (const name of [/pause|play/i, /again/i, /slower|normal/i, /sound/i, /home/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('gives every control the full child-sized tap target', () => {
    render(<Controls />)
    for (const b of screen.getAllByRole('button')) expect(b.className).toContain('tap')
  })

  it('says it again without restarting the whole tour', async () => {
    render(<Controls />)
    await userEvent.click(screen.getByRole('button', { name: /again/i }))
    expect(narrator.replay).toHaveBeenCalledOnce()
  })

  it('slows down and says so in words', async () => {
    render(<Controls />)
    await userEvent.click(screen.getByRole('button', { name: /slower/i }))
    expect(narrator.setRate).toHaveBeenCalledWith(0.85)
    expect(screen.getByRole('button', { name: /normal speed/i })).toBeInTheDocument()
  })

  it('offers a way out when the audio context is stuck', () => {
    render(<Controls />)
    expect(screen.queryByRole('button', { name: /carry on/i })).not.toBeInTheDocument()
    narrator.stuck = true
    render(<Controls />)
    expect(screen.getByRole('button', { name: /carry on/i })).toBeInTheDocument()
    narrator.stuck = false
  })
})
