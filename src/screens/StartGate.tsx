import { useState } from 'react'
import { FEATHERS, Feather, PeacockBody } from '../tour/effects/art/Peacock'
import { Glyph } from '../ui/Glyph'
import './startGate.css'

type Props = {
  onReady: () => void
  unlock: () => Promise<void>
  playTestSound: () => Promise<void>
}

/**
 * THE COVER OF THE BOOK.
 *
 * It is the first thing the child sees and it had no stylesheet at all —
 * `.gate`, `.begin`, `.row` and `.help` had no rule in any file in the repo,
 * so what actually rendered was browser defaults on a cream field: an `<h1>`
 * at 2em, a paragraph, and a 104px-tall invisible box with black text in it,
 * in the top quarter of a 1024px screen with 774px of nothing underneath.
 * Measured: 0.00% saturated pixels, 98% of the frame one colour.
 *
 * So it is a cover now, and it is built entirely out of the shared page
 * system — the frame is `--ink-line` at `--rule`, the corners are
 * `--plate-rx`, the begin button is `--big` of `--gold` inked exactly like
 * the play button a child meets ten seconds later, and the two answer cards
 * are two of the eight `--mat-*` pages. Nothing here is a colour or a shape
 * this screen invented for itself, which is the whole point: 32 state screens
 * are the next piece of work and they inherit the same six tokens.
 *
 * MOR IS ON THE COVER, drawn from the very pieces `src/tour/effects/art/
 * Peacock.tsx` exports and Mor himself is assembled from — the same feathers
 * about the same pivot, fan fully open. Not a picture of a peacock: THE
 * peacock, waiting on the cover of his own book. He is static here (no
 * Motion, no timers, no `Reveal`, nothing that needs a clock) because this
 * screen exists to collect one tap and get out of the way.
 *
 * THE ONE PLACE THIS APP GOES DARK. Plan 5 Task 3 grafts festival's opening
 * — a marigold garland, three lit diyas, a glowing gold button on a deep
 * night — because it was judged the single most beautiful image any
 * direction produced. Festival lost anyway: applied everywhere, the same
 * night turned India into a cutout floating in purple with no sea, and the
 * Delhi screen back into today's app with a purple edge. So the graft stops
 * at this file's own boundary. `<Toran>` and `<Diyas>` exist ONLY here, the
 * night's colours live ONLY inside `.gate`'s own selector in startGate.css
 * (never `:root`, never `body`), and every one of them is removed from the
 * DOM the instant this component unmounts — see that file's own banner for
 * the mechanism and why it cannot leak.
 */
export function StartGate({ onReady, unlock, playTestSound }: Props) {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'silent'>('idle')

  async function begin() {
    // MUST run before the first await: WebKit only honours the gesture for
    // synchronous work started inside the handler.
    await unlock()
    setPhase('checking')
    await playTestSound()
  }

  if (phase === 'idle') {
    return (
      <main className="gate">
        <Toran />
        <div className="gate__plate">
          <p className="gate__hello" lang="hi">नमस्ते</p>
          <h1 className="gate__title">Namaste!</h1>
          <p className="gate__sub">Shall we go and see India?</p>

          {/* THE 4b DECISION IS REVERSED — see docs/handover.md, "The app is
              responsive, deliberately, as of the phone plan." This paragraph
              used to tell an adult holding a phone that the app was built
              for a tablet and things would be "cosier" there; that stopped
              being true the day `place.css` and `grandTour.css` got real
              phone layouts, gated by `place:strip`/`tour:strip` at
              `scripts/lib/devices.mjs`'s own phone rows. Leaving the old
              line in place would now be actively wrong, not honest — the
              whole reason it existed was to tell the truth before the
              screen after this one. */}

          {/* He arrives on one of the eight pages, exactly the way every
              reveal in the tour does — and on `--mat-sun`, the same page
              beat 8 prints him on, so the bird a child meets on the cover
              and the bird the narrator says "that is me" about are on the
              same colour as well as being the same shapes. */}
          <div className="gate__page">
            <CoverPeacock />
          </div>

          <button className="tap begin big-round" onClick={begin}>
            <span className="big-round__icon"><Glyph name="play" /></span>
            <span className="big-round__label">Tap here to begin</span>
          </button>
        </div>
        <Diyas />
      </main>
    )
  }

  return (
    <main className="gate">
      <Toran />
      <div className="gate__plate">
        <h1 className="gate__title gate__title--ask">Did you hear that?</h1>

        <div className="row">
          {/* Two pages, not two buttons: the same tinted ground and the same
              ink rule every reveal in the tour is printed on, so the very
              first choice a child makes teaches them what a page looks like.
              Leaf for yes and sand for no — and each carries a WORD, because
              a mark is never the only signal. */}
          <button className="tap answer answer--yes" onClick={onReady}>
            <span className="answer__icon"><Glyph name="sound-on" /></span>
            <span className="answer__label">Yes, I heard it</span>
          </button>
          <button className="tap answer answer--no" onClick={() => setPhase('silent')}>
            <span className="answer__icon"><Glyph name="sound-off" /></span>
            <span className="answer__label">No, it was quiet</span>
          </button>
        </div>

        {phase === 'silent' && (
          <>
            {/* No web API can read the iPad's mute state, so words are the cure. */}
            <p className="help">
              Turn the volume up, and check the sound is not switched off in
              Control Centre. Then try again.
            </p>
            <button
              className="tap retry"
              onClick={() => { setPhase('checking'); void playTestSound() }}
            >
              Try again
            </button>
          </>
        )}
      </div>
      <Diyas />
    </main>
  )
}

/**
 * The bird, fan open, drawn once and never animated.
 *
 * `FEATHERS` gives each feather's angle and its tip while it is still drawn
 * straight up from the pivot, so placing one is the plain `<g transform>`
 * Motion would otherwise be animating to. A `<g transform>` in a 260px box
 * on a screen with nothing else moving on it is a different budget entirely
 * from one on the map — see the note in `Mor.tsx` about which rule that is.
 */
function CoverPeacock() {
  return (
    <svg className="gate__bird" viewBox="6 18 108 96" aria-hidden="true">
      {FEATHERS.map((f) => (
        <g key={f.angle} transform={`rotate(${f.angle} 60 106)`}>
          <Feather tip={f.tip} />
        </g>
      ))}
      <PeacockBody />
    </svg>
  )
}

/* ------------------------------------------------------------- the toran */

/**
 * The garland strung across the top of the doorway. Festival's own art,
 * ported whole: marigolds, mango leaves and a rose-pink flower threaded on
 * one string that droops five times across the frame, every position
 * computed off a quadratic curve per swag rather than hand-placed, so it
 * re-drapes correctly at any width with no list of coordinates to keep in
 * step with anything.
 *
 * Colours are literals, not `var()` — the same rule as every other piece of
 * SVG art in this app (see `art/palette.ts`'s own note: WebKit's legacy
 * engine will not resolve a custom property in a presentation attribute).
 * Unlike the tour's illustration palette, this is not mirrored anywhere:
 * nothing outside this one gate re-draws a garland, so there is nothing for
 * a second file to drift out of step with. The four values are copies of
 * `--saffron`, `--gold`, `--leaf` and `--rose` — no new colour was added to
 * the shared palette for five beads nobody else will ever draw.
 */
const SWAGS = 5
const SPAN = 1200 / SWAGS
const TOP = 16
const DROOP = 62
/** Beads per swag. Dense enough to read as a garland, few enough that the
 *  whole thing is under 50 shapes rather than two hundred. */
const PER_SWAG = 9

/** The string itself, one quadratic per swag. */
const TORAN_STRING = Array.from({ length: SWAGS }, (_, s) => {
  const x0 = s * SPAN
  return `${s === 0 ? `M${x0},${TOP}` : ''}Q${x0 + SPAN / 2},${TOP + 2 * DROOP} ${x0 + SPAN},${TOP}`
}).join('')

/** Where every bead sits, along those same curves. */
const TORAN_BEADS = (() => {
  const out: { x: number; y: number; kind: number }[] = []
  let i = 0
  for (let s = 0; s < SWAGS; s++) {
    const x0 = s * SPAN
    for (let k = 0; k < PER_SWAG; k++) {
      const t = k / PER_SWAG
      const m = 1 - t
      out.push({
        x: m * m * x0 + 2 * m * t * (x0 + SPAN / 2) + t * t * (x0 + SPAN),
        y: m * m * TOP + 2 * m * t * (TOP + 2 * DROOP) + t * t * TOP,
        kind: i++ % 3,
      })
    }
  }
  out.push({ x: 1200, y: TOP, kind: 0 })
  return out
})()

function Toran() {
  return (
    <svg
      className="gate__toran"
      viewBox="0 0 1200 104"
      preserveAspectRatio="xMidYMin meet"
      aria-hidden="true"
      focusable="false"
    >
      <path d={TORAN_STRING} fill="none" stroke="#256b3d" strokeWidth="3.4" strokeLinecap="round" />
      {TORAN_BEADS.map((b) => {
        if (b.kind === 1) {
          // a mango leaf — literal copy of --leaf
          return <ellipse key={`${b.x},${b.y}`} cx={b.x} cy={b.y + 6} rx="6.5" ry="13" fill="#3f8f57" />
        }
        if (b.kind === 2) {
          // a small blossom — literal copy of --rose, gold centre
          return (
            <g key={`${b.x},${b.y}`}>
              <circle cx={b.x} cy={b.y} r="10" fill="#ef8fa8" />
              <circle cx={b.x} cy={b.y} r="4" fill="#ffe6ae" />
            </g>
          )
        }
        // a marigold — literal copy of --saffron and --gold
        return (
          <g key={`${b.x},${b.y}`}>
            <circle cx={b.x} cy={b.y} r="13.5" fill="#f0851f" />
            <circle cx={b.x} cy={b.y} r="6" fill="#ffd400" />
          </g>
        )
      })}
    </svg>
  )
}

/* ------------------------------------------------------------- the diyas */

/**
 * Three oil lamps along the floor.
 *
 * The glow is a RADIAL GRADIENT, not a `<filter>`: a filter is a CPU
 * three-pass box blur on WebKit's legacy SVG engine and this app does not
 * ship one anywhere. A gradient is a paint server, which that engine
 * rasterises once and is happy with.
 */
function Diya({ cx }: { cx: number }) {
  return (
    <g>
      <circle cx={cx} cy="28" r="40" fill="url(#diya-glow)" />
      {/* the flame */}
      <path
        d={`M${cx},8 C${cx + 8},24 ${cx + 7},36 ${cx},41 C${cx - 7},36 ${cx - 8},24 ${cx},8 Z`}
        fill="#ffd400"
      />
      <path
        d={`M${cx},20 C${cx + 4},29 ${cx + 3.5},35 ${cx},38 C${cx - 3.5},35 ${cx - 4},29 ${cx},20 Z`}
        fill="#ffe6ae"
      />
      {/* the bowl: fired clay, with the lip catching the flame above it */}
      <path
        d={`M${cx - 27},46 C${cx - 27},63 ${cx - 15},71 ${cx},71 C${cx + 15},71 ${cx + 27},63 ${cx + 27},46 Z`}
        fill="#b5602c"
      />
      <path
        d={`M${cx - 20},62 C${cx - 14},69 ${cx - 7},71 ${cx},71 C${cx + 7},71 ${cx + 14},69 ${cx + 20},62 Z`}
        fill="#7a5a3c"
      />
      <path d={`M${cx - 28},46 h56`} stroke="#e3c98f" strokeWidth="5" strokeLinecap="round" fill="none" />
    </g>
  )
}

function Diyas() {
  return (
    <svg
      className="gate__diyas"
      viewBox="0 -6 300 82"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="diya-glow">
          <stop offset="0%" stopColor="#ffe6ae" stopOpacity="0.42" />
          <stop offset="34%" stopColor="#ffb548" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#ffb548" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Diya cx={54} />
      <Diya cx={150} />
      <Diya cx={246} />
    </svg>
  )
}
