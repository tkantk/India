import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
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

  /**
   * THE COVER'S THREE PHASES, as structure rather than as behaviour.
   *
   * The tests above already exercise the transitions (tap begin, answer yes,
   * answer no) but only ever check the one button or line of text each is
   * about. These check what a whole phase actually puts on screen, and that
   * the PREVIOUS phase's markup is gone rather than merely covered — a
   * regression that left the cover's bird or greeting sitting behind the
   * question would pass every existing assertion here.
   */
  it('phase one is the cover: greeting, the peacock, and nothing else', () => {
    const { container } = render(
      <StartGate onReady={vi.fn()} unlock={async () => {}} playTestSound={async () => {}} />
    )
    expect(screen.getByText('नमस्ते')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /namaste/i })).toBeInTheDocument()
    expect(container.querySelector('.gate__bird')).toBeTruthy()
    expect(screen.getByRole('button', { name: /begin/i })).toBeInTheDocument()
    // Nothing from either later phase has arrived yet.
    expect(container.querySelector('.row')).toBeNull()
    expect(screen.queryByRole('heading', { name: /did you hear/i })).toBeNull()
  })

  it('phase two asks the question and retires the cover', async () => {
    const { container } = render(
      <StartGate onReady={vi.fn()} unlock={async () => {}} playTestSound={async () => {}} />
    )
    await userEvent.click(screen.getByRole('button', { name: /begin/i }))

    expect(screen.getByRole('heading', { name: /did you hear that/i })).toBeInTheDocument()
    const answers = container.querySelectorAll('.row .tap.answer')
    expect(answers).toHaveLength(2)
    expect(screen.getByRole('button', { name: /yes, i heard it/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /no, it was quiet/i })).toBeInTheDocument()
    // The cover is gone, not merely hidden behind the question.
    expect(screen.queryByText('नमस्ते')).toBeNull()
    expect(container.querySelector('.gate__bird')).toBeNull()
    expect(screen.queryByRole('button', { name: /^tap here to begin$/i })).toBeNull()
    // And the silent phase's own extras have not arrived yet either.
    expect(container.querySelector('.help')).toBeNull()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('phase three adds the silent-phone help without dropping the question', async () => {
    const { container } = render(
      <StartGate onReady={vi.fn()} unlock={async () => {}} playTestSound={async () => {}} />
    )
    await userEvent.click(screen.getByRole('button', { name: /begin/i }))
    await userEvent.click(screen.getByRole('button', { name: /no, it was quiet/i }))

    expect(container.querySelector('.help')).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    // Still on the question, not a fourth screen.
    expect(screen.getByRole('heading', { name: /did you hear that/i })).toBeInTheDocument()
    expect(container.querySelectorAll('.row .tap.answer')).toHaveLength(2)
  })

  /**
   * THE BEGIN BUTTON'S 104PX FLOOR.
   *
   * jsdom does no layout — see IndiaScreen.test.tsx's own note on why this
   * file has no test that measures a computed box. What IS checkable here is
   * the CONTRACT the real size is built from: `.tap` is the class that
   * carries `min-width`/`min-height: var(--tap)` in base.css (104px, guarded
   * by shell.test.ts), and startGate.css's own comment is explicit that the
   * selector has to be the COMPOUND `.tap.begin` — Vite does not bundle CSS
   * in import order, and a plain `.begin { ... }` would win in dev and lose
   * in the production stylesheet. So: the button carries both classes, and
   * the stylesheet actually sizes that compound selector off the shared
   * token rather than a number it invented. `npm run tour:strip` is what
   * proves the resulting box is really 104px or more, on a real render.
   */
  it('gives the begin button the compound classes its size is built from', () => {
    render(<StartGate onReady={vi.fn()} unlock={async () => {}} playTestSound={async () => {}} />)
    const begin = screen.getByRole('button', { name: /begin/i })
    expect(begin.classList.contains('tap')).toBe(true)
    expect(begin.classList.contains('begin')).toBe(true)
  })

  it('sizes the begin button off the shared tap token, not a number of its own', () => {
    const css = readFileSync('src/screens/startGate.css', 'utf8')
    const rule = css.match(/\.tap\.begin\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(rule, 'no .tap.begin rule found').not.toBe('')
    expect(rule).toMatch(/min-width:\s*var\(--big\)/)
    expect(rule).toMatch(/min-height:\s*var\(--big\)/)
    const baseCss = readFileSync('src/styles/base.css', 'utf8')
    // --big is two tap targets across (base.css), so the begin button's
    // floor is never less than the 104px --tap itself guarantees everywhere
    // else.
    expect(baseCss).toMatch(/--big:\s*calc\(var\(--tap\)\s*\*\s*2\)/)
  })
})
