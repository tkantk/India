import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Controls } from './Controls'

// The double must be FAITHFUL to the real engine's interface. An incomplete
// double is worse than none: production code gets bent around the gap, and
// the very path the task exists to build ends up untested.
let listeners: (() => void)[] = []
const narrator = {
  playing: true, stuck: false,
  pause: vi.fn(), resume: vi.fn(), replay: vi.fn(),
  setRate: vi.fn(), setVolume: vi.fn(),
  resumeContext: vi.fn(async () => true),
  subscribe: (fn: () => void) => { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn) } },
  emit: () => listeners.forEach(l => l()),
}
vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

/** Controls calls useNavigate(), so it must always be inside a Router. */
const mount = () => render(<MemoryRouter><Controls /></MemoryRouter>)

describe('Controls', () => {
  it('labels every control with a word, not only a symbol', () => {
    mount()
    for (const name of [/pause|play/i, /again/i, /slower|normal/i, /sound/i, /home/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('gives every control the full child-sized tap target', () => {
    mount()
    for (const b of screen.getAllByRole('button')) expect(b.className).toContain('tap')
  })

  it('says it again without restarting the whole tour', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: /again/i }))
    expect(narrator.replay).toHaveBeenCalledOnce()
  })

  it('slows down and says so in words', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: /slower/i }))
    expect(narrator.setRate).toHaveBeenCalledWith(0.85)
    expect(screen.getByRole('button', { name: /normal speed/i })).toBeInTheDocument()
  })

  it('offers a way out when the audio context gets stuck, without a re-mount', async () => {
    // The engine's visibilitychange handler can flip `stuck` with no user
    // action at all, so the bar must react to the subscription — not to being
    // mounted again. Mounting twice would pass even against a polled design.
    mount()
    expect(screen.queryByRole('button', { name: /carry on/i })).not.toBeInTheDocument()
    await act(async () => { narrator.stuck = true; narrator.emit() })
    expect(screen.getByRole('button', { name: /carry on/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /carry on/i }))
    expect(narrator.resumeContext).toHaveBeenCalled()
    narrator.stuck = false
  })
})
