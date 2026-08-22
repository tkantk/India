import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import type { Clip, Cue } from '../src/types'

/**
 * The engine, faithfully — the same double the other screen tests use. The
 * credits route renders none of it, but `/` does, and a route test that
 * cannot mount `/` proves nothing about routing.
 */
const narrator = {
  playing: false,
  stuck: false,
  onCue: (() => {}) as (cue: Cue) => void,
  onEnd: null as (() => void) | null,
  play: vi.fn(async (_clip: Clip) => {}),
  pause: vi.fn(), resume: vi.fn(), replay: vi.fn(), stop: vi.fn(),
  prefetch: vi.fn(async (_clips: Clip[]) => {}), evict: vi.fn((_clips: Clip[]) => {}),
  sfx: vi.fn(async () => {}), ambient: vi.fn(async () => {}),
  setRate: vi.fn(), setVolume: vi.fn(),
  unlock: vi.fn(async () => {}),
  resumeContext: vi.fn(async () => true),
  subscribe: (_fn: () => void) => () => {},
  getSnapshot: () => -1,
}
vi.mock('./audio/Narrator', () => ({ getNarrator: () => narrator }))

const at = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

describe('routing', () => {
  it('serves the credits page at /credits', () => {
    // The whole point of the route: a deep link an adult — or a licensor —
    // can be handed. Under HashRouter in production that is #/credits.
    at('/credits')
    expect(screen.getByRole('heading', { level: 1, name: /credits and licences/i }))
      .toBeVisible()
  })

  it('still opens on the start gate', () => {
    at('/')
    expect(screen.getByRole('button', { name: /tap here to begin/i })).toBeVisible()
  })
})
