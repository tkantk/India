import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getNarrator } from '../audio/Narrator'
import { camera } from '../map/camera'
import { STAGGER_MS, useMapNodes } from '../map/useMapNodes'
import type { MapApi } from '../map/useMapNodes'
import { Controls } from '../ui/Controls'
import { ReadAlong } from '../ui/ReadAlong'
import { TourStage } from './TourStage'
import { Mor } from './Mor'
import { Here } from './effects/Here'
import { FADE_MS, HOLD } from './effects/Reveal'
import { WATERS } from './effects/art/Sea'
import content from '../../content/tour.json'
import timings from '../data/timings.json'
import geo from '../data/geo.json'
import type { Bbox, Clip, Cue } from '../types'
import './grandTour.css'

/**
 * THE GRAND TOUR: fourteen beats, two minutes forty-one seconds, and the
 * thing every other file in this plan was built for.
 *
 * A child presses one enormous button and is taken through their own country
 * — the words lighting up as they are spoken, states glowing in time, the
 * camera flying to Delhi and coming home again, a tiger arriving on cue, and
 * a peacock at the edge of the map who turns to present each one. It ends
 * with "Tap any state on the map, and the two of us will go and see it", and
 * that invitation is live from the first second: a tap anywhere on the map
 * ends the tour at once. THE TOUR IS AN OFFER, NEVER A CAGE.
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
 * The numbers are `HOLD`, imported from the art, so a hold retuned there
 * retunes Mor with it.
 */
export function stageHold(cue: Cue): number {
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
 * before or a beat after it.
 */
function useStageLife(map: MapApi) {
  const [showing, setShowing] = useState<string | null>(null)
  /** Where the camera has just landed, if it landed anywhere. */
  const [here, setHere] = useState<{ at: [number, number]; nonce: number } | null>(null)
  const fan = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wave = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (fan.current) clearTimeout(fan.current)
    if (wave.current) clearTimeout(wave.current)
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
      if (place) setHere({ at: centreOf(place.bbox), nonce: ++marked })
      return
    }
    if (HIGHLIGHTS.has(cue.do)) {
      if (wave.current) clearTimeout(wave.current)
      wave.current = setTimeout(() => {
        wave.current = null
        map.clear()
      }, HIGHLIGHT_MS)
      return
    }
    const hold = stageHold(cue)
    if (!hold) return
    if (fan.current) clearTimeout(fan.current)
    setShowing(cue.arg ?? cue.do)
    fan.current = setTimeout(() => {
      fan.current = null
      setShowing(null)
    }, hold + FADE_MS)
  }, [map])

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
  const { showing, here, saw, clear: clearStage } = useStageLife(map)

  const shimmer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopShimmer = useCallback(() => {
    if (shimmer.current) clearTimeout(shimmer.current)
    shimmer.current = null
  }, [])
  useEffect(() => stopShimmer, [stopShimmer])

  const beat = at === null ? null : BEATS[at] ?? null

  /** The end of the road: home, one shimmer over the whole map, and the big
   *  button back with a different word on it. */
  const end = useCallback(() => {
    setAt(null)
    setFinished(true)
    clearStage()
    n.stop()
    void camera.home()
    stopShimmer()
    map.highlightMany(ALL_SLUGS, SHIMMER_STAGGER_MS)
    shimmer.current = setTimeout(() => {
      shimmer.current = null
      map.clear()
    }, SHIMMER_MS)
  }, [clearStage, map, n, stopShimmer])

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

    // The engine reports a natural end here and nowhere else. `stop()` does
    // not fire it, which is exactly why abandoning the tour does not
    // secretly queue up beat 8.
    n.onEnd = advance

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
      if (n.onEnd === advance) n.onEnd = null
    }
  }, [at, end, map, n])

  const start = useCallback(() => {
    // Synchronously, inside the tap: WebKit only honours a gesture for work
    // started before the first await, and `play` is an effect away.
    void n.resumeContext()
    stopShimmer()
    map.clear()
    clearStage()
    setFinished(false)
    setAt(0)
  }, [clearStage, map, n, stopShimmer])

  /**
   * The bar's play/pause, which has exactly one meaning: make something
   * happen. A beat in the air (playing or paused) is the engine's transport;
   * no beat at all — at rest, or after the end — starts the tour, which is
   * the same thing the big gold button does. Two targets, one meaning, and
   * neither of them dead.
   */
  const playPause = useCallback(() => {
    if (n.playing) { n.pause(); return }
    if (at !== null) { n.resume(); return }
    start()
  }, [at, n, start])

  /**
   * Home. On a one-screen app there is nowhere to navigate TO, so home is
   * the state the screen was in when the child first saw it: nothing
   * playing, nothing lit, nothing on stage, the big button back and
   * offering the tour from the top.
   */
  const goHome = useCallback(() => {
    n.stop()
    setAt(null)
    // Not "again": home is the beginning, and this is what the beginning
    // looks like.
    setFinished(false)
    clearStage()
    stopShimmer()
    map.clear()
    void camera.home()
  }, [clearStage, map, n, stopShimmer])

  /**
   * A state was tapped. Whatever was happening stops, and the child goes
   * where they pointed — beat 14 invites exactly this, and every beat before
   * it allows it.
   */
  const pick = useCallback((slug: string) => {
    n.stop()
    setAt(null)
    clearStage()
    stopShimmer()
    map.clear()
    map.highlight(slug, true)
    const place = PLACES[slug]
    if (place) void camera.flyTo(place.bbox)
    onPickState?.(slug)
  }, [clearStage, map, n, onPickState, stopShimmer])

  return (
    <>
      <TourStage onPickState={pick} onCue={saw} scene={beat?.id ?? ''}>
        {/* "Look down." Drawn in the map's own coordinates, over the place
            the camera has just flown to. Not part of the overlay slot: that
            belongs to the cue registry, and this answers a camera verb the
            registry has no picture for. */}
        {here && <Here key={here.nonce} at={here.at} />}

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
            <button type="button" className="tap play-big" onClick={start}>
              <span className="play-big__icon" aria-hidden="true">▶</span>
              <span className="play-big__label">
                {finished ? 'Show me again' : 'Show me India'}
              </span>
            </button>
          )}
        </div>
      </TourStage>

      <Controls onPlayPause={playPause} onHome={goHome} />
    </>
  )
}
