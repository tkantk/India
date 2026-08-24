import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { getNarrator } from '../audio/Narrator'
import { camera } from '../map/camera'
import { useMapNodes } from '../map/useMapNodes'
import { assetUrl } from '../lib/assetUrl'
import { Controls } from '../ui/Controls'
import { Glyph } from '../ui/Glyph'
import type { GlyphName } from '../ui/Glyph'
import { ReadAlong } from '../ui/ReadAlong'
import { TourStage } from '../tour/TourStage'
import { StateShape } from '../tour/effects/StateShape'
import { subjectOf, subjectKeyForPlace } from '../tour/effects/subject'
import { contentFor, WRITTEN } from '../content/places'
import geo from '../data/geo.json'
import timings from '../data/timings.json'
import photoCredits from '../data/photo-credits.json'
import type { Bbox, Clip } from '../types'
import type { Place } from '../../content/schema.ts'
import './place.css'

/**
 * A PAGE IN THE BOOK.
 *
 * The child tapped a state and the camera flew there. This is what is
 * waiting when it lands: the same map, still flown, with that state's own
 * border drawn round it in its own colour and traceable with a finger; the
 * state's name on a plate in the corner; the four cards every place carries
 * — animal, food, festival, hello — laid out like a spread underneath; and
 * the five landmarks as five real photographs, tapped one at a time. The
 * sentence being spoken lights up word by word in the same caption strip the
 * tour uses, over the same control bar.
 *
 * THE POINT IS CONTINUITY. A six-year-old should feel he turned a page, not
 * that he opened a different app. So almost nothing here is new: the map is
 * `MapStage` through `TourStage` (which also brings the cue registry, so the
 * intro's own `highlightState` / `lightNeighbour` / `revealSymbol` cues fire
 * on this screen exactly as they would in the tour); the caption is `.say`
 * plus `ReadAlong`; the bar is `Controls`; the border is `Trace` with a
 * state's `d` instead of India's, which is the caller `Trace` was written
 * general for; the colours come out of `subject.ts`; the framing comes out
 * of `--map-floor` / `--say-lane` by putting `class="india"` on the root.
 *
 * WHAT IS ACTUALLY NEW, and it is a short list: this file, `place.css`,
 * `StateShape.tsx`, `src/content/places.ts` (nothing in `src/` had ever
 * imported `content/places/*.json` before), nine rows in `subject.ts` and
 * four marks in `Glyph.tsx`.
 *
 * TWO GRAFTS, added once three judged candidates existed to graft from (see
 * `docs/handover.md` and that task's own brief). `PlaceTrail` — the ten
 * beads reflecting `heard` — and the ending line, `ui.all-heard`, are from
 * "guided-visit", with its own locked, sequential trail deliberately left
 * behind: this screen still has no sequence, and a bead here means only
 * "heard" or "not yet". The big picture arriving with its own words and
 * clearing when they end (`!ended` gating `.place-plate`'s contents, and the
 * bold name under a photograph) is from "poke-around".
 *
 * THE TWO FIELDS THAT HAD NO READER UNTIL NOW. `ambience` is played, as the
 * looping bed `Narrator.ambient()` has always been able to play and nothing
 * ever asked it to — the handover's own ruling was that ambience is per
 * place and belongs to this screen. `capital` is printed on the name plate;
 * it is not narrated, because no line was written for it.
 *
 * WHY THE MAP AND NOT A DRAWING OF THE STATE. "The camera stays where it
 * flew" is the whole premise: the shape a child sees here is the same shape
 * they just pointed at, in the same green-on-blue, with its real neighbours
 * still around it — and a tap on one of those neighbours turns to that
 * neighbour's page. A separately drawn state would be a second, competing
 * picture of the same thing.
 *
 * ONE HAZARD HANDLED HERE. `GrandTour`'s `pick` starts a camera flight and
 * then calls `onPickState`; if that navigates, `MapStage` unmounts,
 * `bindCamera(null)` lands the flight on a map being torn down, and the
 * child sees nothing of it. So this screen does not inherit that flight — it
 * mounts its own map at home and flies it here itself, once, a little slower
 * than the tour's 400ms because arriving somewhere is the moment, not a
 * transition between two other moments.
 */

type CardKey = 'animal' | 'food' | 'festival' | 'hello'

/** One thing a child can open on this page. The intro is index 0 and has no
 *  tile: it is the page opening itself. */
type Page = {
  /** Stable id — also what `TourStage` sweeps its overlay on. */
  id: string
  /** Which clip in `timings.json` says this page out loud. */
  clipId: string
  /** The word on the tile. A tile always carries one; that is the rule. For
   *  a landmark this is `short`, the tile-length name — never `name`, which
   *  is written to be accurate, not to fit 129.6px. */
  word: string
  /** The fuller text for the photo's own alt attribute. Only landmarks set
   *  this (to their real `name`); falls back to `word` for a card, which has
   *  no separate long form. */
  alt?: string
  /** The mark beside it, for the four cards. */
  glyph?: GlyphName
  /** The photograph: for the five landmarks, and — once Task 5 has fetched
   *  one — the animal card. Keyed by `species` for the animal (see
   *  `pagesFor`'s own note); `PHOTOS` has no such entry yet, so this is
   *  `undefined` for every seed place today, which is the correct, honest
   *  state: the plate below renders nothing for a card whose photo does not
   *  exist rather than a stand-in shape. */
  photo?: Credit
  /** The drawn category mark this card's OWN big picture shows while its
   *  line plays — `food`'s bowl, `festival`'s rangoli, the exact glyph the
   *  tile beside it already carries (`CARDS`, below; `Glyph.tsx`'s own top
   *  note calls both "deliberately generic"). Set on exactly the two cards
   *  where a generic mark makes no claim the words could contradict: the
   *  words name one dish or one festival, and a bowl or a rangoli commits to
   *  neither — blown up, they still say only "this is about food" / "this
   *  is about a festival." Never set for `animal`, where the words DO name
   *  one exact species: see `photo`'s own note for why that card gets a
   *  photograph or nothing, never a stand-in shape wearing the same
   *  "generic mark" defence — that is the exact defence a rejected
   *  candidate gave for a dog's paw print standing in for a camel. */
  symbol?: GlyphName
  /** Native script to put on screen but never narrate — the `hello` card's
   *  own field in `content/schema.ts`. */
  script?: string
  /** A one-shot fired as the tile opens, ahead of the narration. Three of
   *  the four seed places name a sound that does not exist yet (`camel`,
   *  `temple-bell`); the engine resolves a missing file to silence, which is
   *  the documented contract, so nothing here guards it a second time. */
  sfx?: string
}

type Credit = {
  file: string
  attributionRequired: boolean
  attributionHtml: string
}

const CLIPS = timings as unknown as Record<string, Clip>
const PHOTOS = photoCredits as unknown as Record<string, Credit>

type GeoPlace = { name: string; type: 'state' | 'ut'; d: string; bbox: Bbox }
const GEO = geo.places as unknown as Record<string, GeoPlace>
/** The order the four cards are laid out in, and the word and mark each one
 *  carries. `card` is an object with exactly these four keys in the schema,
 *  not an array, so the running order is a decision and lives here: the
 *  animal first because it is the one a six-year-old reaches for. */
const CARDS: { key: CardKey; word: string; glyph: GlyphName; symbol?: GlyphName }[] = [
  { key: 'animal', word: 'Animal', glyph: 'animal' },
  { key: 'food', word: 'Food', glyph: 'food', symbol: 'food' },
  { key: 'festival', word: 'Festival', glyph: 'festival', symbol: 'festival' },
  { key: 'hello', word: 'Hello', glyph: 'hello' },
]

/**
 * The interface line played once every one of a place's ten pages has
 * actually been HEARD through to its own end — never merely tapped (see
 * `heard`'s own note below). Already authored (`content/ui.json`) and
 * already rendered (`timings.json`); nothing in the app called it until now.
 *
 * A judged candidate ("guided-visit") built a whole locked, sequential
 * ten-stop tour around reaching this line, and lost for exactly that reason
 * — it kept a child out of the tile he wanted for two and a half minutes
 * (see `docs/handover.md` / that task's own brief). The ENDING was the one
 * thing every judge agreed on; only the trail that gated it was the mistake.
 * So here nothing is gated: whichever of the ten a child taps last, in
 * whatever order, still ends in "well done."
 */
const ALL_HEARD = 'ui.all-heard'

/**
 * How long the arrival flight takes.
 *
 * `camera.ts`'s own `FLIGHT_MS` is 400 — right for a cue mid-sentence, where
 * the flight is punctuation. Here it is the page turning, and the child is
 * meant to watch their state come towards them, so it is given a beat and a
 * half. Still one composited transform-then-commit, exactly as `camera.ts`
 * requires; only the duration differs.
 */
const ARRIVE_MS = 900

/**
 * How much room round the state, as a fraction of its own longest side.
 *
 * NOT `Math.max(PLACE_PADDING, pinR)`, which is the right recipe everywhere
 * else and the wrong one here, and the difference is worth being precise
 * about because the handover is emphatic on the subject.
 *
 * `PLACE_PADDING` (40 viewBox units) and `pinR` both answer "how much room
 * does this place's TAP TARGET need to stay on screen" — the question a
 * `zoomTo` cue mid-tour is asking, because the child is about to be invited
 * to touch the thing that was flown to. Measured against a place's own size
 * they are wildly uneven: 40 units is a seventh of Rajasthan's 287-unit
 * width and nearly THREE TIMES Delhi's 15. Flown with the standard recipe,
 * Delhi arrived at its own page filling 15 of 186 visible units — a yellow
 * speck in the middle of Haryana, on the one screen that is entirely about
 * Delhi. (Photographed: `build/shots`, before this constant existed.)
 *
 * On a state's own page the question is different — "how much page is
 * around the picture" — and the answer a printed book gives is a proportion,
 * not a constant. 16% of the longest side is roughly the margin the tour's
 * own flights land on for a mid-sized state, so Rajasthan is unchanged to
 * the eye and Delhi gets 46% of the frame instead of 8%.
 *
 * The absolute floor is for a place whose bbox is a sliver (a single narrow
 * island), where a proportional margin would be no margin at all.
 */
const ARRIVAL_MARGIN = 0.16
const MIN_MARGIN = 6

function pagesFor(place: Place): Page[] {
  const pages: Page[] = [
    { id: 'intro', clipId: place.intro.id, word: place.name },
  ]
  for (const card of CARDS) {
    const line = place.card[card.key]
    pages.push({
      id: `card.${card.key}`,
      clipId: line.id,
      word: card.word,
      glyph: card.glyph,
      symbol: card.symbol,
      script: line.script,
      sfx: line.sfx,
      // The one card whose big picture is a photograph rather than a drawn
      // mark or a script. Keyed by `species`, not by place: a photograph of
      // a dromedary is a photograph of a dromedary regardless of which
      // state is telling the story, so a future place that shares a species
      // reuses the same fetch rather than paying for it twice. `PHOTOS` has
      // no entry for any species today — Task 5 has not run — so this is
      // `undefined` for all four seed places, which `Page.photo`'s own note
      // says is the correct, honest state.
      photo: card.key === 'animal' ? PHOTOS[place.card.animal.species] : undefined,
    })
  }
  for (const landmark of place.landmarks) {
    pages.push({
      id: landmark.id,
      clipId: landmark.line.id,
      word: landmark.short,
      alt: landmark.name,
      photo: PHOTOS[landmark.id],
      sfx: landmark.line.sfx,
    })
  }
  return pages
}

type Props = {
  /** Which place. Whatever a finger landed on — not guaranteed to be a slug
   *  with content, or even a slug on the map. */
  slug: string
  /**
   * A neighbouring state was tapped on the map. Optional and defaulting to
   * nothing, the same way `MapStage`/`GrandTour` take their pickers, so this
   * screen mounts under a test or a headless probe with no Router anywhere
   * — `useNavigate` below `IndiaScreen` is exactly the thing this codebase
   * cannot have (see `MapStage`'s plain `<a href="#/credits">`).
   */
  onPick?: (slug: string) => void
  /** The way back to the whole country. `Controls.tsx` has been waiting for
   *  this since Plan 3: "Plan 3's state screens will make it [Home] a real
   *  navigation." */
  onHome?: () => void
}

export function PlaceScreen({ slug, onPick, onHome }: Props) {
  const n = getNarrator()
  const map = useMapNodes()
  const place = contentFor(slug)
  const land = GEO[slug]

  /**
   * Has a real gesture ever unlocked audio THIS SESSION.
   *
   * `/place/:slug` is the one route reachable with no gesture behind it at
   * all (see App.tsx's own comment on the route: a grown-up reloading the
   * iPad mid-visit must land here directly, not back at the start gate).
   * Every OTHER screen — the map, the tour — is only ever reached after
   * `StartGate`'s own "Show me India" tap has already called
   * `Narrator.unlock()` once, so `unlocked` reads true immediately and
   * nothing below changes for that, by far the more common, path. Cold —
   * a deep link, or a reload while already here — it reads false, and nothing
   * plays until it flips: `Controls.tsx`'s own rule ("no control may be
   * pressable and produce no observable effect") applies to sound exactly
   * as much as it does to a button, and an effect that called `n.play()`
   * with no gesture behind it at all would set the engine's `playing` flag
   * regardless of whether WebKit actually opened output — a Pause button
   * over silence, the defect this guards against.
   */
  const unlocked = useSyncExternalStore(n.subscribe, () => n.everUnlocked)

  /**
   * The pages of this place, or — for one of the 32 with nothing written —
   * a single page whose line is `ui.tap-state`, "Tap a state to visit it."
   *
   * Not a nicety. `Controls` takes `onPlayPause` as a required prop
   * precisely because no control may be pressable and do nothing, and with
   * no clip at all on the screen there is nothing Play could mean: the
   * button would sit there, 104px and enabled, doing nothing, which is the
   * exact failure `Controls.tsx` is written around. One already-rendered UI
   * line gives the page a voice, gives the caption something to light up,
   * and gives both Play and "Say it again" something true to do.
   */
  const pages = useMemo(
    () =>
      place
        ? pagesFor(place)
        : [{ id: 'not-yet', clipId: 'ui.tap-state', word: land?.name ?? slug }],
    [land, place, slug],
  )
  /** Which page is open. 0 is the intro, which opens itself on arrival. */
  const [open, setOpen] = useState(0)
  /** Pages whose line has been heard all the way through — a small tick on
   *  the tile, so a child can see what is left rather than having to
   *  remember. Ended, not tapped: opening a tile and leaving straight away
   *  is not having heard it. */
  const [heard, setHeard] = useState<ReadonlySet<string>>(() => new Set())
  /** Whether the open page's line has finished. The bar's Play must never be
   *  dead (Controls.tsx's own rule), and `resume()` no-ops with nothing left
   *  to resume, so the screen has to know which of the two it means. */
  const [ended, setEnded] = useState(false)
  /** Whether `ui.all-heard` is the thing actually playing right now — the
   *  caption below reads its clip instead of the open page's while this is
   *  true, and the plate stays empty (already true: the last page's own
   *  `ended` flip is what triggers this in the first place). */
  const [celebrating, setCelebrating] = useState(false)
  /** Guards the congratulation to once per visit. A plain ref, not state:
   *  nothing on screen reads it directly, and `heard` never shrinks, so
   *  there is nothing for a re-render to reflect. */
  const celebratedRef = useRef(false)

  const subjectKey = subjectKeyForPlace(place?.ambience)
  const subject = subjectOf(subjectKey)
  const page: Page | undefined = pages[open]
  const clip = page ? CLIPS[page.clipId] ?? null : null

  /**
   * Everything that could be heard: the pages that actually have a rendered
   * clip. Derived, exactly the reasoning a rejected candidate's own `total`
   * used, and for the same reason — a place whose narration is not fully
   * rendered yet must not make "you have heard everything here" permanently
   * unreachable. All ten exist for the four seed places today.
   */
  const completable = useMemo(() => pages.filter((p) => CLIPS[p.clipId]), [pages])
  const allHeard = Boolean(place) && completable.length > 0 && completable.every((p) => heard.has(p.id))

  /**
   * THE ENDING. Fires once, the instant `allHeard` turns true — which can
   * only happen right after a natural end has just added the last unheard
   * id to `heard`, so this never races the page-playing effect below for
   * the engine's one `onEnd` slot: by the time this effect's dependency
   * actually changes, that effect's own callback has already returned.
   * Whichever tile is tapped next (`openPage`) clears `celebrating` itself,
   * which is the only cleanup this needs — the child moving on IS the
   * congratulation ending.
   */
  useEffect(() => {
    if (!allHeard || celebratedRef.current) return
    const line = CLIPS[ALL_HEARD]
    if (!line) return
    celebratedRef.current = true
    setCelebrating(true)
    let live = true
    n.onEnd = () => { if (live) setCelebrating(false) }
    void n.play(line).catch(() => { if (live) setCelebrating(false) })
    return () => { live = false }
  }, [allHeard, n])

  // ------------------------------------------------------------ arriving

  // The flight. Its own effect, keyed on the slug alone: opening a card must
  // not move the camera, and neither must a re-render.
  useEffect(() => {
    if (!land) return
    // Derived from this place's own size, never a flat constant — the same
    // principle the handover states for `PLACE_PADDING`/`pinR`, applied to
    // the different question this screen is asking. See `ARRIVAL_MARGIN`.
    const [, , w, h] = land.bbox
    const padding = Math.max(MIN_MARGIN, ARRIVAL_MARGIN * Math.max(w, h))
    void camera.flyTo(land.bbox, { padding, duration: ARRIVE_MS })
  }, [land])

  /**
   * The place's own ambient bed — the first caller `Narrator.ambient()` has
   * ever had, and the one the handover reserved for this screen ("Ambience
   * is authored per place and belongs to the plan that builds the state
   * screen"). Two of the nine beds exist today (`forest`, `ocean`), so
   * Rajasthan's `desert` is silence; a missing sound is a silent no-op by
   * contract, never a crash. The engine ducks it under the narration and
   * lifts it again on its own.
   */
  useEffect(() => {
    if (!place || !unlocked) return
    void n.ambient(place.ambience)
    return () => { void n.ambient(null) }
  }, [n, place, unlocked])

  /** Leaving this screen silences it. The engine outlives every component,
   *  so unmounting the screen does not stop the clip by itself — the same
   *  reason `GrandTour` parks and stops on its own unmount. */
  useEffect(() => () => { n.stop() }, [n])

  // ------------------------------------------------------- one open page

  /**
   * WHICH ONE YOU ARE ON, and only that one.
   *
   * A HIGHLIGHT IS A WAVE THAT PASSES. The intro lights this state and, for
   * two or three seconds each, its neighbours (`lightNeighbour`); without
   * clearing between pages every neighbour the intro named would still be
   * saffron nine taps later, and "this is the one you are on" would mean
   * nothing. Same reason `GrandTour`'s beat effect clears at the top of
   * every beat.
   *
   * Its own effect, and keyed on the page rather than folded into the one
   * below, so it still runs for a place with no clip at all — a state with
   * nothing written must still be lit under the words saying so.
   */
  useEffect(() => {
    map.clear()
    map.highlight(slug, true)
  }, [map, open, slug])

  useEffect(() => {
    // Nothing plays with no gesture behind it yet — see `unlocked`'s own
    // comment. `playPause` and a tile's own `onOpen` are what call
    // `n.unlock()` on the child's first tap; the instant that lands, this
    // effect re-runs (it is `unlocked` itself), and plays the CURRENT page
    // exactly as it would have on arrival — nothing here has to remember
    // to retry, because the flip already re-ran it.
    if (!page || !clip || !unlocked) return

    setEnded(false)

    let live = true
    const finished = () => {
      if (!live) return
      setEnded(true)
      setHeard((was) => (was.has(page.id) ? was : new Set(was).add(page.id)))
    }
    const handleEnd = () => finished()
    n.onEnd = handleEnd

    // The tile's own one-shot, before the words — `sfx` on a line is
    // authored as exactly that.
    if (page.sfx) void n.sfx(page.sfx)

    void (async () => {
      try {
        await n.play(clip)
      } catch {
        // Could not even be asked for. A child cannot fix a 404, and the
        // words are on screen either way.
        finished()
        return
      }
      if (!live) return
      // A missing file does not reject: `play` catches it, plays silence and
      // resolves, and `onEnd` will never come.
      if (!n.playing) { finished(); return }

      // ONE AHEAD, AND ONLY ONE. `Narrator.MAX_DECODED` is 2 and decoded
      // audio is about 24x its compressed size — a place has ten clips and
      // prefetching them all would evict everything and, on an older iPad,
      // crash with no catchable error.
      const next = pages[open + 1]
      if (next && CLIPS[next.clipId]) {
        try { await n.prefetch([CLIPS[next.clipId]]) } catch { /* decoded on its turn */ }
      }
    })()

    return () => {
      live = false
      if (n.onEnd === handleEnd) n.onEnd = null
    }
  }, [clip, n, open, page, pages, unlocked])

  // ---------------------------------------------------------- the bar

  /**
   * Make something happen — the one meaning this button is allowed to have
   * (Controls.tsx). Speaking: pause. Paused mid-line: resume. Finished:
   * say it again from the top, because `resume()` has nothing left to
   * resume and a 104px target that does nothing is the exact failure that
   * file was written around.
   */
  const playPause = useCallback(() => {
    // The one gesture this screen can guarantee it will get on a cold
    // visit. Real work (`Narrator.unlock`'s own silent-sample trick and
    // `audioSession.type`), started synchronously inside this very click —
    // WebKit only honours a gesture for work begun before the first
    // `await`, which is `unlock()`'s own opening line. The page-play effect
    // above re-runs the instant `unlocked` flips and plays the current
    // page; nothing else needs telling.
    if (!unlocked) { void n.unlock(); return }
    if (n.playing) { n.pause(); return }
    // Said again from the top: the big picture — the photo, the greeting,
    // the drawn mark — arrives with the words exactly as it did the first
    // time, so `ended` (which is what hides it) has to clear here too, not
    // only inside the page-playing effect above.
    if (ended && clip) { setEnded(false); void n.play(clip); return }
    n.resume()
  }, [clip, ended, n, unlocked])

  const goHome = useCallback(() => {
    n.stop()
    onHome?.()
  }, [n, onHome])

  const goToNeighbour = useCallback((next: string) => {
    if (next === slug) return
    onPick?.(next)
  }, [onPick, slug])

  /** Open a tile. On a cold visit this is ALSO the child's first tap
   *  anywhere on the screen, so it carries the same unlock `playPause`
   *  does — otherwise a child who taps straight into a card without ever
   *  touching Play would open a page that never gets a chance to speak. */
  const openPage = useCallback((index: number) => {
    if (!unlocked) void n.unlock()
    // Moving on IS the congratulation ending — a tap here is always a
    // deliberate choice to hear something specific, so the caption must
    // stop reading "you have heard everything here" the moment it happens,
    // whatever the celebration's own clip is doing.
    setCelebrating(false)
    setOpen(index)
  }, [n, unlocked])

  // ------------------------------------------------------------- render

  const vars = {
    '--subject-accent': subject.accent,
    '--subject-page': subject.page,
  } as CSSProperties

  return (
    <main className="india place" data-place={slug} data-empty={place ? undefined : 'true'} style={vars}>
      <h1 className="visually-hidden">{place?.name ?? land?.name ?? 'This place'}</h1>

      <TourStage
        // The page being read, so the overlay slot is swept between them:
        // the dune the intro draws must not still be lying over the map
        // while the child looks at Chand Baori.
        scene={`${slug}:${page?.id ?? 'none'}`}
        // ONE COLOUR FOR THE WHOLE PAGE, unlike the tour, where the subject
        // changes with whatever picture is on stage. A page in a book is
        // printed in one run.
        subject={subjectKey ?? null}
        onPickState={goToNeighbour}
      >
        {/* The state's own border, drawn on the geography and traceable. */}
        {land && <StateShape d={land.d} subject={subjectKey} />}

        {/* The name plate — the page's title, in the corner of the picture. */}
        {(place || land) && (
          <p className="place-name">
            <span className="place-name__word">{place?.name ?? land?.name}</span>
            <span className="place-name__kind">
              {(place?.type ?? land?.type) === 'ut' ? 'a union territory' : 'a state'}
              {place ? ` · ${place.capital}` : ''}
            </span>
          </p>
        )}

        {/* A wordless "how much is left to hear" — ten beads, one per page,
            reflecting `heard` and never `open`/tap alone. See `PlaceTrail`'s
            own note for why this is scenery rather than a control, and why
            it sits in the opposite corner from the name plate rather than
            growing it. */}
        {place && <PlaceTrail pages={pages} open={open} heard={heard} />}

        {/* Whatever the open page has to show, arriving with its own words
            and gone the instant they end — never a permanent fixture a
            child has to find a close button for. A real photograph for a
            landmark and (once Task 5 has fetched one) the animal card; the
            greeting in its own script for `hello`; the same drawn mark the
            tile already carries, larger, for `food`/`festival`. The intro,
            and a card with nothing to show yet, show nothing: that is the
            honest state of this project today, not a bug. */}
        <div className="place-plate">
          {!ended && page?.photo && <Photograph key={page.id} word={page.alt ?? page.word} credit={page.photo} />}
          {!ended && page?.script && <Greeting key={page.id} script={page.script} />}
          {!ended && !page?.photo && !page?.script && page?.symbol && (
            <CardMark key={page.id} name={page.symbol} word={page.word} />
          )}
        </div>

        {/* The sentence being spoken, in the same strip, from the same
            component, over the same subject-coloured band. `celebrating`
            briefly points this at `ui.all-heard` instead of the open page's
            own clip — the words on screen must always match what is
            actually being said, and the open page's own sentence has
            already finished by the time this fires. */}
        <div className="say-lane">
          <div
            className="say"
            data-page={celebrating ? ALL_HEARD : (page?.id ?? '')}
            data-quiet={(celebrating ? CLIPS[ALL_HEARD] : clip) ? undefined : 'true'}
          >
            <ReadAlong clip={celebrating ? CLIPS[ALL_HEARD] ?? null : clip} />
          </div>
        </div>

        {!place && <NotWrittenYet name={land?.name ?? slug} onPick={onPick} />}
      </TourStage>

      {place && (
        <div className="place-shelf">
          <div className="place-shelf__row place-shelf__row--cards">
            {pages.slice(1, 1 + CARDS.length).map((p, i) => (
              <Tile
                key={p.id}
                page={p}
                open={open === i + 1}
                heard={heard.has(p.id)}
                onOpen={() => openPage(i + 1)}
              />
            ))}
          </div>
          <div className="place-shelf__row place-shelf__row--landmarks">
            {pages.slice(1 + CARDS.length).map((p, i) => (
              <Tile
                key={p.id}
                page={p}
                open={open === i + 1 + CARDS.length}
                heard={heard.has(p.id)}
                onOpen={() => openPage(i + 1 + CARDS.length)}
              />
            ))}
          </div>
        </div>
      )}

      <Controls onPlayPause={playPause} onHome={goHome} />
    </main>
  )
}

/** A tile on the shelf. Always a word, never only a picture — the same rule
 *  the control bar is held to, for the same six-year-old. */
function Tile({
  page,
  open,
  heard,
  onOpen,
}: {
  page: Page
  open: boolean
  heard: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      className="tap tile"
      data-open={open || undefined}
      data-heard={heard || undefined}
      aria-pressed={open}
      onClick={onOpen}
    >
      {page.photo ? (
        <span className="tile__photo">
          {/* `object-fit` framing, never a crop baked into the file: 18 of
              the 20 photographs are CC BY or CC BY-SA, and re-encoding or
              cropping one would make it Adapted Material. The full,
              unmodified frame is what the plate above shows. */}
          <img src={assetUrl(page.photo.file)} alt="" />
        </span>
      ) : (
        <span className="tile__mark">{page.glyph && <Glyph name={page.glyph} />}</span>
      )}
      <span className="tile__word">{page.word}</span>
      {heard && <Tick />}
    </button>
  )
}

/**
 * WHERE WE HAVE GOT TO: one bead per page, in the running order the shelf
 * itself lists them (intro, four cards, five landmarks — ten for a real
 * place). Grafted from a rejected candidate's own trail, with the one thing
 * that made it lose left behind: that candidate's beads tracked a LOCKED
 * SEQUENCE and doubled as the thing keeping a child out of the tile he
 * wanted for two and a half minutes. This screen has no sequence — any tile,
 * any order, always — so a bead here means only "heard" or "not yet",
 * against `heard` and never against `open`/a tap alone (a child who taps a
 * tile and immediately taps another has not heard it, and this must not
 * claim otherwise).
 *
 * SCENERY, NOT A CONTROL, for the same measurement `docs/handover.md`
 * records for the candidate this was grafted from: ten real 104px targets
 * do not fit across this screen at all, so shrinking them to fit would break
 * the one rule this app holds hardest. `aria-hidden` and `pointer-events:
 * none`; the honest count is real text instead, in `.visually-hidden`.
 *
 * Positioned as its own corner of the picture, opposite the name plate,
 * rather than folded into it — the name plate's own measured height feeds
 * `.place-plate`'s top padding (place.css), and growing it would mean
 * re-measuring a number this task was told not to touch by accident.
 */
function PlaceTrail({
  pages,
  open,
  heard,
}: {
  pages: Page[]
  open: number
  heard: ReadonlySet<string>
}) {
  if (pages.length <= 1) return null
  return (
    <>
      <p className="visually-hidden">{heard.size} of {pages.length} heard</p>
      <div className="place-trail" aria-hidden="true">
        {pages.map((p, i) => (
          <span
            key={p.id}
            className="place-bead"
            data-state={heard.has(p.id) ? 'heard' : i === open ? 'now' : 'ahead'}
          />
        ))}
      </div>
    </>
  )
}

/**
 * The big picture for `food` and `festival`: the exact drawn mark the tile
 * beside it already carries (`Glyph.tsx`), larger, on the same printed plate
 * a photograph sits on. Honest specifically BECAUSE it is generic — see
 * `Page.symbol`'s own note: a bowl commits to no dish, a rangoli commits to
 * no single festival's own imagery (a chariot at Rath Yatra, a parade on
 * Republic Day), so blown up to fill the plate it still claims nothing the
 * words could contradict. This is deliberately NOT a new drawing borrowed
 * from a rejected candidate's own animal/food/festival art — reusing the
 * mark the tile already carries is the smaller, more honest change, and the
 * one that cannot introduce a second shape for the same category to drift
 * out of step with the first.
 */
function CardMark({ name, word }: { name: GlyphName; word: string }) {
  return (
    <div className="place-mark">
      <span className="place-mark__glyph" aria-hidden="true">
        <Glyph name={name} size="100%" />
      </span>
      <span className="place-mark__word">{word}</span>
    </div>
  )
}

/** Heard all the way through. Drawn rather than a character, for the same
 *  reason `Glyph.tsx` exists at all: a platform tick is a platform's
 *  drawing, in a book that has its own. */
function Tick() {
  return (
    <span className="tile__tick" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none">
        <path d="M4 13 L10 19 L20 5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/**
 * The photograph, on a printed plate, with its own name in bold beneath it
 * and the credit under that.
 *
 * THE NAME IS NEW. A rejected candidate's own "big picture" put the name in
 * bold beneath the photo and nothing else did — this screen's photo used to
 * carry only the small credit line, with the tile's own word the only place
 * a name appeared at all. Grafted here alongside the self-clearing plate it
 * arrived with (`!ended` in the caller): together they are what makes this a
 * picture arriving on its own page rather than a permanent fixture with a
 * caption bolted to it.
 *
 * UNMODIFIED, AND FRAMED WITH CSS. The image is sized by `max-width` /
 * `max-height` and never cropped or overlaid: cropping or drawing on a CC
 * BY-SA file makes an adaptation, which would have to be released under the
 * same licence. The credit sits with the image rather than only on the
 * colophon page, which is what the licences actually ask for.
 *
 * `attributionHtml` is rendered verbatim. It is generated at fetch time from
 * Wikimedia's own extmetadata (`scripts/lib/wiki.mjs`) and already names the
 * author, links the licence deed and links the source — `Credits.tsx` does
 * exactly this and says why: rewriting a credit by hand is how a credit goes
 * wrong.
 */
function Photograph({ word, credit }: { word: string; credit: Credit }) {
  return (
    <figure className="place-photo">
      <img className="place-photo__img" src={assetUrl(credit.file)} alt={word} />
      <figcaption className="place-photo__cap">
        <span className="place-photo__name">{word}</span>
        <span
          className="place-photo__by"
          dangerouslySetInnerHTML={{ __html: credit.attributionHtml }}
        />
      </figcaption>
    </figure>
  )
}

/** The greeting, written the way it is written here. `script` is authored to
 *  be SEEN and never narrated — the line already says it aloud in English
 *  letters — so this is a picture of the words, not a caption. The plate is
 *  `effects.css`'s own `.cue-script`, the one the tour already prints three
 *  greetings on at beat 13. */
function Greeting({ script }: { script: string }) {
  return (
    <div className="cue-script">
      <div className="cue-greeting is-now">
        <span className="cue-greeting__native">{script}</span>
      </div>
    </div>
  )
}

/**
 * Thirty-two of the thirty-six places have no page written yet, and the tour
 * tells every child to tap any state. So this is a real page rather than an
 * error: the state is still lit, its border still drawn, its neighbours
 * still there — and the four that ARE written are offered, so a tap that
 * found nothing does not end in a dead end.
 */
function NotWrittenYet({ name, onPick }: { name: string; onPick?: (slug: string) => void }) {
  return (
    <div className="place-empty">
      <p className="place-empty__line">
        We have not been to {name} yet.
      </p>
      <p className="place-empty__line place-empty__line--small">Here is where we have been:</p>
      <div className="place-empty__row">
        {WRITTEN.map((p) => (
          <button
            key={p.id}
            type="button"
            className="tap tile"
            onClick={() => onPick?.(p.id)}
          >
            <span className="tile__word">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
