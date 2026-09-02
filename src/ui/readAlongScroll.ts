/**
 * Deciding whether the read-along caption needs to move to keep the lit
 * word on screen, and where to put it if so — split out from `ReadAlong.tsx`
 * itself so the decision is a plain function of numbers, testable without a
 * real browser laying out real text (jsdom does no layout at all; see
 * `scripts/place-strip.mjs` for the real evidence this logic is checked
 * against, in a real browser, at a real fold).
 *
 * PAGING, NOT CRAWLING. A continuous `scrollIntoView` on every word tick —
 * nudging the box by a few pixels several times a second — is the obvious
 * way to keep a word on screen, and it is not the one this project chose.
 * `place.css`'s own phone rule already reserves a SHORT lane (`--say-lines:
 * 6`) and lets the two long outliers (an intro up to sixteen lines) scroll
 * rather than paying for the true worst case up front — the same "short
 * case in the lane, overflow handled separately" shape this file continues.
 * A six-year-old tracking a word that is CONSTANTLY sliding has to re-find
 * it every frame; a box that sits still for several lines and then cuts
 * cleanly to the next page only asks him to find it again a handful of
 * times per sentence, at moments when the whole page changes anyway. So:
 * `pagedScrollTop` only ever answers "yes, move" when the lit word has
 * actually left the visible window (above OR below it — a rewind, replaying
 * from the top, can leave the window scrolled past word one), and when it
 * does, the target lands that word near the TOP of a freshly revealed page
 * — not nudged up by one line, not centred — so most of a page is read
 * perfectly still.
 */

/** A little headroom above the paged word, so a fresh page does not start
 *  with its first line flush against the very top edge of the visible
 *  box — the same breathing room `:where(.say)`'s own `padding: 10px 16px`
 *  (base.css) gives the true first line of the whole caption, kept here so
 *  every SUBSEQUENT page reads the same way rather than only the first one. */
const PAGE_LEAD_PX = 8

export type ScrollGeometry = {
  /** The lit word's own top and bottom, in the SCROLLER's content
   *  coordinates — unaffected by its current scroll position. In the
   *  browser: `wordRect.top - scrollerRect.top + scroller.scrollTop` (and
   *  the same for `bottom`), not `word.offsetTop`, which is relative to
   *  whichever `offsetParent` the word happens to have, not necessarily the
   *  scrolling ancestor. */
  wordTop: number
  wordBottom: number
  /** The scroller's own current `scrollTop`. */
  scrollTop: number
  /** The scroller's own `clientHeight` — how much of its content is ever
   *  visible at once. */
  viewHeight: number
  /** The scroller's own `scrollHeight` — the full height of its content,
   *  scrolled or not. */
  scrollHeight: number
}

/**
 * `null` when the lit word is already fully inside the visible window — the
 * common case for most of a sentence, and the whole reason this never
 * crawls. Otherwise the `scrollTop` that puts it near the top of a fresh
 * page, clamped to what the scroller can actually reach (the same "measure
 * the REACHABLE position, never the unscrolled one" reasoning
 * `place-strip.mjs`'s own shelf check already applies to the tile shelf).
 */
export function pagedScrollTop(geometry: ScrollGeometry): number | null {
  const { wordTop, wordBottom, scrollTop, viewHeight, scrollHeight } = geometry
  const viewBottom = scrollTop + viewHeight
  const alreadyVisible = wordTop >= scrollTop && wordBottom <= viewBottom
  if (alreadyVisible) return null

  const maxScrollTop = Math.max(0, scrollHeight - viewHeight)
  return Math.min(maxScrollTop, Math.max(0, wordTop - PAGE_LEAD_PX))
}
