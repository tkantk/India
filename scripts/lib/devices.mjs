/**
 * WHAT A REAL DEVICE ACTUALLY GIVES A WEB PAGE.
 *
 * The single list of real-device viewports both layout gates measure
 * against — `tour-strip.mjs` (the tour) and `place-strip.mjs` (a state's own
 * page). It used to live only in `tour-strip.mjs`; Task 1b of the state-
 * screens plan pulled it out here rather than typing a second copy, because
 * two independent copies of a viewport list is how they drift apart without
 * anyone noticing until a device is missing from one gate and not the other.
 *
 * No iPad sold this decade is 768x1024, and NONE of them ever hands a page
 * its full point size in Safari, because the URL bar and the tab bar are
 * above it. An iPad Air 11" is 820x1180 points; open a tab in Safari and the
 * page gets 820x1024 or, with the tab bar showing, 820x984. Those hundred
 * and fifty missing pixels are exactly the ones a layout can quietly spend
 * without anyone noticing on the standalone-height number.
 *
 * So every iPad appears twice: the standalone height (added to Home Screen,
 * no chrome) and the Safari height (a tab, with chrome). The Safari rows are
 * the ones that fail; the standalone rows are why nobody notices.
 *
 * THE TWO PHONE ROWS ARE NO LONGER A REGRESSION-ONLY AFTERTHOUGHT.
 * `docs/handover.md` used to rule this app iPad-only; it no longer does —
 * see that document's own record of why the original ruling was wrong (it
 * was made by looking at the map screen, before the place screen existed).
 * Both gates that import this file now measure both rows for real: every
 * place must render on a 390px and a 375px phone exactly as strictly as it
 * must on an iPad. Together they satisfy the two shapes a real phone
 * ships in — a small width (either row sits inside the common 360-390px
 * band) and, between them, the taller of the two (`'phone'`, 844 against
 * `'small phone'`'s 812).
 *
 * PHONE LANDSCAPE IS DELIBERATELY NOT HERE. A phone on its side in this
 * size class is roughly 390x844 rotated, i.e. about 844 WIDE and 390 TALL
 * — wide enough to miss `place.css`'s own `max-width: 600px` phone rule
 * entirely, and short enough (390px) to fail the existing tablet-landscape
 * rule's own `min-width: 900px` floor too, so it would fall through to
 * neither of this app's two hand-measured layouts and land on whichever one
 * the cascade happens to leave standing — not a state anyone has designed
 * for. Building a genuine third layout for it is real, separate work this
 * round did not scope; it is carried, not silently dropped — see
 * docs/handover.md.
 */
export const DEVICES = [
  ['phone', 390, 844],
  ['small phone', 375, 812],
  ['iPad mini standalone', 744, 1133],
  ['iPad mini Safari', 744, 977],
  ['iPad Air 11 standalone', 820, 1180],
  ['iPad Air 11 Safari', 820, 1024],
  ['iPad Air 11 Safari + tabs', 820, 984],
  ['iPad Air 11 Safari landscape', 1180, 704],
  ['iPad Pro 13 Safari', 1024, 1210],
  ['iPad Pro 13 Safari landscape', 1366, 868],
  // The two the tour gate has always run. Kept so a regression in them still
  // shows, not because anything sold today is this shape.
  ['legacy iPad portrait', 768, 1024],
  ['legacy iPad landscape', 1024, 768],
]
