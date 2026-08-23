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
 * The measurement runs whatever that setting says, because the setting can be
 * withdrawn and nothing would think to start the probe again afterwards.
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

/**
 * The longest gap that counts as a frame at all.
 *
 * A background tab throttles rAF to about 1 Hz and a hidden one stops it
 * altogether, so a session that starts with the child switching apps would
 * otherwise hand back a median of a thousand milliseconds and latch a fast
 * iPad into cheap mode for good. Anything past this is not a slow device, it
 * is a device that was not being looked at, and it is dropped rather than
 * counted. The threshold sits far above anything real hardware does — 250 ms
 * is 4 fps, and a device at 5 fps still latches cheap on its own evidence.
 *
 * Dropping rather than restarting is also self-healing: a throttled stretch
 * collects no samples, so the probe simply keeps watching until the frames
 * that mean something arrive.
 */
const MAX_SAMPLE_MS = 250

/** The measured verdict, once it exists. Never goes back to false. */
let slow = false
let decided = false
let watching = false

/** The median rAF delta, in ms, from the sample window that produced `slow`.
 *  Kept only so `cheapModeDiagnostics()` can show *why* the probe latched
 *  what it latched — `isCheap()` itself never reads this, only `slow`.
 *  `null` until `decided`. */
let medianFrameMs: number | null = null

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
  // Deliberately measured even when the child has already asked for less
  // motion. That is a setting, and a setting can be turned off mid-session —
  // at which point the app needs a real answer about the hardware, and there
  // is nothing that would think to restart the probe to get one.
  const raf = globalThis.requestAnimationFrame
  if (typeof raf !== 'function') return
  watching = true

  const deltas: number[] = []
  let first = 0
  let last = 0
  let started = false

  const tick = (now: number) => {
    // The gap either side of the first frame is startup, not steady state.
    if (started) {
      const delta = now - last
      if (delta <= MAX_SAMPLE_MS) deltas.push(delta)
    } else {
      first = now
      started = true
    }
    last = now

    if (now - first >= PROBE_MS && deltas.length >= MIN_SAMPLES) {
      deltas.sort((a, b) => a - b)
      // The median, not the mean: one garbage-collection pause is not a slow
      // iPad, and one stall must not sentence a fast one.
      medianFrameMs = deltas[deltas.length >> 1]
      slow = medianFrameMs > SLOW_FRAME_MS
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

/** Read-only view of what `isCheap()` just answered and *why* — built for
 *  the `?debug=audio` panel, which needs to tell "the probe latched slow"
 *  apart from "the probe hasn't decided yet", and both of those apart from
 *  the live, never-latched reduced-motion setting that can also make
 *  `isCheap()` true on hardware that measured fine. Never called by
 *  `isCheap()` itself, and reads no state it does not already hold —
 *  watching this cannot change the verdict. */
export type CheapModeDiagnostics = {
  /** `isCheap()`'s own answer, unchanged. */
  cheap: boolean
  /** Whether the frame probe has latched a verdict yet. While this is
   *  `false`, `slow` reads `false` too, but that is "not measured yet", not
   *  "measured fast" — the panel must show the two differently. */
  decided: boolean
  /** The latched hardware verdict. Meaningless while `decided` is `false`. */
  slow: boolean
  /** The live `prefers-reduced-motion` setting, read fresh — the other half
   *  of `isCheap()`, and the one that never latches. */
  prefersReducedMotion: boolean
  /** The median rAF delta, in ms, from the window that produced `slow`.
   *  `null` until `decided`. */
  medianFrameMs: number | null
}

export function cheapModeDiagnostics(): CheapModeDiagnostics {
  return {
    cheap: isCheap(),
    decided,
    slow,
    prefersReducedMotion: prefersLessMotion(),
    medianFrameMs,
  }
}
