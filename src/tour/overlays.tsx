import type { ReactNode } from 'react'
import { Symbol } from './effects/Symbol'
import { Seas, WATERS } from './effects/art/Sea'
import { Counter } from './effects/Counter'
import { Flag } from './effects/Flag'
import { River } from './effects/River'
import { Mountains } from './effects/Mountains'
import { Script } from './effects/Script'

/**
 * The seam between a cue and a picture.
 *
 * `cues.ts` never names an artefact: it looks the verb up here and hands
 * whatever comes back to `setOverlay`. Six verbs, six effects, and every one
 * of them takes itself off stage again — there is no `onDone` in this
 * signature and nothing ever clears the slot.
 */
export type OverlayRenderer = (arg: string | undefined) => ReactNode

/**
 * Why every effect gets a key nobody has used before.
 *
 * The overlay slot is one position in TourStage's tree, so React reconciles
 * whatever lands there against whatever was there before. Same type, same
 * key, and it is the SAME component instance with new props — which for an
 * effect that has already run its hold and taken itself off stage means
 * nothing appears at all. That is not hypothetical: it is what tapping "say
 * it again" on a beat would do. A fresh key is a fresh mount, so a symbol
 * revealed twice animates twice.
 *
 * `Script` is the one exception, and it is deliberate — see below.
 */
let nth = 0

function cue(verb: string, arg: string | undefined, art: ReactNode, key?: string): ReactNode {
  return (
    // data-verb/data-arg say which cue put this on screen — for a test, and
    // for anyone watching the tour with devtools open.
    <div className="cue" data-verb={verb} data-arg={arg ?? ''} key={key ?? `${verb}:${arg}:${++nth}`}>
      {art}
    </div>
  )
}

/**
 * The three seas are one picture, not three.
 *
 * "Water touches India on three sides" — and the three cues arrive seven
 * words apart into this one slot, so with a fresh key each one would wipe out
 * the last and the child would never see three of anything. Same exception,
 * same reason and same mechanism as `showScript` below: a stable key keeps
 * one mounted instance, and `nonce` moves the emphasis and restarts its hold.
 *
 * It belongs here rather than in `cues.ts`, which is Task 7's seam and stays
 * shut: the registry hands `revealSymbol` its argument and this file decides
 * what a picture of it is.
 */
const SEAS = new Set(WATERS.map((w) => w.id))

export const OVERLAYS: Record<string, OverlayRenderer> = {
  revealSymbol: (arg) =>
    arg && SEAS.has(arg)
      ? cue('revealSymbol', arg, <Seas named={arg} nonce={String(++nth)} />, 'seas')
      : cue('revealSymbol', arg, <Symbol name={arg} />),
  unfurlFlag: (arg) => cue('unfurlFlag', arg, <Flag />),
  countTo: (arg) => cue('countTo', arg, <Counter to={Number(arg)} />),
  traceRiver: (arg) => cue('traceRiver', arg, <River name={arg} />),
  raiseMountains: (arg) => cue('raiseMountains', arg, <Mountains />),
  // Stable key, on purpose: the three greetings arrive a second apart and
  // belong on one card together, so this must be one component instance
  // across all three cues rather than three mounts. `nonce` is what restarts
  // its hold each time.
  showScript: (arg) => cue('showScript', arg, <Script greeting={arg} nonce={String(++nth)} />, 'showScript'),
}
