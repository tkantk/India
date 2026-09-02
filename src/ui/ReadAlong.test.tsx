import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { ReadAlong } from './ReadAlong'

const CLIP = {
  audio: 'a.m4a', duration: 3,
  words: ['The', 'tiger', 'growls.'], starts: [0, 1, 2], ends: [1, 2, 3], cues: [],
}

// A mutable module-scope value the mock reads at CALL time (inside a
// component render, always after this whole module has finished
// evaluating), not at mock-factory-definition time — the standard way to
// give a hoisted `vi.mock` a controllable return value across tests.
let currentWord = 1
vi.mock('../audio/useNarration', () => ({ useCurrentWord: () => currentWord }))

beforeEach(() => { currentWord = 1 })

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

/**
 * KEEPING THE LIT WORD ON SCREEN — the DOM-wiring half of `readAlongScroll.
 * ts`'s decision (`pagedScrollTop` itself, the geometry, is unit-tested
 * there directly with plain numbers). jsdom does no layout at all, so every
 * geometry value below is a REAL property on a REAL DOM node, stubbed to a
 * value jsdom would otherwise report as zero — not a hand-built substitute
 * missing a method the real element has (the "test double must be faithful"
 * lesson `docs/handover.md` names eight prior files for). The actual
 * end-to-end evidence that a real phone's real caption follows a real word
 * is `scripts/place-strip.mjs`, in a real browser — see this file's own
 * assertion for that.
 */
describe('ReadAlong scroll-follow', () => {
  /** A words[] long enough to need many "lines" — each word below is given
   *  its own 20px-tall rect (`stubWordRects`), standing in for a wrapped
   *  line of real text. */
  const words = Array.from({ length: 20 }, (_, i) => `w${i}`)
  const LONG_CLIP = {
    audio: 'long.m4a', duration: 20, words,
    starts: words.map((_, i) => i), ends: words.map((_, i) => i + 1), cues: [],
  }

  function rect(top: number, bottom: number) {
    return {
      top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top,
      toJSON() { return this },
    } as DOMRect
  }

  /** Turns a plain wrapper div into a stand-in for `.say-lane`: a real
   *  scrolling ancestor, with real (if jsdom-stubbed) `scrollTop`,
   *  `scrollHeight`, `clientHeight` and `scrollTo` — the actual properties
   *  and methods `Element` carries, just given real numbers jsdom's
   *  non-rendering engine will not compute on its own. */
  function stubScroller(el: HTMLElement, opts: { clientHeight: number; scrollHeight: number }) {
    el.style.overflowY = 'auto'
    Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true })
    let top = 0
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = v },
    })
    el.getBoundingClientRect = () => rect(0, opts.clientHeight)
    el.scrollTo = vi.fn((arg: ScrollToOptions | number) => {
      if (typeof arg === 'object' && typeof arg.top === 'number') top = arg.top
    }) as typeof el.scrollTo
    return el
  }

  /** Every word span gets its own 20px line, stacked top to bottom — stable
   *  across re-renders, since the spans themselves never remount (only
   *  `data-current` changes; see ReadAlong.tsx's own top comment). */
  function stubWordRects(container: HTMLElement) {
    const spans = [...container.querySelectorAll('.word')] as HTMLElement[]
    spans.forEach((s, i) => { s.getBoundingClientRect = () => rect(i * 20, i * 20 + 18) })
  }

  it('does not scroll while the lit word is already inside the visible window', () => {
    currentWord = 0
    const { container, rerender } = render(
      <div><ReadAlong clip={LONG_CLIP} /></div>,
    )
    const scroller = stubScroller(container.firstElementChild as HTMLElement, { clientHeight: 100, scrollHeight: 400 })
    stubWordRects(container)
    // A genuinely DIFFERENT word (still inside the 0..100 window, word 2's
    // line is 40..58) — not the same `current` value re-rendered, which
    // React's own dependency check would skip re-running the effect for at
    // all, proving nothing about the stubbed geometry above.
    currentWord = 2
    rerender(<div><ReadAlong clip={LONG_CLIP} /></div>)
    expect(scroller.scrollTo).not.toHaveBeenCalled()
  })

  it('pages the caption smoothly once the lit word goes below the fold', () => {
    currentWord = 0
    const { container, rerender } = render(
      <div><ReadAlong clip={LONG_CLIP} /></div>,
    )
    const scroller = stubScroller(container.firstElementChild as HTMLElement, { clientHeight: 100, scrollHeight: 400 })
    stubWordRects(container)

    currentWord = 10 // word 10's line: top 200, bottom 218 — well past the 100px window.
    rerender(<div><ReadAlong clip={LONG_CLIP} /></div>)

    expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
    const call = (scroller.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.behavior).toBe('smooth')
    expect(call.top).toBe(200 - 8) // lands near the top of a fresh page, not nudged by one line
  })

  it('jumps instantly, never smoothly, under reduced motion', () => {
    currentWord = 0
    const { container, rerender } = render(
      <MotionConfig reducedMotion="always"><div><ReadAlong clip={LONG_CLIP} /></div></MotionConfig>,
    )
    const scroller = stubScroller(container.firstElementChild as HTMLElement, { clientHeight: 100, scrollHeight: 400 })
    stubWordRects(container)

    currentWord = 10
    rerender(<MotionConfig reducedMotion="always"><div><ReadAlong clip={LONG_CLIP} /></div></MotionConfig>)

    const call = (scroller.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.behavior).toBe('auto')
  })

  it('never snaps back once the child has scrolled the caption himself', () => {
    // `performance.now()` faked, not `setTimeout`/`Date` — the ONE thing
    // this component reads off the wall clock is the 500ms "was that scroll
    // event ours or a finger's" settle window, and a synchronous test
    // otherwise never lets real time pass between two `rerender` calls,
    // which would make every scroll look like it happened inside our own
    // settle window no matter what actually moved it.
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      currentWord = 0
      const { container, rerender } = render(
        <div><ReadAlong clip={LONG_CLIP} /></div>,
      )
      const scroller = stubScroller(container.firstElementChild as HTMLElement, { clientHeight: 100, scrollHeight: 400 })
      stubWordRects(container)

      currentWord = 5 // triggers one auto-page, so `lastCommanded` is set.
      rerender(<div><ReadAlong clip={LONG_CLIP} /></div>)
      expect(scroller.scrollTo).toHaveBeenCalledTimes(1)

      // A finger moves the box to somewhere OTHER than where the code left
      // it — not through `scrollTo`, the same way a real touch-drag would
      // not be — well after our own smooth scroll would have settled.
      vi.advanceTimersByTime(600)
      scroller.scrollTop = 3

      currentWord = 15 // the lit word is now off-screen again...
      rerender(<div><ReadAlong clip={LONG_CLIP} /></div>)

      // ...but the code does not fight the child for the box.
      expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-engages auto-follow on a brand new clip, even after the child took over', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      currentWord = 0
      const { container, rerender } = render(
        <div><ReadAlong clip={LONG_CLIP} /></div>,
      )
      const scroller = stubScroller(container.firstElementChild as HTMLElement, { clientHeight: 100, scrollHeight: 400 })
      stubWordRects(container)

      currentWord = 5
      rerender(<div><ReadAlong clip={LONG_CLIP} /></div>)
      vi.advanceTimersByTime(600)
      scroller.scrollTop = 3 // the child takes over
      currentWord = 15
      rerender(<div><ReadAlong clip={LONG_CLIP} /></div>)
      expect(scroller.scrollTo).toHaveBeenCalledTimes(1) // unchanged: still not fighting him

      // A new page opens — a different clip entirely.
      const OTHER_CLIP = { ...LONG_CLIP, audio: 'other.m4a' }
      currentWord = 0
      rerender(<div><ReadAlong clip={OTHER_CLIP} /></div>)
      stubWordRects(container)
      scroller.scrollTop = 0

      currentWord = 12 // out of view again, on the fresh clip
      rerender(<div><ReadAlong clip={OTHER_CLIP} /></div>)
      expect(scroller.scrollTo).toHaveBeenCalledTimes(2) // auto-follow is back
    } finally {
      vi.useRealTimers()
    }
  })
})
