import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadAlong } from './ReadAlong'

const CLIP = {
  audio: 'a.m4a', duration: 3,
  words: ['The', 'tiger', 'growls.'], starts: [0, 1, 2], ends: [1, 2, 3], cues: [],
}

vi.mock('../audio/useNarration', () => ({ useCurrentWord: () => 1 }))

describe('ReadAlong', () => {
  it('shows every word of the sentence', () => {
    render(<ReadAlong clip={CLIP} />)
    expect(screen.getByText('The')).toBeInTheDocument()
    expect(screen.getByText('tiger')).toBeInTheDocument()
    expect(screen.getByText('growls.')).toBeInTheDocument()
  })

  it('marks exactly one word as current', () => {
    const { container } = render(<ReadAlong clip={CLIP} />)
    const lit = container.querySelectorAll('[data-current="true"]')
    expect(lit).toHaveLength(1)
    expect(lit[0].textContent).toBe('tiger')
  })

  it('reads as one sentence to a screen reader rather than a pile of words', () => {
    render(<ReadAlong clip={CLIP} />)
    expect(screen.getByRole('paragraph')).toHaveTextContent('The tiger growls.')
  })

  it('renders nothing rather than crashing when there is no clip', () => {
    const { container } = render(<ReadAlong clip={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
