/**
 * The camera: the flight from the whole country down to one state, and back.
 *
 * Everything about the way this is done comes from one fact about WebKit's
 * legacy SVG engine, which is what runs on every iPad this has to work on:
 *
 *   - `LegacyRenderSVGModelObject` derives from `RenderElement`, not from
 *     `RenderLayerModelObject`, so an SVG child can never own a compositor
 *     layer. A transform on a `<g>` is a main-thread software repaint of all
 *     36 paths, every frame.
 *   - Animating `viewBox` is worse still: `SVGSVGElement::svgAttributeChanged`
 *     calls `setNeedsTransformUpdate()` — a layout invalidation — and
 *     `invalidateResourceImageBuffersIfNeeded()`. Layout, plus a full repaint,
 *     plus a resource-cache eviction, on every frame of the flight.
 *   - The `<svg>` element itself is a `RenderReplaced`, hence a
 *     `RenderLayerModelObject`, and so is an HTML `<div>`. Those can composite.
 *
 * So the flight is TRANSFORM, THEN COMMIT:
 *
 *   1. animate a CSS transform on the HTML `.stage` wrapper for 350-450 ms,
 *      which the compositor runs by itself and which holds 60 fps;
 *   2. when it ends, in ONE frame, write the target rect into every layer's
 *      `viewBox` and drop the transform back to identity.
 *
 * That is one expensive frame instead of twenty-four, and it lands crisp:
 * a composited layer keeps its pre-animation rasterisation for the whole
 * animation (WebKit bug 27684), so a zoom that stays a transform stays soft.
 * Re-rasterising at the destination is the only cure.
 *
 * The commit writes the preimage of the whole view, not the target bbox, so
 * that the swap is invisible — see `committedRect`.
 *
 * This file imports no JSON and names no window global at the top level, for
 * the same reason `hitLayer.ts` does not: `scripts/probe-camera.mjs` loads it
 * into a real browser through Node's type stripping, so that the browser
 * measures the camera that ships rather than a copy of it.
 */
import type { Bbox } from '../types'
import { isCheap } from '../lib/cheapMode.ts'

/** The transform that brings a bbox into the middle of a view, in viewBox
 *  units: a point p is drawn at `p * scale + (x, y)`. */
export type Frame = { scale: number; x: number; y: number }

export type FlyOptions = {
  /** Milliseconds. 0 commits immediately, with no animation at all. */
  duration?: number
  /** Breathing room around the target, in viewBox units. */
  padding?: number
  /** Any CSS easing. See EASE for why the default is not an ease-out. */
  easing?: string
}

/** Mid-way through the 350-450 ms the brief allows: long enough to read as
 *  travel, short enough that a child does not start tapping again. */
const FLIGHT_MS = 400

/** The cheap flight. Still a flight, just less of one. */
const CHEAP_MS = 200

/**
 * A gentle ease, in and out.
 *
 * The obvious choice is an ease-out, and it is wrong here. A transform
 * animation interpolates `scale` linearly, but what an eye reads as "how fast
 * am I zooming" is the rate of change of its LOGARITHM — which for a linear
 * ramp decays as 1/scale. A flight to Delhi is a 10x zoom, so with a linear
 * ramp the first half of the time already covers three quarters of the
 * apparent journey, and an ease-out on top of that puts it at 94%: a lurch,
 * then a crawl. An ease-in-out cancels most of that back out (0.74 at the
 * halfway point, against a perfect 0.5) and still settles gently at the end.
 */
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)'

/**
 * How far a single flight may zoom in.
 *
 * USED TO BE 12, DERIVED FROM GEOMETRY THAT NO LONGER EXISTS. The old
 * comment here said Lakshadweep's bbox was four units across and framing it
 * would be a 250x magnification of a simplified outline — soup, with no
 * coastline a child could recognise — and set 12 as "about as far as this
 * geometry stays readable." Plan 3 then rebuilt every place's geometry with
 * per-place screen-space simplification that kept every ring (Lakshadweep
 * went from 4 rings to 35, Andaman from 52 to 220), and nobody re-derived
 * this number afterwards. Measured directly: Lakshadweep's real bbox is
 * 57x130, needing only 8.5x to fill a screen — nowhere near the old cap, let
 * alone the new one — so the geometry the "12" was tuned against is simply
 * gone. Left at 12, the stale cap surfaced as a NEW bug on `PlaceScreen`'s
 * own arrival flight, whose padding is a proportion of a place's own size
 * (`ARRIVAL_MARGIN`, `PlaceScreen.tsx`) rather than this file's flat
 * `PLACE_PADDING`: Chandigarh's tiny bbox needs 60.6x to fill that frame,
 * capped at 12 landed it at 5% of the map box — a speck, `npm run
 * place:strip`'s own floor (`MIN_FILL_FRACTION`, 0.10) failing on all 12
 * devices. Delhi, Goa and Sikkim were ALSO being quietly capped below their
 * own designed proportion (`ARRIVAL_MARGIN`'s own comment says Delhi should
 * land at "46% of the frame"; capped at 12 it only ever reached 20%) — they
 * merely stayed on the right side of the 0.10 floor, so nothing failed loudly.
 *
 * RE-DERIVED, not re-guessed: computed the scale every real flight in this
 * app actually asks for — both padding recipes (this file's own
 * `PLACE_PADDING`/`pinR`, used by the tour's `zoomTo`/`pick`; and
 * `PlaceScreen`'s own `ARRIVAL_MARGIN`) against every one of the 36 places'
 * real bbox — and took the largest. That is Chandigarh's own arrival flight,
 * 60.6x; nothing else in the app, tour or place screen, asks for more (the
 * tour's own worst case, also Chandigarh, only reaches 11.83x — under the
 * OLD cap already, which is why the tour never showed this bug). 65 clears
 * that with a small margin, so every real flight today runs UNCAPPED, at
 * whatever scale its own padding recipe asks for, and this stays a genuine
 * safety ceiling only for a future flight nobody has measured yet.
 *
 * WHY NOT JUST DELETE THE CAP. Every stroke this app draws round a state is
 * either `vector-effect: non-scaling-stroke` (`map.css`'s 1.5px land-edge
 * border, its 4px island-territory border, its 3px glow) or, on
 * `PlaceScreen`'s own `StateShape`, a width scaled by `1 / (that flight's
 * own scale)` (`useMapZoom`) — both hold a CONSTANT number of CSS pixels
 * regardless of camera scale, so a border never grows to swamp a state as
 * this number rises; checked directly at 65x on Chandigarh's own 15-point
 * outline (the least detailed geometry in the data, and the one that reaches
 * the new ceiling) and it reads as a small, crisp, recognisable polygon, not
 * soup. The risk this ceiling actually guards against is a flight nobody has
 * measured yet — a future landmark-scale target smaller than any of today's
 * 36 place bboxes — not any flight that exists today.
 *
 * There is deliberately no floor: every flight is computed from wherever the
 * camera already is, so coming home from a tight view needs a scale far
 * below 1.
 */
export const MAX_SCALE = 65

/**
 * The floor under a *place*'s padding when the map's own camera flies to
 * it: what a caller gets if it passes nothing more specific. The primitive
 * below (`frame`) takes whatever padding it is given; this is the map's
 * fallback house style, not a per-place guarantee.
 *
 * A single global value large enough to cover every place cannot be this
 * constant, and the reasoning is worth spelling out because it is easy to
 * get backwards. `frame()` centres and pads the *bbox*; a place's pin (its
 * pole of inaccessibility) is only guaranteed to fall somewhere *inside*
 * that bbox — `build-hitlayer.test.mjs` asserts this — not at its centre.
 * A pin sitting near one edge, plus its own radius, can reach up to `pinR`
 * past that edge, so covering every place with one constant means covering
 * the WORST place: `build-hitlayer.mjs`'s `TARGET_PIN_R`, 112.6, the hard
 * ceiling every `pinR` is clamped to. But `pinR` varies enormously by
 * design (Andaman & Nicobar's is 112.6; Delhi's is 16.1) precisely because
 * a uniform tap-target size cannot work for a country where one place is a
 * scattered archipelago and another sits between two neighbours' own poles
 * — using the ceiling for every flight throws that variation away. Measured
 * directly: a flat 113 (the ceiling, rounded up) costs Delhi 10.38x -> 4.13x
 * zoom, and every one of the 36 places loses real zoom too (mean 1.73x
 * smaller) — none of them are `MAX_SCALE`-capped at either value, so
 * nothing absorbs it.
 *
 * So the ceiling belongs where the variation lives: each caller that knows
 * its place's `pinR` (from `hit.json`) passes `Math.max(PLACE_PADDING,
 * pinR)` as `flyTo`'s own `padding` — see `cues.ts`'s `zoomTo` and
 * `GrandTour.tsx`'s `pick`. That is not a second magic number: it is the
 * same by-construction argument (pin ⊂ bbox, `pinR` ≤ `TARGET_PIN_R`)
 * applied per place instead of to the worst place, so 16 of the 36 places
 * keep their full, uncapped zoom (`pinR` under 40) and every other place
 * pays only for what its own geometry actually needs. `PLACE_PADDING`
 * itself stays a small constant — visual breathing room for a bbox-only
 * flight with no known pin, or for the many places whose `pinR` is smaller
 * than it — not a safety ceiling.
 */
export const PLACE_PADDING = 40

/**
 * The transform that brings `bbox` into the middle of `view`, with `padding`
 * viewBox units of air around it.
 *
 * Pure maths in viewBox units, so it can be reasoned about and tested without
 * a DOM. Fits by the more constrained axis, so nothing is ever cropped.
 */
export function frame(bbox: Bbox, view: Bbox, padding = 0): Frame {
  const [vx, vy, vw, vh] = view
  const [bx, by, bw, bh] = bbox
  const w = bw + padding * 2
  const h = bh + padding * 2

  const fit = Math.min(vw / w, vh / h)
  // A zero-width place (or a zero-width view) is not a reason to hand back
  // NaN and paint nothing: fall back to standing still.
  const scale = Math.min(Number.isFinite(fit) && fit > 0 ? fit : 1, MAX_SCALE)

  return {
    scale,
    x: vx + vw / 2 - (bx + bw / 2) * scale,
    y: vy + vh / 2 - (by + bh / 2) * scale,
  }
}

/**
 * The rect to commit at the end of a flight: the preimage of the whole view
 * under `f`, which is to say exactly the region the transform was showing.
 *
 * It is NOT the target bbox, and that difference is the whole trick. Both the
 * pre-commit and post-commit renderings letterbox by `preserveAspectRatio`,
 * so they agree only if the committed rect has the view's aspect ratio.
 * Committing the raw bbox would jump by however much padding was asked for
 * and by the whole letterbox difference. Committing the preimage lands on the
 * same pixels to the last decimal, whatever shape the screen is.
 */
export function committedRect(f: Frame, view: Bbox): Bbox {
  return [
    (view[0] - f.x) / f.scale,
    (view[1] - f.y) / f.scale,
    view[2] / f.scale,
    view[3] / f.scale,
  ]
}

/** Three decimals for the committed rect: a thousandth of a viewBox unit is
 *  a thousandth of a CSS pixel, and the attribute stays readable in devtools. */
const round = (v: number) => Math.round(v * 1000) / 1000

/** The transform is rounded far finer, because its error is multiplied by the
 *  zoom before it reaches the screen: at 10x, three decimals of scale is a
 *  tenth of a pixel of jump at the commit, and six is a thousandth. */
const fine = (v: number) => Math.round(v * 1e6) / 1e6

const rectAttr = (r: Bbox) => r.map(round).join(' ')

function readViewBox(svg: SVGSVGElement): Bbox | null {
  const raw = svg.getAttribute('viewBox')
  if (!raw) return null
  const n = raw.trim().split(/[\s,]+/).map(Number)
  return n.length === 4 && n.every(Number.isFinite) ? (n as Bbox) : null
}

/**
 * The same transform, expressed in the CSS pixels of the stage box.
 *
 * `frame` works in viewBox units; the stage is transformed in pixels, and the
 * two differ by the mapping `preserveAspectRatio="xMidYMid meet"` applies:
 * a scale `k` and a letterbox offset `o`. Solving `C(M(p)) = M(T(p))` for the
 * CSS transform C gives back the same scale and a translation of
 * `k*t + k*Vo*(s-1) + o*(1-s)`.
 *
 * `clientWidth`, not `getBoundingClientRect()`: the second one reports the
 * box as *transformed*, so interrupting a flight would compound.
 */
function cssTransform(f: Frame, stage: HTMLElement, view: Bbox): string {
  const w = stage.clientWidth
  const h = stage.clientHeight
  const k = Math.min(w / view[2], h / view[3]) || 0
  const ox = (w - k * view[2]) / 2
  const oy = (h - k * view[3]) / 2
  const dx = k * f.x + k * view[0] * (f.scale - 1) + ox * (1 - f.scale)
  const dy = k * f.y + k * view[1] * (f.scale - 1) + oy * (1 - f.scale)
  return `translate(${fine(dx)}px, ${fine(dy)}px) scale(${fine(f.scale)})`
}

/** The flight currently in the air over a given stage, if there is one. */
type Flight = { anim: Animation; land: () => void }
const flights = new WeakMap<HTMLElement, Flight>()

/**
 * End whatever is in the air over this stage, right now, by landing it.
 *
 * Landing rather than reverting: the child is already looking at the target,
 * so snapping back to where the flight began would be a jump in the wrong
 * direction. The next flight is then computed from the committed viewBox,
 * which is why nothing ever compounds.
 */
function landInFlight(stage: HTMLElement): void {
  const flight = flights.get(stage)
  if (!flight) return
  flights.delete(stage)
  flight.anim.cancel()
  flight.land()
}

/**
 * Fly the camera to `target`, then commit.
 *
 * `svg` is every layer that shares the viewBox — all three of them in the
 * real map. Committing only the visible layer would leave the hit layer
 * behind, and the hit layer is what a tap is tested against: the map would go
 * dead the moment a child zoomed in.
 */
export function flyTo(
  stage: HTMLElement,
  svg: SVGSVGElement | readonly SVGSVGElement[],
  target: Bbox,
  opts: FlyOptions = {},
): Promise<void> {
  const layers: readonly SVGSVGElement[] = Array.isArray(svg) ? [...svg] : [svg]
  landInFlight(stage)

  const view = layers.length ? readViewBox(layers[0]) : null
  if (!view) return Promise.resolve()

  const f = frame(target, view, opts.padding ?? 0)
  // Computed once, up front, and in viewBox units — so an iPad turned
  // sideways mid-flight still lands on the right rect. Only the pixels of the
  // transform would be stale, and the commit replaces those anyway.
  const rect = rectAttr(committedRect(f, view))

  /** The one expensive frame. Everything in it happens in one task, so the
   *  browser draws the new viewBox and the identity transform together. */
  const land = () => {
    for (const layer of layers) layer.setAttribute('viewBox', rect)
    stage.style.transform = ''
    stage.style.willChange = ''
    // Anything drawing in the map's coordinates from OUTSIDE the stage — the
    // tour's overlay is a sibling of `.map`, not a child of it — has to hear
    // about this in the same frame, or it stays registered on where the map
    // used to be. See `watch` below.
    if (bound && bound.stage === stage) announce()
  }

  const ms = opts.duration ?? (isCheap() ? CHEAP_MS : FLIGHT_MS)
  // iOS 12 has no Web Animations API. A cut is not a flight, but a child
  // still arrives, and nothing is left half-transformed.
  if (ms <= 0 || typeof stage.animate !== 'function') {
    land()
    return Promise.resolve()
  }

  const to = cssTransform(f, stage, view)
  // Added here and dropped in `land`, never left on: a full-screen composited
  // layer costs about 12.6 MB on a 2048x1536 iPad, and WebKit drops tiles
  // under memory pressure, which a child sees as white flashes.
  stage.style.willChange = 'transform'
  // The destination is set as a style and the animation merely covers the
  // distance, so there is no fill mode to unwind and no frame where the
  // transform has been dropped but the viewBox has not caught up.
  stage.style.transform = to

  const anim = stage.animate([{ transform: 'none' }, { transform: to }], {
    duration: ms,
    easing: opts.easing ?? EASE,
  })
  const flight: Flight = { anim, land }
  flights.set(stage, flight)

  return anim.finished.then(
    () => {
      if (flights.get(stage) !== flight) return
      flights.delete(stage)
      land()
    },
    // Cancelled, which only `landInFlight` does — and it has already landed us.
    () => {},
  )
}

// --------------------------------------------------------------- the binding

/**
 * The map's own camera.
 *
 * Module-scoped for the same reason the node cache is: there is exactly one
 * map on screen for the life of the app, and the cue registry has to reach it
 * from outside the component that renders it.
 */
export type CameraApi = {
  flyTo(target: Bbox, opts?: FlyOptions): Promise<void>
  home(opts?: FlyOptions): Promise<void>
  /** The rect the map is showing right now, or null if no map is mounted. */
  view(): Bbox | null
  /**
   * Put the camera somewhere RIGHT NOW, with no flight — the shape a finger
   * needs, because a drag has to track the finger frame by frame and an
   * animation between frames would fight it.
   *
   * Clamped through `clampView`, so no gesture can zoom out past the whole
   * country, pinch past `MAX_SCALE`, or drag India off the screen. Lands any
   * flight still in the air first: if the child grabs the map mid-arrival,
   * the finger wins, which is the only answer that does not feel broken.
   *
   * Returns the rect actually committed, which is not always the one asked
   * for — the caller needs to know where it really ended up to compute the
   * next frame's delta from, or a clamped drag would keep accumulating
   * movement the map never made and the finger would drift off the land it
   * grabbed.
   */
  setView(view: Bbox): Bbox | null
  /**
   * Follow that rect. Fires on every commit, and whenever a map is bound or
   * let go of. Returns the unsubscribe.
   *
   * This exists because not everything that draws in the map's coordinates is
   * inside the map. The tour's overlay is a SIBLING of `.map` — it has to be,
   * so that art can sit over the whole stage without being inside the layer
   * the camera transforms — which puts it outside `bindCamera`'s
   * `:scope > svg` and therefore outside the commit. Handing it the static
   * home rect instead is how the Ganga ends up drawn across a view of Delhi.
   * See `useCameraView`, which is the only caller.
   */
  watch(fn: (view: Bbox | null) => void): () => void
}

type Bound = { stage: HTMLElement; layers: SVGSVGElement[]; home: Bbox }
let bound: Bound | null = null

type Watcher = (view: Bbox | null) => void
const watchers = new Set<Watcher>()

/**
 * Tell every watcher where the map is now.
 *
 * A copy of the set, so a watcher that unsubscribes on being called does not
 * disturb the iteration; and each one is guarded, because this runs in the
 * one expensive frame of a flight and a throwing subscriber must not leave
 * the rest of them — or the flight — half done.
 */
function announce(): void {
  const view = camera.view()
  for (const watcher of [...watchers]) {
    try {
      watcher(view)
    } catch (err) {
      console.debug('[camera] a watcher threw', err)
    }
  }
}

/**
 * Point the camera at a mounted map, or at nothing.
 *
 * `MapStage` hands over the stage ELEMENT, not a class name. A
 * `querySelector('.stage')` here would keep working right up until somebody
 * renamed the class, and then fail in silence — no error, no flight, a map
 * that simply stops zooming. The layers are then found structurally, as the
 * svg children of the stage, because "shares the stage's viewBox" is exactly
 * what being one of those children means.
 *
 * The camera then writes `viewBox` straight onto elements React rendered,
 * exactly as the node cache writes classes onto them. That is safe because
 * React only touches an attribute when the PROP behind it changes, and the
 * one MapStage passes is a constant — but it is the reason the camera must
 * never be given an element whose viewBox React might re-render.
 */
export function bindCamera(stage: HTMLElement | null): void {
  // Land anything still in the air over the map being let go of. A browser
  // stops ticking an animation whose target has left the render tree, so
  // `finished` never settles: measured in Chrome, six seconds after the map
  // was detached mid-flight the promise was still pending, the wrapper still
  // carried its transform and its will-change, and the viewBox had never been
  // committed. Task 7 awaits that promise — the tour would hang for good, and
  // the whole detached 269 KB map would be retained behind it.
  if (bound && bound.stage !== stage) landInFlight(bound.stage)
  bound = null
  if (stage) {
    const layers = [...stage.querySelectorAll<SVGSVGElement>(':scope > svg')]
    const home = layers.length ? readViewBox(layers[0]) : null
    if (home) bound = { stage, layers, home }
  }
  // A new map, or no map at all: either way the rect the watchers are drawing
  // against has just changed under them.
  announce()
}

export const camera: CameraApi = {
  flyTo(target, opts = {}) {
    if (!bound) return Promise.resolve()
    // A place framed edge to edge looks trapped; the primitive takes what it
    // is given, and this is the house style for flying to a *place*.
    return flyTo(bound.stage, bound.layers, target, { padding: PLACE_PADDING, ...opts })
  },
  home(opts = {}) {
    if (!bound) return Promise.resolve()
    return flyTo(bound.stage, bound.layers, bound.home, { padding: 0, ...opts })
  },
  view() {
    return bound && bound.layers.length ? readViewBox(bound.layers[0]) : null
  },
  setView(view) {
    if (!bound) return null
    landInFlight(bound.stage)
    const next = clampView(view, bound.home)
    const rect = rectAttr(next)
    for (const layer of bound.layers) layer.setAttribute('viewBox', rect)
    // Same obligation the flight's own `land()` has: anything drawing in the
    // map's coordinates from outside the stage is now pointing at where the
    // map used to be until it hears this.
    announce()
    return next
  },
  watch(fn) {
    watchers.add(fn)
    return () => {
      watchers.delete(fn)
    }
  },
}

/**
 * Clamp a proposed view rect to what a child is allowed to explore to.
 *
 * Three rules, in this order, and the order matters:
 *
 * 1. NEVER WIDER THAN HOME. Zooming out past the whole country would put
 *    India in a corner of a sea of nothing, and there is no content out
 *    there — `world.json`'s neighbours are painted as a backdrop for the
 *    country, not as a map to explore.
 * 2. NEVER TIGHTER THAN `MAX_SCALE`. The same ceiling `frame()` already
 *    respects, for the same reason: past it the simplified geometry stops
 *    being a recognisable shape and becomes soup. A finger can pinch much
 *    harder than any authored flight ever asks for, so this is the only
 *    place that ceiling is enforced against a gesture.
 * 3. NEVER OFF THE EDGE. Once the size is settled the rect is slid back
 *    inside `home`, so the country can never be dragged off-screen and
 *    lost — the failure a six-year-old cannot recover from on his own,
 *    because there is no scrollbar to tell him where he is.
 *
 * Aspect ratio is preserved throughout: both size rules scale width and
 * height by the same factor, so a clamp can never letterbox the map into a
 * shape its `preserveAspectRatio` then has to correct for.
 */
export function clampView(view: Bbox, home: Bbox): Bbox {
  let [x, y, w, h] = view
  if (!(w > 0 && h > 0)) return home

  // 1. no wider than home, 2. no tighter than MAX_SCALE — both as one
  // symmetric factor so the rect keeps its shape.
  const down = Math.min(1, home[2] / w, home[3] / h)
  w *= down; h *= down
  const up = Math.max(1, home[2] / MAX_SCALE / w, home[3] / MAX_SCALE / h)
  w *= up; h *= up

  // 3. slide back inside home. `Math.max` on the range guards the degenerate
  // case where a rounding hair leaves the rect a shade wider than home:
  // without it the clamp would invert and throw the view to the far corner.
  const maxX = Math.max(home[0], home[0] + home[2] - w)
  const maxY = Math.max(home[1], home[1] + home[3] - h)
  x = Math.min(Math.max(x, home[0]), maxX)
  y = Math.min(Math.max(y, home[1]), maxY)
  return [x, y, w, h]
}
