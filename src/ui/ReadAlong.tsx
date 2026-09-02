import { Fragment, useEffect, useRef } from 'react'
import { useReducedMotionConfig } from 'motion/react'
import type { Clip } from '../types'
import { useCurrentWord } from '../audio/useNarration'
import { pagedScrollTop } from './readAlongScroll'

type Props = {
  clip: Clip | null
}

/**
 * The narrated sentence, with the word being spoken lit up.
 *
 * The lit word comes from `useCurrentWord`, the engine's own clock — never
 * from a `useEffect` keyed on the word index, which would miss a word when
 * two tick in one animation frame and double-fire under StrictMode.
 *
 * Every span shares one static `word` class; only `data-current` changes
 * between renders, so nothing here allocates a style object on the 60Hz
 * word-by-word re-render this component exists for.
 *
 * KEEPING THE LIT WORD ON SCREEN. `place.css`'s own phone rule reserves a
 * SHORT lane (`--say-lines: 6`) for the caption and lets the two real
 * outliers — `festival` at 7 lines, an intro at up to 16 — scroll instead of
 * paying for the true worst case up front (see that file's own note on why:
 * reserving sixteen lines would cost more of a 390px screen than the map is
 * being given). Nobody ever taught the box to follow the word that scrolled
 * off, so a phone reading a long intro loses the highlight for most of every
 * long line — see `readAlongScroll.ts`'s own top comment for the fix and,
 * specifically, why it PAGES rather than crawls. This effect is a no-op on
 * the tour (`GrandTour.tsx`'s `.say` has no scrolling ancestor at all —
 * `--say-lines: 9` there reserves the true worst case, an 8-line beat, so it
 * never overflows) and on every non-phone breakpoint of this screen, by
 * construction: `findScroller` only ever finds something to do when an
 * ancestor is ACTUALLY overflowing, never because of a class name or a
 * screen it recognises.
 *
 * WHAT HAPPENS IF THE CHILD SCROLLS IT HIMSELF. He is allowed to, and
 * nothing here fights him for it — a caption that snaps back under a
 * child's own finger is worse than one that never followed the word at all,
 * because it punishes exactly the re-reading a caption is for. The moment
 * this effect notices the scroller's position no longer matches what it
 * itself last set (`userTookOver`, below), it stops adjusting the scroll
 * position entirely, for the rest of that reading. A fresh reading — a new
 * clip, or the same one replayed from the top (`current` rewinding, which
 * only ever happens on "Say it again") — clears the flag and starts the
 * decision over.
 */
export function ReadAlong({ clip }: Props) {
  const current = useCurrentWord()
  // `useReducedMotionConfig`, never `useReducedMotion` — this project's
  // standing rule (see Trace.tsx, Reveal.tsx's `useStill`). A smooth scroll
  // is motion exactly as much as a transform is; under reduced motion this
  // still moves the box (the word must never actually vanish off-screen),
  // it just jumps there instead of gliding.
  const reduced = useReducedMotionConfig() === true

  const rootRef = useRef<HTMLParagraphElement>(null)
  const userTookOver = useRef(false)
  const lastCommanded = useRef<number | null>(null)
  const settleUntil = useRef(0)
  const prevCurrent = useRef(-1)
  const prevClipKey = useRef<string | null>(null)
  const clipKey = clip?.audio ?? null

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    // A FRESH READING ALWAYS GETS TO TRY AGAIN. A brand new clip, or the
    // exact same one restarted from the top ("Say it again" rewinds
    // `current` down instead of counting up — see `PlaceScreen.tsx`'s
    // `playPause`) both clear whatever the child decided on the page before.
    if (clipKey !== prevClipKey.current || current < prevCurrent.current) {
      userTookOver.current = false
      lastCommanded.current = null
    }
    prevClipKey.current = clipKey
    prevCurrent.current = current

    const scroller = findScroller(root)
    if (!scroller) return

    // DID A FINGER MOVE THIS BOX SINCE WE LAST TOUCHED IT? Checked lazily,
    // right before we would otherwise scroll again — no listener needed.
    // `settleUntil` swallows the scroll events our OWN smooth (or, under
    // reduced motion, instant) scroll produces; anything that moves the
    // scroller outside that short window was a real finger, not us.
    if (
      !userTookOver.current &&
      lastCommanded.current !== null &&
      performance.now() > settleUntil.current &&
      Math.abs(scroller.scrollTop - lastCommanded.current) > 2
    ) {
      userTookOver.current = true
    }
    if (userTookOver.current) return

    const wordEl = root.querySelector('[data-current]') as HTMLElement | null
    if (!wordEl) return

    const wordRect = wordEl.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    const target = pagedScrollTop({
      wordTop: wordRect.top - scrollerRect.top + scroller.scrollTop,
      wordBottom: wordRect.bottom - scrollerRect.top + scroller.scrollTop,
      scrollTop: scroller.scrollTop,
      viewHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
    })
    if (target === null) return

    const now = performance.now()
    scroller.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' })
    lastCommanded.current = target
    // A generous estimate of how long a browser's own smooth scroll takes to
    // settle for a page-sized jump — under reduced motion the scroll is
    // instant, so this only needs to swallow the one resulting `scroll`
    // event, not an animation.
    settleUntil.current = now + (reduced ? 50 : 500)
  }, [current, reduced, clipKey])

  if (!clip) return null

  return (
    <p className="read-along" ref={rootRef}>
      {clip.words.map((word, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="word" data-current={i === current || undefined}>{word}</span>
        </Fragment>
      ))}
    </p>
  )
}

/**
 * The nearest ancestor that can actually scroll its own content, or `null`.
 * A DOM walk rather than a known class name (`.say-lane`) on purpose: this
 * component has never known which screen it is on, and reaching for a
 * specific class here would be the same mistake `grandTour.css`'s own bare
 * `.india` rule made once already (see base.css's note on `:where(.india)`)
 * — a name that happens to be right today and silently wrong the moment a
 * second scrolling caption exists with a different one. `scrollHeight >
 * clientHeight` also means the tour, and every non-phone width of this
 * screen, correctly never finds anything here at all — not a special case,
 * a fact about their layout.
 */
function findScroller(from: HTMLElement): HTMLElement | null {
  let node = from.parentElement
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const overflowY = getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') return node
    }
    node = node.parentElement
  }
  return null
}
