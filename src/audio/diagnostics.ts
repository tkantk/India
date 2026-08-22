import { createElement, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { getNarrator } from './Narrator'

/**
 * A read-only, on-device readout of what the audio clock is actually doing —
 * built because the reported symptom ("Tap to carry on" appearing, pausing
 * unreliable) is produced by at least four different open WebKit bugs, and
 * only the real device can say which one is firing.
 *
 * THIS OBSERVES. IT NEVER REPAIRS. Nothing here calls `resume()`,
 * `suspend()` or `stop()` — a probe that nudged the engine back to health
 * would destroy the very evidence it exists to collect. Task 2 does the
 * repair, once this readout has said which bug it is.
 *
 * Surfaced behind `#/?debug=audio` — a query the child cannot reach by
 * tapping — and mounted in `GrandTour.tsx`. Task 12 deletes this file once
 * the repair is verified; it is scaffolding, not a feature.
 */

/** One `statechange` event the context actually fired. */
type StateChange = { state: string; at: number }

export type DiagnosticSnapshot = {
  /** Raw `ctx.state`, never coerced. */
  state: string
  /** Raw `ctx.currentTime`, in seconds. */
  currentTime: number
  /** (currentTime advance) minus (wall-clock advance, in seconds) over the
   *  last trusted sample window. Near zero on a healthy clock; a large
   *  negative number when the audio clock has stalled while real time kept
   *  moving. */
  wallDelta: number
  /**
   * Whether the audio clock is actually moving, judged ONLY by comparing
   * `currentTime` against `performance.now()` across a sample window.
   *
   * Deliberately never reads `ctx.state`: the entire point of this task is
   * that WebKit bugs 263627 and 283419 both report `state === "running"`
   * while `currentTime` sits frozen. A liveness check that trusted `state`
   * would report "fine" for the exact failure this panel exists to catch.
   */
  clockAdvancing: boolean
  /** The last three `statechange` events the context has fired, oldest
   *  first. An empty array after the tour has been running a while is
   *  itself a finding — bug 283419 fires none at all. */
  lastStateChanges: StateChange[]
  /** `null` before any `resumeContext()` call this session; `false` from
   *  the moment one starts until it settles; `true` once it has. Bug 281566
   *  is a `resume()` promise that never settles, which leaves this at
   *  `false` for good. */
  lastResumeSettled: boolean | null
  /** Milliseconds since the most recent `resumeContext()` call started.
   *  Frozen once it settles; still counting up while `lastResumeSettled` is
   *  `false`, which is exactly what makes a hung promise visible on screen.
   *  `null` before the first call. */
  lastResumeMs: number | null
  /** `Narrator.stuck` — the same flag that drives "Tap to carry on". */
  stuck: boolean
  /** `Narrator.playing`. */
  playing: boolean
}

/** How long a sample window must span, in wall-clock milliseconds, before
 *  its delta is trusted. Below this, the poll's own jitter — a GC pause, a
 *  slow frame — could make a perfectly healthy clock read as frozen for one
 *  tick. `audioDiagnostics()` is polled at roughly 4 Hz (see
 *  `AudioDebugPanel`), so this is a few polls' worth of patience. */
const SAMPLE_WINDOW_MS = 1000

/** Below this many seconds of `currentTime` advance across a trusted
 *  window, the clock reads as not advancing. Not zero: a context that is
 *  genuinely running is never this close to it, and a hair of tolerance
 *  keeps ordinary scheduling jitter from reading as "frozen". */
const ADVANCING_EPS_SEC = 0.05

/**
 * Sampling state for `wallDelta`/`clockAdvancing`, kept at module scope
 * because `audioDiagnostics()` is a zero-argument function polled
 * repeatedly by the panel — there is nowhere else for "the previous sample"
 * to live. This mirrors `Narrator`'s own module-scoped singleton: one page,
 * one clock being watched.
 */
let lastSample: { ctxTime: number; wallTime: number } | null = null
let wallDelta = 0
let clockAdvancing = true

/** The one and only diagnostic read. Takes nothing, reaches the engine
 *  through `getNarrator()`, and touches none of its transport methods. */
export function audioDiagnostics(): DiagnosticSnapshot {
  const n = getNarrator()
  const wallTime = performance.now()
  const ctxTime = n.diagCurrentTime

  if (lastSample === null) {
    lastSample = { ctxTime, wallTime }
  } else if (wallTime - lastSample.wallTime >= SAMPLE_WINDOW_MS) {
    const ctxDelta = ctxTime - lastSample.ctxTime
    const wallDeltaSec = (wallTime - lastSample.wallTime) / 1000
    wallDelta = ctxDelta - wallDeltaSec
    clockAdvancing = ctxDelta > ADVANCING_EPS_SEC
    lastSample = { ctxTime, wallTime }
  }

  return {
    state: n.diagState,
    currentTime: ctxTime,
    wallDelta,
    clockAdvancing,
    lastStateChanges: n.diagStateChanges,
    lastResumeSettled: n.diagResumeSettled,
    lastResumeMs: n.diagResumeMs,
    stuck: n.stuck,
    playing: n.playing,
  }
}

/** How often the panel repaints. Roughly 4 Hz: fast enough that a human
 *  watching it can see the readout change within a beat, slow enough that
 *  re-rendering the panel could never be mistaken for the frame-rate timing
 *  bug it exists to observe. See `AudioDebugPanel` for why this drives the
 *  DOM through a ref instead of React state. */
const POLL_MS = 250

/**
 * `?debug=audio`, read straight off `window.location.hash` rather than
 * through react-router's `useSearchParams()`.
 *
 * Under `HashRouter` (`src/main.tsx`), `#/?debug=audio` really does put the
 * query where `useSearchParams()` would find it — verified directly against
 * this app's router setup, not assumed. But `GrandTour`, where this panel is
 * mounted, is unit-tested without a `<Router>` ancestor at all
 * (`GrandTour.test.tsx`, `GrandTour.map.test.tsx`), and `useSearchParams()`
 * throws outside one ("useLocation() may be used only in the context of a
 * <Router> component"). Parsing the hash by hand gets the same answer under
 * `HashRouter` in production without adding a Router dependency to a panel
 * that fourteen-plus existing tests mount with none — and keeps this file
 * free to run without a `<Router>` wrapper in its own tests too.
 */
function debugFlagOn(): boolean {
  const hash = window.location.hash
  const q = hash.indexOf('?')
  if (q === -1) return false
  return new URLSearchParams(hash.slice(q)).get('debug') === 'audio'
}

function formatChange(c: StateChange): string {
  return `  ${c.state.padEnd(11)} @ ${c.at.toFixed(0)}ms`
}

function formatResume(s: DiagnosticSnapshot): string {
  if (s.lastResumeSettled === null) return 'not yet attempted'
  const ms = s.lastResumeMs === null ? '?' : s.lastResumeMs.toFixed(0)
  return s.lastResumeSettled ? `settled in ${ms}ms` : `PENDING for ${ms}ms — promise has not settled`
}

/** Renders `DiagnosticSnapshot` as the panel's plain-text body. Exported
 *  separately from the polling loop so the formatting itself is testable
 *  without a timer. */
export function formatSnapshot(s: DiagnosticSnapshot): string {
  const changes = s.lastStateChanges.length
    ? s.lastStateChanges.map(formatChange).join('\n')
    : '  (none seen)'
  return [
    'audio debug  (#/?debug=audio)',
    `state         ${s.state}`,
    `currentTime   ${s.currentTime.toFixed(3)}s`,
    `clockAdvancing ${s.clockAdvancing}  (wallDelta ${s.wallDelta.toFixed(3)}s)`,
    `stuck         ${s.stuck}`,
    `playing       ${s.playing}`,
    `resume()      ${formatResume(s)}`,
    'last statechange events:',
    changes,
  ].join('\n')
}

const PANEL_STYLE = {
  position: 'fixed',
  top: 0,
  right: 0,
  zIndex: 999999,
  margin: 0,
  padding: '6px 8px',
  maxWidth: '40vw',
  background: 'rgba(0, 0, 0, 0.75)',
  color: '#0f0',
  font: '10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre-wrap',
  // Scaffolding, not a feature: it must never be able to catch a tap meant
  // for the map or the transport underneath it.
  pointerEvents: 'none',
} as const

/**
 * The `?debug=audio` readout. Renders nothing at all unless the flag is
 * present — checked once per render, not reactively, since the flag is
 * reached only by typing a URL and this app never navigates within itself
 * in a way that would flip it mid-session.
 *
 * ON THE UPDATE RATE: this deliberately does NOT re-render on every audio
 * frame. Driving it from React state at animation-frame rate would mean
 * re-rendering the whole tour 60 times a second just to show a debug panel
 * — perturbing the very timing this panel exists to observe without
 * disturbing. Instead it polls `audioDiagnostics()` on a plain interval
 * (`POLL_MS`, ~4 Hz) and writes the result straight into the DOM through a
 * ref, so the tour's own render path — and the audio graph underneath it —
 * is completely untouched by the act of watching it.
 */
export function AudioDebugPanel(): ReactElement | null {
  const on = debugFlagOn()
  const ref = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!on) return
    const paint = () => {
      const el = ref.current
      if (!el) return
      el.textContent = formatSnapshot(audioDiagnostics())
    }
    paint()
    const id = setInterval(paint, POLL_MS)
    return () => clearInterval(id)
  }, [on])

  if (!on) return null

  // `createElement`, not JSX: this file is `diagnostics.ts`, verbatim per
  // the brief, and JSX syntax does not parse in a `.ts` file.
  return createElement('pre', { ref, style: PANEL_STYLE })
}
