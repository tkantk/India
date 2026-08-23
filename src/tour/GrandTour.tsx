import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getNarrator } from '../audio/Narrator'
import { AudioDebugPanel } from '../audio/diagnostics'
import { camera, PLACE_PADDING } from '../map/camera'
import { STAGGER_MS, useMapNodes } from '../map/useMapNodes'
import type { MapApi } from '../map/useMapNodes'
import { Controls } from '../ui/Controls'
import { Glyph } from '../ui/Glyph'
import { ReadAlong } from '../ui/ReadAlong'
import { TourStage } from './TourStage'
import { park, parked, clearPark } from './tourPosition'
import { Mor } from './Mor'
import { Here } from './effects/Here'
import { FADE_MS, HOLD } from './effects/Reveal'
import { subjectKeyFor } from './effects/subject'
import { WATERS } from './effects/art/Sea'
import { isTracing, subscribeTracing } from './effects/tracing'
import content from '../../content/tour.json'
import timings from '../data/timings.json'
import geo from '../data/geo.json'
import hit from '../data/hit.json'
import type { Bbox, Clip, Cue, Invite } from '../types'
import './grandTour.css'

/**
 * THE GRAND TOUR: fourteen beats, three minutes thirty-two seconds, and the
 * thing every other file in this plan was built for.
 *
 * (That number is the sum of `duration` over the 14 `tour.*` clips in
 * `src/data/timings.json` — re-measure it from there, do not trust this
 * comment. It has drifted twice already: once from an unmeasured "2:41",
 * and again when the prosodic-continuity render shortened the tour by
 * about 33 seconds without a word of text changing.)
 *
 * A child presses one enormous button and is taken through their own country
 * — the words lighting up as they are spoken, states glowing in time, the
 * camera flying to Delhi and coming home again, a tiger arriving on cue, and
 * a peacock at the edge of the map who turns to present each one. It ends
 * with "Tap any state on the map, and the two of us will go and see it", and
 * that invitation is live from the first second: a deliberate tap anywhere on
 * the map leaves the tour at once and flies there. THE TOUR IS AN OFFER,
 * NEVER A CAGE — but an offer a child accepted by touching the map is not one
 * they should have to start over from the beginning to take again. Leaving
 * is not forgetting: an accidental brush or an attempted scroll is ignored
 * outright (`isTap` in `hitLayer.ts`), and whichever beat was in the air when
 * a real tap landed is remembered (`tourPosition.ts`) until the child comes
 * back and either carries on from there or goes home on purpose.
 *
 * WHAT DRIVES IT. Beats advance on the engine's `onEnd`, which fires only at
 * a clip's natural end — never on pause, never on stop. `play()` resolves
 * when a clip STARTS, so a sequencer that chained on that promise would run
 * all fourteen beats in a single tick. The two failure modes are handled
 * separately because the engine reports them differently: a rejection
 * (thrown out of `play`) and a 404 (caught inside `play`, degraded to
 * silence, resolved — and no `onEnd` will ever come). Either way the tour
 * skips to the next beat rather than leaving a child in front of a map that
 * stopped talking.
 *
 * A BEAT CAN ASK FOR MORE TIME THAN ITS OWN AUDIO. Beat 2 ends with "Go on,
 * trace the edge with your finger" — and `onEnd` used to advance in the same
 * tick the last word stopped sounding, 41ms before the traced outline's own
 * hold even expired. A line authored with an `invite` (`content/schema.ts`)
 * holds the beat open instead: at least `invite.min` seconds regardless,
 * longer for as long as a finger is on `Trace`'s own corridor, never past
 * `invite.max`. See `useInviteGap` below for the whole shape of the wait,
 * and its own render usage further down for what it disarms on the map
 * while it is open.
 *
 * NOTHING HERE THROWS. Every path a cue or a beat can take is guarded.
 */

type Beat = { id: string; clip: Clip }

const CLIPS = timings as unknown as Record<string, Clip>

/**
 * The running order, taken from the authored content and paired with the
 * rendered audio. A beat with no clip is dropped rather than played: the
 * validator makes that impossible, and if it ever happened the tour should
 * be one beat short, not dead.
 */
export const BEATS: Beat[] = (content.beats as { id: string }[])
  .map((b) => ({ id: b.id, clip: CLIPS[b.id] }))
  .filter((b): b is Beat => Boolean(b.clip))

/** The rect the map sits at when it is showing the whole country. */
const HOME = geo.viewBox as Bbox

type Place = { bbox: Bbox }
const PLACES = geo.places as unknown as Record<string, Place>
/** Same reason cues.ts keeps this separate from `PLACES`: `pinR` lives in
 *  hit.json, not geo.json, and the two are kept apart on purpose. */
const PIN_R = hit.places as unknown as Record<string, { pinR: number }>

/** Every place a finger can land on. The tour says "tap any state", and the
 *  union territories are tappable too — Delhi, the one place the tour
 *  actually flies to, is one of them — so the closing shimmer runs over all
 *  of them rather than over a subset the child cannot see the edge of. */
const ALL_SLUGS = Object.keys(PLACES)

/** The closing shimmer: a wave over the whole map, then calm again. Faster
 *  than the narration wave in `useMapNodes`, because this one has 36 places
 *  to cross and no sentence to keep pace with. */
const SHIMMER_STAGGER_MS = 45
const SHIMMER_MS = ALL_SLUGS.length * SHIMMER_STAGGER_MS + 700

/**
 * How long a whole-map highlight stays lit.
 *
 * A HIGHLIGHT IS A WAVE THAT PASSES, not a colour the map turns. Watched end
 * to end in Chrome, the first version of this was the worst thing in the
 * tour: `highlightAllStates` at beat 3 lit all 28 states, beat 4 added the
 * eight union territories, and nothing ever let go — so from beat 3 onwards
 * the map was one saffron silhouette with no boundaries in it, the tiger and
 * the lotus were presented on an orange field instead of the calm paper they
 * were drawn against, the flight to Delhi arrived at more orange, and beat
 * 14's "tap any state" lit up a map that was already lit.
 *
 * The number is the wave plus the counter: both beats that light the map
 * also put a number on screen counting what has just lit, so the emphasis
 * arrives and leaves as one gesture. Taken from the two constants themselves
 * — the stagger in `useMapNodes` and the hold in `Reveal` — so retuning
 * either retunes this.
 *
 * It does not belong in `cues.ts`: that seam is Task 7's, it is the same in
 * the state screens Plan 3 will build, and a handler there has no idea what
 * a beat is. Here, the sequencer knows exactly how long the sentence that
 * asked for the highlight lasts.
 */
const HIGHLIGHT_MS = ALL_SLUGS.length * STAGGER_MS + HOLD.counter

/** The two verbs that light the map rather than draw on it. */
const HIGHLIGHTS = new Set(['highlightAllStates', 'highlightUnionTerritories'])

/**
 * How long a lifted finger must stay off the trace corridor before the
 * dwell timer below treats one gesture as over. Code, not content — the
 * father's decision was "about 2.5s after he lifts", and it is how "quiet"
 * reads as "done" for ANY invite, the same way `TAP_MOVE_PX`/`TAP_MAX_MS`
 * in `hitLayer.ts` are a platform judgement call rather than an authored
 * number. `invite.min`/`invite.max` are per-line because different
 * gestures may warrant different floors and caps; how long "quiet" has to
 * last is not that kind of question.
 */
const SETTLE_MS = 2500

/**
 * One open invite's own bookkeeping: whether the floor has elapsed, whether
 * the corridor has been quiet for long enough, and how to tear the whole
 * thing down. Not React state — see `useInviteGap` below for why.
 */
type GapSession = {
  floorDone: boolean
  settleDone: boolean
  finished: boolean
  cleanup: () => void
}

/**
 * THE INVITATION WAITS AS LONG AS HE IS TRACING.
 *
 * `n.onEnd` used to be the whole of "advance": a beat's audio finished, so
 * the tour moved on, in the same tick that word 42 stopped sounding — 41ms
 * before the outline's own hold even expired. Beat 2 is the one beat that
 * says "trace the edge with your finger", and the finger it asked for was
 * never given anywhere to land.
 *
 * This hook owns the wait. `arm(invite, onDone)` opens it the instant a
 * beat's `onEnd` fires with an authored `invite`: `onDone` — always the
 * beat's own `advance` — runs once, at the EARLIEST of three things —
 *   - `invite.max` seconds have passed regardless (the hard cap), or
 *   - `invite.min` seconds have passed AND the corridor has been quiet
 *     (no finger down) for `SETTLE_MS` — which is already true, with no
 *     further wait, for a child who never touched anything at all.
 * `abandon()` tears the same wait down WITHOUT running `onDone` — the beat
 * effect's own cleanup, `pick`, `goHome`, `end` and `replay` all call this,
 * because none of them mean "carry on to the next beat", and a stray timer
 * from a beat the child has already left must never fire into whatever the
 * tour does next. `finish()` is the third door: ends the wait right now
 * AND runs `onDone`, which is what the bar's own Play/Pause becomes once
 * there is no audio left to pause — see `playPause`'s own comment.
 *
 * WHY NOT PLAIN REACT STATE FOR THE TIMERS THEMSELVES. `tracing` — read via
 * `useSyncExternalStore`, exactly as this file already reads `n.playing` —
 * has to be able to re-arm a single wait, in place, every time a finger
 * lands or lifts, without resetting the floor or the cap that are already
 * running: an effect keyed on `[invite, tracing]` would tear its own
 * closure down and rebuild it on every touch, restarting exactly the
 * timers that must NOT restart. A `GapSession` in a ref survives that; only
 * the settle timer is ever re-armed, from the `tracing` effect below, and
 * the floor and cap are armed once, when the session itself is created.
 *
 * `invite` (React state) is the one thing here that DOES need to be a
 * render-visible value: it is what `GrandTour` disarms the map with for as
 * long as it is non-null (see this file's own `TourStage` usage) — "the
 * duration of the invite" means the whole wait, not only the moments a
 * finger happens to be down within it.
 */
function useInviteGap() {
  const [invite, setInvite] = useState<Invite | null>(null)
  const session = useRef<GapSession | null>(null)
  const onDone = useRef<(() => void) | null>(null)
  // Read exactly as this file already reads `n.playing`: a primitive
  // selector against a store outside React, so THIS re-renders — and the
  // settle-timer effect below re-runs — on every finger down/up on the
  // corridor, without either file reaching into the other's internals.
  const tracing = useSyncExternalStore(subscribeTracing, isTracing)

  /** Tear the current wait down without running its `onDone`. Idempotent —
   *  every abandon path calls this, and most of the time there is nothing
   *  open to abandon. */
  const abandon = useCallback(() => {
    if (session.current) { session.current.cleanup(); session.current = null }
    onDone.current = null
    setInvite(null)
  }, [])

  /** End the current wait right now and run its `onDone` — the only door
   *  that DOES carry the beat forward. Guarded by the session's own
   *  `finished` flag so the cap timer and the floor+settle path racing
   *  each other in the same tick can only ever run `onDone` once. */
  const finish = useCallback(() => {
    const g = session.current
    if (!g || g.finished) return
    g.finished = true
    g.cleanup()
    session.current = null
    setInvite(null)
    const run = onDone.current
    onDone.current = null
    run?.()
  }, [])

  /** Both halves of "may this wait end" are met: check, and only then
   *  finish. Called from the floor timer below and from the settle effect
   *  — never from the cap timer, which ends the wait unconditionally. */
  const tryFinish = useCallback((g: GapSession) => {
    if (g.floorDone && g.settleDone) finish()
  }, [finish])

  /**
   * Open a wait: `invite.min` and `invite.max` become the floor and the
   * hard cap, armed ONCE here and never reset for the rest of this
   * session — see this function's own top note for why that has to be a
   * ref, not an effect keyed on `tracing`. `settleDone` starts true when
   * the corridor is already idle (nothing to wait out) and false when a
   * finger is already down; either way, the settle EFFECT below is what
   * moves it from there.
   */
  const arm = useCallback((invited: Invite, done: () => void) => {
    abandon()
    onDone.current = done
    setInvite(invited)

    const g: GapSession = { floorDone: false, settleDone: !isTracing(), finished: false, cleanup: () => {} }
    session.current = g

    const floor = setTimeout(() => { g.floorDone = true; tryFinish(g) }, invited.min * 1000)
    const cap = setTimeout(finish, invited.max * 1000)
    g.cleanup = () => { clearTimeout(floor); clearTimeout(cap) }
  }, [abandon, finish, tryFinish])

  /**
   * The one piece of an open wait that has to react to a finger moving:
   * re-arms `SETTLE_MS` from scratch every time the corridor goes quiet,
   * and cancels it the instant a finger comes back down. A SEPARATE effect
   * from the one that plays a beat (`GrandTour`'s own big `useEffect`), on
   * purpose: that effect's dependency array does not include `tracing`,
   * because putting it there would tear the beat's `onEnd`/prefetch/evict
   * machinery down and rebuild it on every touch of the coastline. This
   * effect only ever touches the settle timer inside whatever `GapSession`
   * is currently open — the floor and the cap, armed once in `arm` above,
   * are never reached from here.
   */
  useEffect(() => {
    const g = session.current
    if (!g) return
    if (tracing) { g.settleDone = false; return }
    const settle = setTimeout(() => { g.settleDone = true; tryFinish(g) }, SETTLE_MS)
    return () => clearTimeout(settle)
  }, [tracing, tryFinish])

  return { invite, arm, abandon, finish }
}

/** The middle of a place, in the map's own coordinates. */
const centreOf = (bbox: Bbox): [number, number] => [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2]

/** The three seas are one accumulating picture and hold longer than a card;
 *  taken from the art itself so the two cannot drift. */
const SEAS = new Set(WATERS.map((w) => w.id))

/**
 * How long the picture a cue puts on stage actually stays there, in
 * milliseconds — 0 for a cue that draws nothing.
 *
 * This exists because the overlay seam has no `onDone` slot, deliberately:
 * `OverlayRenderer` is `(arg) => ReactNode` and every effect dismisses
 * itself. Nothing ever clears the slot, so "whatever a cue last drew" is not
 * a description of what is on screen — it is a description of what has been
 * on screen at some point, and handing that to Mor would leave him fanned
 * out from beat 2 to the end of the tour.
 *
 * `cue.hold` — derived once at build time from the clip's own duration, see
 * `scripts/lib/words.mjs`'s `cueTimes` — is preferred whenever a cue carries
 * one, so Mor's fan expires with the picture rather than on a stale
 * constant. The switch below is only the fallback: a cue resolved without a
 * clip duration (the draft-voice pipeline) never gets a `hold` at all.
 */
export function stageHold(cue: Cue): number {
  if (cue.hold !== undefined) return cue.hold
  switch (cue.do) {
    case 'revealSymbol':
      // Two of the eleven symbols are not cards: the outline is a map layer a
      // child traces, and the seas accumulate into one picture.
      if (cue.arg === 'outline') return HOLD.outline
      return cue.arg && SEAS.has(cue.arg) ? HOLD.sea : HOLD.symbol
    case 'unfurlFlag': return HOLD.flag
    case 'countTo': return HOLD.counter
    case 'traceRiver': return HOLD.river
    case 'raiseMountains': return HOLD.mountains
    case 'showScript': return HOLD.script
    default: return 0
  }
}

/**
 * Does this beat begin by bringing the camera home?
 *
 * Beat 5 flies to Delhi and `tour.json` has no verb for coming back. Task 8
 * made map-registered art follow the camera, so a stranded camera is no
 * longer a correctness bug — but beats 10, 11 and 12 are the Ganga, the
 * Himalaya and the three seas, which are the whole country, and a child who
 * was taken somewhere ought to be brought back.
 *
 * Derived rather than hardcoded to "beat 6": any beat that does not itself
 * fly somewhere starts from the whole map. Add a second `zoomTo` to the
 * content tomorrow and the return journey comes with it.
 */
export function comesHome(clip: Clip, view: Bbox | null): boolean {
  if (clip.cues.some((cue) => cue.do === 'zoomTo')) return false
  // No map mounted: nothing to fly. A thousandth of a viewBox unit is a
  // thousandth of a CSS pixel, so half a unit is "the same view".
  return view !== null && !view.every((n, i) => Math.abs(n - HOME[i]) < 0.5)
}

/**
 * The two things a cue puts on stage that nothing else will ever take off
 * again: the picture Mor turns to present, and the emphasis on the map.
 *
 * Both get a life here, and for the same reason — the cue registry is a
 * one-way door. `dispatch` fires and forgets, `OverlayRenderer` has no
 * `onDone`, and `MapApi.highlight` has no duration; every effect that ends
 * itself does so from inside its own React tree, which the map's class
 * toggles and Mor's prop are deliberately not part of. So the sequencer,
 * which is the only thing that knows how long a sentence lasts, ends them.
 *
 * Mor's lifetime is the art's own hold plus its fade, so he folds his tail
 * away in the same moment the picture finishes leaving rather than a beat
 * before or a beat after it — which is why this times itself off
 * `n.scheduleAfter` rather than a wall-clock `setTimeout` of its own: `hold`
 * is nominal MEDIA seconds (`Cue.hold`), the same number `Reveal.tsx` now
 * times its own hold by, and a pair of independent wall-clock timers built
 * from the same number would agree only at rate 1 with nothing ever
 * paused — Task 5's bug, once removed from the picture itself, would
 * otherwise still be here: Mor folding his tail away while the picture he
 * is presenting is still on screen, or the highlight wave releasing the map
 * while the narrator describing it is still slowed down or paused.
 */
function useStageLife(map: MapApi, n: ReturnType<typeof getNarrator>) {
  const [showing, setShowing] = useState<string | null>(null)
  /** Where the camera has just landed, if it landed anywhere. `hold` is the
   *  zoomTo cue's own derived lifetime — see `Here.tsx`. */
  const [here, setHere] = useState<{ at: [number, number]; nonce: number; hold?: number } | null>(null)
  /** Cancel functions from `n.scheduleAfter`, not raw timer handles. */
  const fan = useRef<(() => void) | null>(null)
  const wave = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    fan.current?.()
    wave.current?.()
    fan.current = null
    wave.current = null
  }, [])

  const clear = useCallback(() => {
    stop()
    setShowing(null)
    setHere(null)
  }, [stop])

  /** A cue just fired. Give whatever it put on stage somewhere to end. */
  const saw = useCallback((cue: Cue) => {
    if (cue.do === 'zoomTo') {
      // "Look down." The registry flies the camera; this is the thing there
      // is to look at when it lands. A fresh nonce so a replayed beat draws
      // it again rather than reusing a marker that has already gone.
      const place = cue.arg ? PLACES[cue.arg] : undefined
      if (place) setHere({ at: centreOf(place.bbox), nonce: ++marked, hold: cue.hold })
      return
    }
    if (HIGHLIGHTS.has(cue.do)) {
      wave.current?.()
      wave.current = n.scheduleAfter(HIGHLIGHT_MS / 1000, () => {
        wave.current = null
        map.clear()
      })
      return
    }
    const hold = stageHold(cue)
    if (!hold) return
    fan.current?.()
    // Not simply `cue.arg ?? cue.do`: `subjectKeyFor` (see its own note)
    // keys `countTo`/`traceRiver`/`showScript` by the verb rather than by
    // whatever argument rides along with them, which is what lets
    // `subject.ts` colour "counting" once rather than once per number. The
    // `?? cue.do` fallback only matters for a cue `subjectKeyFor` was never
    // meant to colour (defence in depth — every cue reaching here already
    // has a nonzero `stageHold`, which today means it always resolves).
    setShowing(subjectKeyFor(cue.do, cue.arg) ?? cue.do)
    fan.current = n.scheduleAfter((hold + FADE_MS) / 1000, () => {
      fan.current = null
      setShowing(null)
    })
  }, [map, n])

  useEffect(() => stop, [stop])

  return { showing, here, saw, clear }
}

/** Fresh key per flight, so `Here` remounts and animates again. */
let marked = 0

type Props = {
  /** Start on mount, with no tap. The tests use it; the app does not — a
   *  child presses the button, which is also the gesture iOS wants. */
  autoStart?: boolean
  /** A state was tapped. The tour has already stopped and gone there by the
   *  time this fires; Plan 3 is what makes "there" a place worth arriving at. */
  onPickState?: (slug: string) => void
}

export function GrandTour({ autoStart = false, onPickState }: Props) {
  const n = getNarrator()
  const map = useMapNodes()
  // A primitive selector against the engine's own subscription. NOT
  // `getSnapshot`, which hands back the word index and would not change when
  // `playing` flips.
  const playing = useSyncExternalStore(n.subscribe, () => n.playing)

  /** Which beat is in the air, or null when the tour is not running. */
  const [at, setAt] = useState<number | null>(autoStart ? 0 : null)
  /** Has the child been all the way through? Only then does the button
   *  offer it "again" — abandoning at beat 3 is not having seen it. */
  const [finished, setFinished] = useState(false)
  /**
   * A mirror of `tourPosition.ts`'s own module-scoped value, kept in React
   * state for one reason: `parked()` is a plain function, not a subscribed
   * store, and a render only happens when SOME state changes. `goHome` while
   * already idle calls `setAt(null)` and `setFinished(false)` with the exact
   * values they already hold — React bails out of both, no render happens,
   * and a "Carry on" label from before `clearPark()` ran would sit there
   * unrefreshed forever. Set explicitly alongside every `park()`/`clearPark()`
   * call this component makes (`pick`, `goHome`, `end`), so it can never
   * drift from the module value; read fresh from it only once, on mount, to
   * pick up whatever an earlier instance parked before it unmounted.
   */
  const [parkedAt, setParkedAt] = useState<number | null>(() => parked())
  const { showing, here, saw, clear: clearStage } = useStageLife(map, n)
  /** The invite currently open, if a beat's audio just ended carrying one
   *  and the tour is holding it open rather than advancing at once — see
   *  `useInviteGap`'s own top note. Non-null for the WHOLE wait, not only
   *  the moments a finger happens to be down within it, which is exactly
   *  what disarms the map below: "the duration of the invite" means this. */
  const { invite, arm: armInvite, abandon: abandonInvite, finish: finishInvite } = useInviteGap()

  const shimmer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopShimmer = useCallback(() => {
    if (shimmer.current) clearTimeout(shimmer.current)
    shimmer.current = null
  }, [])
  useEffect(() => stopShimmer, [stopShimmer])

  /** The beat in the air, kept live in a ref alongside the state itself —
   *  purely so the unmount effect below can read it. That effect's own
   *  dependency array is `[n]`, deliberately: putting `at` there would rerun
   *  it, and its cleanup, on every ordinary beat change, which is exactly
   *  the `n.stop()` that must NOT happen between beat 3 and beat 4. */
  const atRef = useRef(at)
  useEffect(() => { atRef.current = at }, [at])

  /**
   * Leaving this screen stops the tour — and remembers where it was.
   *
   * The engine is module-scoped on purpose — it outlives every component, so
   * that React's StrictMode cannot close an AudioContext out from under an
   * iPad. The flip side is that unmounting the sequencer does NOT silence it:
   * the beat effect's cleanup only unhooks `onEnd`, and the clip carries on
   * playing to nobody. There is somewhere else to go now (the credits page,
   * and Plan 3's state screens), so this is the moment that becomes audible.
   *
   * It is also the moment a beat used to become forgotten. `GrandTour` is
   * plain component state, and this unmount is reachable in production today
   * through nothing more exotic than the map's own credit line
   * (`MapStage.tsx`'s `.credit__more`, `href="#/credits"`): a tap changes the
   * route, this component unmounts mid-beat, and coming back from
   * `Credits.tsx`'s "Back to the map" mounted a brand new one at beat zero.
   * Parking here — the one thing that survives a full unmount — is what
   * fixes that path along with every other one that can tear this component
   * down without going through `goHome` or `end` first.
   *
   * (StrictMode's synthetic double-invoke runs this cleanup once before any
   * beat has played, in dev only — harmless: `autoStart` is never true in
   * the real app, so `atRef.current` is still null at that moment.)
   */
  useEffect(() => () => {
    n.stop()
    if (atRef.current !== null) park(atRef.current)
  }, [n])

  const beat = at === null ? null : BEATS[at] ?? null

  /** The end of the road: home, one shimmer over the whole map, and the big
   *  button back with a different word on it. */
  const end = useCallback(() => {
    setAt(null)
    setFinished(true)
    // A beat the child has already left — however this end came about —
    // must not have a stray timer land on whatever the screen does next.
    abandonInvite()
    // Completion is completion, not a place to carry on from — a parked beat
    // from an earlier, abandoned pass through the tour must not survive it.
    clearPark()
    setParkedAt(null)
    clearStage()
    n.stop()
    void camera.home()
    stopShimmer()
    map.highlightMany(ALL_SLUGS, SHIMMER_STAGGER_MS)
    shimmer.current = setTimeout(() => {
      shimmer.current = null
      map.clear()
    }, SHIMMER_MS)
  }, [abandonInvite, clearStage, map, n, stopShimmer])

  /**
   * One beat: play it, hand the engine somewhere to report its end, and get
   * the next one's audio ready while this one talks.
   */
  useEffect(() => {
    if (at === null) return
    const current = BEATS[at]
    if (!current) { end(); return }

    let live = true
    const advance = () => {
      if (!live) return
      live = false
      if (at + 1 < BEATS.length) setAt(at + 1)
      else end()
    }

    /**
     * The engine reports a natural end here and nowhere else. `stop()` does
     * not fire it, which is exactly why abandoning the tour does not
     * secretly queue up beat 8.
     *
     * A beat whose line carries no `invite` advances exactly as it always
     * has — the same tick the last word stops sounding. One that does gets
     * held open instead: `armInvite` runs `advance` itself once the wait is
     * over, never sooner. The 404 paths inside the async block below call
     * `advance` directly, bypassing this entirely — a missing file is not
     * an invitation.
     */
    const handleEnd = () => {
      if (!live) return
      const invited = current.clip.invite
      if (!invited) { advance(); return }
      armInvite(invited, advance)
    }
    n.onEnd = handleEnd

    /**
     * Task 4's engine-side twin of `handleEnd`, wired for the same lifetime.
     * `replay`'s own `abandonInvite()` call below already covers a replay
     * that comes through THIS screen's "Say it again" — this is defence in
     * depth for a `Narrator.replay()` call that does not: `abandon()` is
     * idempotent, so the two never conflict, and the next plan's 32 state
     * screens get the protection without having to rediscover it.
     */
    const handleAgain = () => { abandonInvite() }
    n.onAgain = handleAgain

    // EVERY BEAT STARTS ON A CLEAN MAP, for the same reason Mor's `showing`
    // expires: a highlight is emphasis, and emphasis that is never taken away
    // stops being emphasis. `highlightAllStates` at beat 3 and
    // `highlightUnionTerritories` at beat 4 leave all 36 places lit, and
    // nothing in the cue registry ever clears them — so without this the
    // tiger, the flag, the Ganga and the Himalaya are all presented over a
    // map that is uniformly saffron, and beat 14's "tap any state" lights up
    // a map that is already lit. Watched end to end in Chrome, that was the
    // single worst thing about the tour.
    map.clear()

    if (comesHome(current.clip, camera.view())) void camera.home()

    void (async () => {
      try {
        await n.play(current.clip)
      } catch {
        // The clip could not even be asked for. Skipping is the only kind
        // thing to do; a child cannot fix a 404.
        advance()
        return
      }
      if (!live) return
      // A missing file does not reject: `play` catches it, plays silence and
      // resolves, and `onEnd` will never come. Nothing else is going to end
      // this beat, so it ends here.
      if (!n.playing) { advance(); return }

      // Beat N+1 in, beat N-1 out. Decoded PCM is roughly 24x the compressed
      // size, and the engine keeps two.
      const next = BEATS[at + 1]
      if (next) {
        try {
          await n.prefetch([next.clip])
        } catch { /* it will simply be decoded when its turn comes */ }
      }
      const previous = BEATS[at - 1]
      if (previous) n.evict([previous.clip])
    })()

    return () => {
      live = false
      if (n.onEnd === handleEnd) n.onEnd = null
      if (n.onAgain === handleAgain) n.onAgain = null
      // Whichever beat this closure belongs to is being torn down —
      // normally because it just advanced past its own invite (already
      // abandoned by `armInvite`'s own `abandon()` call, so this is a
      // no-op), but also on pick, home, unmount and every other path that
      // changes `at` out from under a beat still mid-wait. A stray
      // floor/settle/cap timer surviving this would fire into whatever
      // beat (or nothing) comes next.
      abandonInvite()
    }
  }, [abandonInvite, armInvite, at, end, map, n])

  /**
   * Begin playing some beat from its first word — beat 0 for a fresh start,
   * or a parked one for "Carry on". Not the exact millisecond a tap or an
   * unmount caught it at: the father's own third decision, and kinder to a
   * distracted six-year-old than dropping them into the middle of a word.
   * `pause()`/`resume()` already preserve an exact offset, but that offset
   * lives on the engine's now-torn-down clip — `n.stop()` throws it away on
   * every one of the exits that parks a beat — so there is nothing exact
   * left to resume TO, only the beat itself, replayed from its start.
   */
  const carryOn = useCallback((beatIndex: number) => {
    // Synchronously, inside the tap: WebKit only honours a gesture for work
    // started before the first await, and `play` is an effect away.
    void n.resumeContext()
    stopShimmer()
    map.clear()
    clearStage()
    setFinished(false)
    setAt(beatIndex)
  }, [clearStage, map, n, stopShimmer])

  const start = useCallback(() => carryOn(0), [carryOn])

  /**
   * The bar's play/pause, which has exactly one meaning: make something
   * happen. A beat in the air (playing or paused) is the engine's transport;
   * no beat at all — at rest, or after the end — starts the tour: from a
   * parked beat if there is one to carry on from, and from the top
   * otherwise, which is the same thing the big gold button does. Two
   * targets, one meaning, and neither of them dead.
   *
   * A THIRD state Task 3 adds: a beat whose audio has already ended and is
   * waiting on an invite. `n.playing` is false there — there is nothing
   * left to pause — so without this branch the button would fall through to
   * `n.resume()`, which the engine already no-ops with nothing loaded
   * (Narrator.ts's own `resume()`), and the wait would carry on regardless
   * of the tap. "Make something happen" here means finishing the wait right
   * now, exactly as if the floor and the settle had both just elapsed.
   */
  const playPause = useCallback(() => {
    if (n.playing) { n.pause(); return }
    if (invite) { finishInvite(); return }
    if (at !== null) { n.resume(); return }
    const p = parked()
    if (p !== null) { carryOn(p); return }
    start()
  }, [at, carryOn, finishInvite, invite, n, start])

  /**
   * Home. On a one-screen app there is nowhere to navigate TO, so home is
   * the state the screen was in when the child first saw it: nothing
   * playing, nothing lit, nothing on stage, the big button back and
   * offering the tour from the top.
   *
   * `n.forget()`, alongside `n.stop()`: home's own promise is "back to the
   * very beginning," and a "Say it again" that quietly resurrected
   * whatever was last said — audible over this exact idle screen, with no
   * words lighting up and no visible cause — would contradict that promise
   * rather than honour it. A tap and the tour's own natural end do NOT do
   * this; `stop()` alone still leaves `lastClip` for `replay()` to answer
   * with there, and Controls' `canReplay` is what makes the difference
   * visible: disabled here, live everywhere else a control can be pressed
   * from.
   */
  const goHome = useCallback(() => {
    n.stop()
    n.forget()
    abandonInvite()
    setAt(null)
    // Not "again": home is the beginning, and this is what the beginning
    // looks like. Documented as such, so a parked beat does not outlive it.
    clearPark()
    setParkedAt(null)
    setFinished(false)
    clearStage()
    stopShimmer()
    map.clear()
    void camera.home()
  }, [abandonInvite, clearStage, map, n, stopShimmer])

  /**
   * "Say it again." `Narrator.replay()` used to bail with nothing audible at
   * all — `!this.buffer`, which `stop()` throws away — in every stopped
   * state a control can be pressed from: after a tap, after Home, after the
   * tour ends. Task 4 fixed that at the engine, keeping `lastClip` alive
   * through `teardown()` so `replay()` answers everywhere. This wrapper's
   * own job stays the one Task 3 gave it: `replay()` can restart the SAME
   * clip that just opened an invite (an ended clip with its invite still
   * open still has a buffer — `finish()` never tears down), which would
   * otherwise leave the ORIGINAL wait's floor/settle/cap timers ticking
   * against audio that has started over. `abandonInvite()` here, ahead of
   * the call, is the belt; `n.onAgain` (wired above, alongside `onEnd`) is
   * the suspenders — the identical cleanup, run from the engine side, for a
   * `replay()` call that does not come through this screen at all. Both are
   * idempotent, so having both is free.
   *
   * The invite REOPENING after this — beat 2's own "trace the edge" wait,
   * live again once the replayed clip ends a second time — falls out of
   * `handleEnd` staying hooked up across a replay (`at` never changes), not
   * out of anything this function does. See `GrandTour.test.tsx`'s "reopens
   * the invite after a real replay" for the proof.
   */
  const replay = useCallback(() => {
    abandonInvite()
    void n.replay()
  }, [abandonInvite, n])

  /**
   * A state was tapped. Whatever was happening stops, and the child goes
   * where they pointed — beat 14 invites exactly this, and every beat before
   * it allows it.
   *
   * THE TOUR IS AN OFFER, NEVER A CAGE, but leaving is not forgetting: the
   * beat that was in the air is parked before it is let go of, so "Carry on"
   * is there to pick it back up whenever the child (or a grown-up, from the
   * bar's own Play button) is ready to.
   */
  const pick = useCallback((slug: string) => {
    n.stop()
    abandonInvite()
    if (at !== null) { park(at); setParkedAt(at) }
    setAt(null)
    clearStage()
    stopShimmer()
    map.clear()
    map.highlight(slug, true)
    const place = PLACES[slug]
    if (place) {
      // Same reasoning as cues.ts's zoomTo: pad to this place's own pinR,
      // not a flat worst-case constant, so tapping Rajasthan does not zoom
      // out as far as tapping Andaman & Nicobar would need to.
      const padding = Math.max(PLACE_PADDING, PIN_R[slug]?.pinR ?? 0)
      void camera.flyTo(place.bbox, { padding })
    }
    onPickState?.(slug)
  }, [abandonInvite, at, clearStage, map, n, onPickState, stopShimmer])

  // Only meaningful while idle — `beat` is null. `parkedAt` itself is kept
  // accurate everywhere `at` goes to null (see its own declaration above);
  // this just skips showing it behind a beat that is actually playing.
  const parkedBeat = beat ? null : parkedAt

  return (
    <>
      {/* Task 1 scaffolding: a read-only `?debug=audio` readout of the audio
          clock, for finding which WebKit bug is actually firing on the
          iPad before Task 2 attempts any repair. Renders nothing without
          the flag; Task 12 deletes it once the repair is verified. */}
      <AudioDebugPanel />

      {/*
        `onPickState` is withheld — not merely a picker that does nothing —
        for as long as an invite is open. `TourStage` already falls back to
        a no-op when this prop is `undefined` (its own `NOOP`), so this is
        the whole of "disarm the map for the duration of the invite": beat
        2 is the one moment the narration explicitly asks for a finger on
        the coast, and without this a near-miss of `Trace`'s own corridor
        would fall through to `MapStage`'s ordinary tap-to-pick — ending the
        tour on exactly the touch it just invited. Every state screen this
        same field reaches next inherits the same protection for free.
      */}
      {/* `showing` is already the exact key `subject.ts` colours the app by
          (see `useStageLife.saw`, above) — handing it to the stage is the
          whole of "the sentence is the same colour as the picture it is
          about"; nothing new is threaded through the sequencer for it.

          `here` is the one moment `showing` cannot speak for. A camera verb
          puts no picture in the overlay slot, so `useStageLife` returns
          before it ever sets `showing` — deliberately, because that value is
          also Mor's pose, and he is not presenting anything mid-flight. But
          the child IS being shown something: the look-down ring, drawn in
          `zoomTo`'s own colour. Reading it here rather than widening
          `showing` keeps the pose and the colour separate, which is what
          they are. */}
      <TourStage
        onPickState={invite ? undefined : pick}
        onCue={saw}
        scene={beat?.id ?? ''}
        subject={showing ?? (here ? 'zoomTo' : null)}
      >
        {/* "Look down." Drawn in the map's own coordinates, over the place
            the camera has just flown to. Not part of the overlay slot: that
            belongs to the cue registry, and this answers a camera verb the
            registry has no picture for. */}
        {here && <Here key={here.nonce} at={here.at} hold={here.hold} />}

        {/* The sentence being spoken, with the word lit. `data-beat` is how a
            person watching with devtools open — and the frame-strip probe —
            can tell which of the fourteen is in the air. */}
        <div className="say" data-beat={beat?.id ?? ''} data-quiet={beat ? undefined : 'true'}>
          <ReadAlong clip={beat?.clip ?? null} />
        </div>

        {/* Mor and the button stand in the same box, so that `--mor-floor`
            can be raised for exactly as long as the button is there to be
            covered — which on a phone is the only time it needs to be.
            `mor.css` asks only for "a positioned ancestor the size of the
            map", and `inset: 0` on a child of the stage is one. */}
        <div className="tour-front" data-idle={beat ? undefined : 'true'}>
          <Mor playing={playing} showing={showing} />

          {!beat && (
            <button
              type="button"
              className="tap play-big"
              onClick={() => (parkedBeat !== null ? carryOn(parkedBeat) : start())}
            >
              <span className="play-big__icon"><Glyph name="play" /></span>
              <span className="play-big__label">
                {parkedBeat !== null ? 'Carry on' : finished ? 'Show me again' : 'Show me India'}
              </span>
            </button>
          )}
        </div>
      </TourStage>

      <Controls onPlayPause={playPause} onHome={goHome} onReplay={replay} />
    </>
  )
}
