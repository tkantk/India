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
 * Lakshadweep's bbox is four units across; framed to fill the screen it would
 * be a 250x magnification of a simplified outline — soup, with no coastline a
 * child could recognise. Twelve is about as far as this geometry stays
 * readable. There is deliberately no floor: every flight is computed from
 * wherever the camera already is, so coming home from a tight view needs a
 * scale far below 1.
 */
const MAX_SCALE = 12

/** The room a *place* gets when the map's own camera flies to it. The
 *  primitive below takes what it is given; this is the map's house style. */
const PLACE_PADDING = 40

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
}

type Bound = { stage: HTMLElement; layers: SVGSVGElement[]; home: Bbox }
let bound: Bound | null = null

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
  bound = null
  if (!stage) return
  const layers = [...stage.querySelectorAll<SVGSVGElement>(':scope > svg')]
  const home = layers.length ? readViewBox(layers[0]) : null
  if (!home) return
  bound = { stage, layers, home }
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
}
