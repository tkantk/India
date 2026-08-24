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
 * The two phone rows are kept even though the app is iPad-only by ruling
 * (see docs/handover.md) — so a regression in them still shows on a run,
 * not because either gate targets a phone.
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
