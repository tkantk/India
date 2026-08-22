/**
 * The cue registry: verb -> effect. The seam between the narration engine
 * and everything visible — this is what turns "at 1.53 seconds, playSfx
 * tiger-growl" into a tiger actually growling.
 *
 * THE RULE THAT MATTERS MOST: `dispatch` never throws. A cue fires
 * mid-narration, off the audio clock, from a rAF callback, while a child is
 * watching. An exception there kills the tour for someone who cannot debug
 * it, cannot reload deliberately, and will simply conclude the thing is
 * broken. An unknown verb, a nonsense argument, a missing sound, a slug that
 * is not on the map — all of these degrade to "that bit did not happen" and
 * let the narration carry on.
 *
 * Handlers never reach into React state directly. The only door in is
 * `CueApi`, assembled once by `TourStage` and handed to every handler.
 */
import type { ReactNode } from 'react'
import type { Bbox, Cue } from '../types'
import type { MapApi } from '../map/useMapNodes'
import geo from '../data/geo.json'
import { OVERLAYS } from './overlays'

export type CueApi = {
  /** From Task 5. */
  map: MapApi
  /** Wraps Task 6's `flyTo`/`home`. A handler fires the flight and moves on
   *  — it does not await one landing. */
  camera: { flyTo(bbox: Bbox): void; home(): void }
  /** The engine's one-shot effect. A missing file is already silence there
   *  (`sound-credits.json` is the manifest of what actually exists) — the
   *  registry passes the name through unconditionally and does not guard it
   *  a second time. */
  sfx: (name: string) => void
  setOverlay: (node: ReactNode | null) => void
}

/**
 * `hold` is the art's derived lifetime (`Cue.hold`, in ms), handed to `art()`
 * so it can pass it on to `overlays.tsx`. Every other handler ignores the
 * third argument, which JS/TS both allow a shorter function to do.
 */
export type CueHandler = (arg: string | undefined, api: CueApi, hold?: number) => void

type GeoPlace = { type: 'state' | 'ut'; bbox: Bbox }
const PLACES = geo.places as unknown as Record<string, GeoPlace>

/** Derived from geo.json's `type` field, never a hardcoded list — a place
 *  added or reclassified in Plan 1's data is picked up here for free. */
const STATE_SLUGS = Object.keys(PLACES).filter((slug) => PLACES[slug].type === 'state')
const UT_SLUGS = Object.keys(PLACES).filter((slug) => PLACES[slug].type === 'ut')

/**
 * One entry per verb that still needs Task 8's art: look the renderer up in
 * `overlays.ts` and hand whatever it returns to `setOverlay`. This file never
 * names an artefact directly, which is what lets Task 8 swap every
 * placeholder for real art without touching a line here.
 */
function art(verb: string): CueHandler {
  return (arg, api, hold) => {
    const render = OVERLAYS[verb]
    if (render) api.setOverlay(render(arg, hold))
  }
}

/**
 * `highlightState` and `lightNeighbour` both just light one state on the
 * map; the distinction between them is authorial (a place's own state versus
 * a mentioned neighbour), not behavioural. An unknown slug is a no-op —
 * `MapApi.highlight` already guards it, because cues carry authored
 * arguments and a typo in the content must not end a child's tour.
 */
function highlightOne(arg: string | undefined, api: CueApi): void {
  if (!arg) return
  api.map.highlight(arg, true)
}

/** Exactly one entry per verb — the twelve the content actually uses. */
export const CUES: Record<string, CueHandler> = {
  playSfx: (arg, api) => {
    if (arg) api.sfx(arg)
  },
  revealSymbol: art('revealSymbol'),
  highlightAllStates: (_arg, api) => api.map.highlightMany(STATE_SLUGS),
  highlightUnionTerritories: (_arg, api) => api.map.highlightMany(UT_SLUGS),
  countTo: art('countTo'),
  zoomTo: (arg, api) => {
    const place = arg ? PLACES[arg] : undefined
    if (place) api.camera.flyTo(place.bbox)
  },
  unfurlFlag: art('unfurlFlag'),
  traceRiver: art('traceRiver'),
  raiseMountains: art('raiseMountains'),
  showScript: art('showScript'),
  highlightState: highlightOne,
  lightNeighbour: highlightOne,
}

/**
 * Look the verb up and run it. Never throws.
 *
 * A miss — a verb nobody registered — is logged once at debug level and
 * dropped, not thrown: a typo in authored content must not end a child's
 * tour. A handler that throws anyway (an argument reaching further than
 * expected) is caught here too, not left to the engine's own try/catch
 * around `onCue` — this function's own contract is "never throws", checked
 * directly by a test, not only defended two layers up.
 */
export function dispatch(cue: Cue, api: CueApi): void {
  const handler = CUES[cue.do]
  if (!handler) {
    console.debug(`[cues] no handler for "${cue.do}"`)
    return
  }
  try {
    handler(cue.arg, api, cue.hold)
  } catch (err) {
    console.debug(`[cues] "${cue.do}" failed`, err)
  }
}
