/**
 * Is this iPad fast enough for the pretty version?
 *
 * The map has to run on whatever hardware a family already owns, which for a
 * six-year-old is usually the iPad nobody else wanted. An A8X draws the same
 * markup as an M2, so the only honest way to tell them apart is to watch how
 * long a frame actually takes.
 *
 * The answer LATCHES. A camera that decides mid-tour that the hardware got
 * slower, then faster, then slower would change the length of the flight
 * between one tap and the next — and a child notices inconsistency long
 * before they notice 30 fps. So: sample rAF deltas for about two seconds,
 * take the median, decide once, stop sampling.
 *
 * `prefers-reduced-motion` is read live rather than latched, because it is a
 * setting rather than a measurement: a parent who turns it on halfway through
 * means it now.
 *
 * The measurement is started by the app, in `main.tsx`, and never implicitly
 * by whoever asks the question first. A probe that started itself would run
 * under every test that so much as renders the map, and jsdom's own frame
 * clock sits at a median of 18 ms with an occasional 20 — right on the
 * threshold. The suite would then decide, at random, that the test machine
 * was a slow iPad.
 *
 * Nothing here touches `window` by name. `scripts/probe-camera.mjs` loads
 * this module in Node, where there is no window, no matchMedia and no rAF at
 * all, and it must simply answer "not cheap" rather than throw.
 */

/** How long to watch before deciding. Long enough to outlast startup jank. */
const PROBE_MS = 2000

/**
 * How many frames the verdict needs. A backgrounded tab paints a handful of
 * frames in two seconds, and a handful of frames says nothing about the
 * hardware — so it keeps watching rather than convicting on thin evidence.
 */
const MIN_SAMPLES = 24

/**
 * The median frame a device must beat, in milliseconds. 20 ms is 50 fps: a
 * device below that will not hold a 400 ms flight of the whole map, so it
 * gets the 200 ms one and skips the outline draw.
 */
const SLOW_FRAME_MS = 20

/** The measured verdict, once it exists. Never goes back to false. */
let slow = false
let decided = false
let watching = false

/** The child's own setting, read every time. Undefined in Node. */
function prefersLessMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * Start watching the frame clock, once, until there is enough evidence to
 * decide. Idempotent, and a no-op on a host with no rAF — the headless probe
 * loads this module in Node.
 *
 * The timestamp comes from rAF's own argument rather than from a clock we
 * read ourselves: it is the frame's time, which is the thing being measured.
 */
export function startFrameProbe(): void {
  if (decided || watching) return
  // Nothing to measure: the answer is already yes, and it cannot change back.
  if (prefersLessMotion()) return
  const raf = globalThis.requestAnimationFrame
  if (typeof raf !== 'function') return
  watching = true

  const deltas: number[] = []
  let first = 0
  let last = 0
  let started = false

  const tick = (now: number) => {
    // The gap either side of the first frame is startup, not steady state.
    if (started) deltas.push(now - last)
    else {
      first = now
      started = true
    }
    last = now

    if (now - first >= PROBE_MS && deltas.length >= MIN_SAMPLES) {
      deltas.sort((a, b) => a - b)
      // The median, not the mean: one garbage-collection pause is not a slow
      // iPad, and one stall must not sentence a fast one.
      slow = deltas[deltas.length >> 1] > SLOW_FRAME_MS
      decided = true
      watching = false
      return
    }
    raf(tick)
  }

  raf(tick)
}

/**
 * Should the app draw the cheap version?
 *
 * Cheap means: a 200 ms flight instead of 400, no outline draw, no glow
 * layer. It answers false until the probe has enough evidence, which takes
 * about two seconds — so the first thing a child sees is always the good
 * version, and only a device that has actually been caught missing frames
 * gets downgraded.
 */
export function isCheap(): boolean {
  return prefersLessMotion() || slow
}
