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
        <div className="gate__plate">
          <p className="gate__hello" lang="hi">नमस्ते</p>
          <h1 className="gate__title">Namaste!</h1>
          <p className="gate__sub">Shall we go and see India?</p>

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
      </main>
    )
  }

  return (
    <main className="gate">
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
