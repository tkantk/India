import { createElement, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { getNarrator } from './Narrator'
import { cheapModeDiagnostics } from '../lib/cheapMode'
import type { CheapModeDiagnostics } from '../lib/cheapMode'

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
 * tapping — and mounted in `GrandTour.tsx`. It is scaffolding, not a
 * feature, and deleting it is a one-line change (drop this file, its test,
 * the `<AudioDebugPanel />` mount and `recordTapRejection` call) — but NOT
 * YET: as of Plan 5 Task 6, nobody has read what this panel says on the
 * father's own iPad. `docs/handover.md` lists the three open questions only
 * a device readout can answer; delete this file once they are, and not
 * before.
 */

/** One `statechange` event the context actually fired. */
type StateChange = { state: string; at: number }

export type DiagnosticSnapshot = {
  /** Whether `Outline.tsx`'s finger-tracing gesture (and every other
   *  `!isCheap()`-gated bit of art) actually mounted, and why. This is the
   *  first thing a device test has to answer: if the probe latched `slow`
   *  (or reduced-motion is on) on the target iPad, the gesture never mounts
   *  at all and everything built to react to it is silently inert. See
   *  `cheapMode.ts`'s `CheapModeDiagnostics` for what each field means. */
  cheapMode: CheapModeDiagnostics
  /** Raw `ctx.state`, never coerced. */
  state: string
  /** Raw `ctx.currentTime`, in seconds. */
  currentTime: number
  /** (currentTime advance) minus (wall-clock advance, in seconds) over the
   *  last trusted sample window. Near zero on a healthy clock; a large
   *  negative number when the audio clock has stalled while real time kept
   *  moving. `null` until the first sample window has actually closed — a
   *  measured `0` is a real, meaningfully different answer (the clock
   *  keeping perfect pace) from "nothing has been measured yet", and the
   *  two must not share a representation. */
  wallDelta: number | null
  /**
   * Whether the audio clock is actually moving, judged ONLY by comparing
   * `currentTime` against `performance.now()` across a sample window.
   *
   * Deliberately never reads `ctx.state`: the entire point of this task is
   * that WebKit bugs 263627 and 283419 both report `state === "running"`
   * while `currentTime` sits frozen. A liveness check that trusted `state`
   * would report "fine" for the exact failure this panel exists to catch.
   *
   * `null` until the first sample window (~1s) has closed — see
   * `SAMPLE_WINDOW_MS`. Defaulting this to `true` would read as healthy for
   * the entire first second after every mount, which is exactly the window
   * WebKit bug 273511 (context `interrupted` at construction, `resume()`
   * does nothing) presents in: load the page, tap play, audio is dead
   * immediately. A false "advancing" here would hide the one bug this panel
   * needs to catch most.
   */
  clockAdvancing: boolean | null
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
  /** The last few taps `MapStage`'s gesture gate declined, most recent
   *  last — see `recordTapRejection`. `TAP_MOVE_PX`/`TAP_MAX_MS`
   *  (`hitLayer.ts`) are reasoned judgment, not a measurement of any real
   *  child's thumb; this is what lets a session on a real device replace
   *  the reasoning with a reading. */
  recentTapRejections: TapRejection[]
}

/** Why the gesture gate said no to a pointerdown/pointerup pair, and by how
 *  much — `hitLayer.ts`'s `TapVerdict` plus when it happened, so the panel
 *  can show the most recent ones. */
export type TapRejection = {
  reason: 'pointer' | 'moved' | 'slow'
  distancePx: number
  durationMs: number
  /** `performance.now()` at the moment it was recorded. */
  at: number
}

/** How many rejected taps the panel keeps. A live look at what is
 *  happening right now, not a session log — old entries fall off. */
const MAX_TAP_REJECTIONS = 8

let tapRejections: TapRejection[] = []

/**
 * Log a tap the gesture gate declined. Called from `MapStage.tsx` — the
 * only place a real pointerdown/pointerup pair is ever seen — every time
 * `describeTap` (`hitLayer.ts`) returns anything other than a tap.
 *
 * THIS OBSERVES TOO. It has no opinion on `TAP_MOVE_PX`/`TAP_MAX_MS` and
 * changes nothing about the gate; it only remembers what the gate just did,
 * for whoever is watching `?debug=audio` on the device where it happened.
 */
export function recordTapRejection(reason: TapRejection['reason'], distancePx: number, durationMs: number): void {
  tapRejections = [...tapRejections, { reason, distancePx, durationMs, at: performance.now() }]
    .slice(-MAX_TAP_REJECTIONS)
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
/** `null` until the first sample window closes — see `clockAdvancing` and
 *  `wallDelta` on `DiagnosticSnapshot` for why that must not default to a
 *  healthy-looking value. */
let wallDelta: number | null = null
let clockAdvancing: boolean | null = null

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
    cheapMode: cheapModeDiagnostics(),
    state: n.diagState,
    currentTime: ctxTime,
    wallDelta,
    clockAdvancing,
    lastStateChanges: n.diagStateChanges,
    lastResumeSettled: n.diagResumeSettled,
    lastResumeMs: n.diagResumeMs,
    stuck: n.stuck,
    playing: n.playing,
    recentTapRejections: tapRejections,
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

function formatRejection(r: TapRejection): string {
  return `  ${r.reason.padEnd(7)} drift ${r.distancePx.toFixed(0)}px  held ${r.durationMs.toFixed(0)}ms`
}

/** `isCheap()`'s verdict plus why it landed there — see `cheapMode`'s field
 *  above. Before the probe has decided, `slow`/`medianFrameMs` would read as
 *  a confident "fast", so that state gets its own words instead. */
function formatCheapMode(c: CheapModeDiagnostics): string {
  const rm = `reducedMotion ${c.prefersReducedMotion}`
  if (!c.decided) return `${c.cheap}  (still probing — ${rm})`
  const median = c.medianFrameMs === null ? '?' : c.medianFrameMs.toFixed(1)
  return `${c.cheap}  (slow ${c.slow}, medianFrame ${median}ms, ${rm})`
}

function formatResume(s: DiagnosticSnapshot): string {
  if (s.lastResumeSettled === null) return 'not yet attempted'
  const ms = s.lastResumeMs === null ? '?' : s.lastResumeMs.toFixed(0)
  return s.lastResumeSettled ? `settled in ${ms}ms` : `PENDING for ${ms}ms — promise has not settled`
}

/** `—`, not a default `true`/`false`: before the first sample window has
 *  closed there is no verdict, and rendering one would read as "healthy"
 *  for the first second after every mount — see `clockAdvancing` on
 *  `DiagnosticSnapshot`. */
function formatClock(s: DiagnosticSnapshot): string {
  if (s.clockAdvancing === null || s.wallDelta === null) return '—  (no reading yet)'
  return `${s.clockAdvancing}  (wallDelta ${s.wallDelta.toFixed(3)}s)`
}

/** Renders `DiagnosticSnapshot` as the panel's plain-text body. Exported
 *  separately from the polling loop so the formatting itself is testable
 *  without a timer. */
export function formatSnapshot(s: DiagnosticSnapshot): string {
  const changes = s.lastStateChanges.length
    ? s.lastStateChanges.map(formatChange).join('\n')
    : '  (none seen)'
  const rejections = s.recentTapRejections.length
    ? s.recentTapRejections.map(formatRejection).join('\n')
    : '  (none)'
  return [
    'audio debug  (#/?debug=audio)',
    `isCheap()     ${formatCheapMode(s.cheapMode)}`,
    `state         ${s.state}`,
    `currentTime   ${s.currentTime.toFixed(3)}s`,
    `clockAdvancing ${formatClock(s)}`,
    `stuck         ${s.stuck}`,
    `playing       ${s.playing}`,
    `resume()      ${formatResume(s)}`,
    'last statechange events:',
    changes,
    'recent rejected taps:',
    rejections,
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
