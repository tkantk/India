/**
 * Mor: the peacock who shows a child around his own country.
 *
 * "Namaste! I am Mor, and I am a peacock. Come with me. I want to show you my
 * country, India." He is the difference between a database of facts and
 * somebody showing you round, and he is India's national bird, which is why
 * the tail is the whole idea: it folds away while he waits, lifts a little
 * while he talks, and opens into the full fan when there is something to look
 * at. Beat 8 reveals a peacock and says "and that is me", so this is not a
 * bird that resembles that one — it is drawn from the same pieces. See
 * `src/tour/effects/art/Peacock.tsx`.
 *
 * HE IS DECORATIVE. `aria-hidden`, no role, no text: the narration carries
 * every word of the content and a screen reader announcing "peacock" over the
 * top of it would be noise, not access.
 *
 * HE HAS NO CLOCK. The three states are a pure function of two facts handed
 * in from outside — is the engine speaking, and is there art on stage — so he
 * can never drift out of step with the narration by keeping his own time. The
 * only loops here are the two that make him look alive (a bob and a blink),
 * and both are Motion's, both stop dead under reduced motion, and neither
 * decides anything.
 *
 * WHERE HE STANDS is in `mor.css`, next to why.
 */
import { motion } from 'motion/react'
import { EYE, FEATHERS, Feather, PeacockBody } from './effects/art/Peacock'
import { PALETTE as C } from './effects/art/palette'
import { EASE_OUT, useStill } from './effects/Reveal'
import './mor.css'

export type MorState = 'idle' | 'talking' | 'showing'

type Props = {
  /**
   * The engine's `playing` flag. Read it, in whatever mounts him, as
   * `useSyncExternalStore(n.subscribe, () => n.playing)` — a primitive
   * selector, because `getSnapshot` returns the word index and would not
   * change when `playing` flips.
   */
  playing: boolean
  /** Whatever the current cue put on stage, or null when the map is clear. */
  showing: string | null
}

/**
 * The three poses, as four numbers each. All of them act on the same nine
 * feathers about the same pivot, so the tail sweeps up and OPENS in one
 * movement rather than cutting between drawings.
 *
 *  `fan`   a fraction of the peacock's full 75-degree spread.
 *  `tail`  scales each feather about the pivot, so a folded tail is genuinely
 *          foreshortened — short feathers with small eyes — rather than a
 *          full-length fan squeezed narrow, which reads as a comb.
 *  `tilt`  swings the whole bundle back over his shoulder. Without it a
 *          folded tail stands straight up past his head like antennae; a real
 *          train trails BEHIND the bird until he raises it, and this is the
 *          difference between a peacock waiting and an insect.
 *  `body`  how big the bird himself is. It goes DOWN for `showing`, which
 *          looks backwards written out and is right on screen: the open fan
 *          is three times the silhouette of the folded one, so holding the
 *          body at its waiting size would put a peacock the width of the
 *          whole map in the corner. He settles as the train comes up.
 *
 * `mor.css` pivots all of it on his feet, so he never drifts towards the
 * control bar as he grows.
 */
const POSE: Record<MorState, { fan: number; tail: number; tilt: number; body: number }> = {
  idle:    { fan: 0.18, tail: 0.50, tilt: -55, body: 1.26 },
  talking: { fan: 0.38, tail: 0.68, tilt: -38, body: 1.34 },
  showing: { fan: 1,    tail: 1,    tilt: 0,   body: 1.10 },
}

/** Slow enough to be a bird settling rather than a menu opening. */
const SETTLE = { duration: 0.55, ease: EASE_OUT }
/** A gentle bob while he talks. Not a beat-matched one: the engine publishes
 *  a word index, but nodding on every word would be a twitch at four words a
 *  second, and the point of this is only that he is not a sticker. */
const BOB = { duration: 1.7, repeat: Infinity, ease: 'easeInOut' } as const
/** One slow blink about every five seconds. Almost all of the cycle is the
 *  eye simply open; `times` is what makes it occasional rather than a wink. */
const BLINK = {
  duration: 5.2,
  times: [0, 0.9, 0.945, 1],
  repeat: Infinity,
  ease: 'easeInOut' as const,
}

/**
 * What is on stage outranks the transport. A child who pauses in the middle
 * of the tiger still has the tiger on the map, so Mor goes on presenting it
 * rather than folding up mid-gesture.
 */
function poseFor(playing: boolean, showing: string | null): MorState {
  if (showing) return 'showing'
  return playing ? 'talking' : 'idle'
}

export function Mor({ playing, showing }: Props) {
  const still = useStill()
  const state = poseFor(playing, showing)
  const pose = POSE[state]
  // Motion drops a transform animation under reduced motion by itself; this
  // is the same answer said out loud, so that `data-still` and what he
  // actually does can never disagree.
  const bob = state === 'talking' && !still

  return (
    <motion.div
      className="mor"
      data-state={state}
      data-still={String(still)}
      aria-hidden="true"
      // `initial` as well as `animate`, here and on every feather: without it
      // Motion has nothing to render until its first frame, so he would mount
      // for one paint as a full-size bird with a shut fan and then jump.
      initial={{ scale: pose.body }}
      animate={{ scale: pose.body, y: bob ? [0, -3, 0] : 0 }}
      transition={{ scale: SETTLE, y: bob ? BOB : SETTLE }}
    >
      <svg className="mor__art" viewBox="0 0 120 120">
        <g className="mor__tail">
          {FEATHERS.map((f) => {
            const swung = { rotate: f.angle * pose.fan + pose.tilt, scale: pose.tail }
            return (
              <motion.g
                key={f.angle}
                // The one arrangement in which a fan can open from a bundle:
                // bottom-centre of each feather's own fill-box is the pivot,
                // so this rotates AND foreshortens it about that one point.
                style={{ originX: 0.5, originY: 1 }}
                initial={swung}
                animate={swung}
                transition={SETTLE}
              >
                <Feather tip={f.tip} />
              </motion.g>
            )
          })}
        </g>
        <PeacockBody eye={still ? undefined : <Blink />} />
      </svg>
    </motion.div>
  )
}

/**
 * The same white dot the reveal draws, squashed flat for a moment.
 *
 * A `<circle>` and not an `<ellipse>`, and the same cx/cy/r/fill, because the
 * blink must not be the one thing that stops Mor being that peacock — the
 * closing is a transform, so the shape underneath is untouched.
 */
function Blink() {
  return (
    <motion.circle
      cx={EYE.x}
      cy={EYE.y}
      r={EYE.r}
      fill={C.snow}
      style={{ originX: 0.5, originY: 0.5 }}
      animate={{ scaleY: [1, 1, 0.08, 1] }}
      transition={BLINK}
    />
  )
}
