import { useState, useSyncExternalStore } from 'react'
import { getNarrator } from '../audio/Narrator'
import './Controls.css'

type Props = {
  /**
   * What the play/pause button does. Required, and that is the point.
   *
   * The bar can see whether the engine is speaking, and it used to act on
   * that alone — `playing ? pause() : resume()`. But `resume()` returns
   * early when there is no buffer to resume, so at rest the button did
   * NOTHING: a 104px target labelled "Play", right next to a working one
   * labelled "Show me again", for a six-year-old who will certainly press
   * whichever is nearer. Only the screen knows what play means when nothing
   * is speaking — start the tour, resume this beat, or play it all again —
   * so the screen says.
   */
  onPlayPause: () => void

  /**
   * THE RULE THIS FILE LEARNED THE HARD WAY, so the next control added here
   * inherits it instead of relearning it: no control may be pressable and
   * do nothing. `onPlayPause`'s own argument above is the first half of
   * it — only the screen knows what an action means when nothing is
   * loaded. It took a second, worse bug on a DIFFERENT button to see the
   * argument was general: "Say it again" called `n.replay()` straight from
   * here, and `replay()` bailed on `!this.buffer` in every stopped state —
   * at rest, mid-load, after a tap, after Home, after the tour ends.
   * Measured: zero source nodes, zero fetches, zero emits. A 104px target
   * that taught a six-year-old the button does not work.
   *
   * Two different fixes follow from two different reasons a tap can land on
   * nothing:
   *   - The action's MEANING depends on the screen (what "play" or "again"
   *     resumes, restarts, or begins from). Take a callback, the way
   *     `onPlayPause` and `onReplay` do, and only default it to the raw
   *     engine call where that default is safe in literally every state —
   *     `Narrator.replay()` itself now is, having learned the same lesson.
   *   - The action needs the ENGINE's own state to know whether there is
   *     anything to act on yet. Read it reactively, the way `playing` and
   *     `stuck` already are — never polled, always through `subscribe` —
   *     and represent it honestly (`loading`, below) rather than rendering
   *     a label the tap cannot make good on.
   * A disabled button that says what is happening is honest. An enabled one
   * that says "Play" and does nothing is not, and a child cannot tell the
   * difference between "broken" and "lying about what it does."
   */

  /**
   * The way out. On a one-screen app that is "stop, and put the big button
   * back", which is what this screen does with it; it used to be
   * `navigate('/')` from `/`, which rewrote the hash and left the beat
   * playing. Plan 3's state screens will make it a real navigation.
   */
  onHome: () => void
  /**
   * "Say it again." Optional, and defaults to calling the engine directly —
   * every caller before Task 3 had nothing it needed to do first. `GrandTour`
   * now provides one: replaying a beat mid-invite restarts the same clip a
   * dwell timer is still waiting on, and the screen is the only thing that
   * knows to clear that wait before the audio starts over.
   */
  onReplay?: () => void
}

/**
 * The five things a child can always reach: play/pause, say it again,
 * slower, sound, and home. Every button is at least `--tap` (104px) square
 * and carries a visible word next to its symbol — a survey of fifty
 * children's iPad apps found only 2% do both, and a six-year-old cannot
 * reliably map an abstract glyph to its meaning on their own.
 *
 * `playing`, `stuck` and `loading` are read with `useSyncExternalStore`
 * against the engine's own `subscribe`, not polled after an `await`: the
 * `visibilitychange` handler inside the engine can flip `stuck` with no tap
 * at all, and a poll-after-await design would miss that entirely. The same
 * reasoning is why `loading` exists at all — see the type-level comment
 * beside `onPlayPause` above for the rule it is half of.
 *
 * Slower and sound are the bar's own business — they are settings on the
 * engine and mean the same thing on every screen. Play and home are not, so
 * they come in as props.
 */
export function Controls({ onPlayPause, onHome, onReplay }: Props) {
  const n = getNarrator()
  const playing = useSyncExternalStore(n.subscribe, () => n.playing)
  const stuck = useSyncExternalStore(n.subscribe, () => n.stuck)
  const loading = useSyncExternalStore(n.subscribe, () => n.loading)

  const [slow, setSlow] = useState(false)
  const [muted, setMuted] = useState(false)

  // On iOS an AudioContext can stick in "interrupted" through a phone call
  // or Siri and never come back (WebKit bug 263627). There is no other way
  // out, so the whole bar becomes one full-width button.
  if (stuck) {
    return (
      <div className="controls controls--stuck">
        <button
          type="button"
          className="tap carry-on"
          onClick={() => { void n.resumeContext() }}
        >
          Tap to carry on
        </button>
      </div>
    )
  }

  const toggleSlow = () => {
    const next = !slow
    n.setRate(next ? 0.85 : 1)
    setSlow(next)
  }

  const toggleMuted = () => {
    const next = !muted
    n.setVolume(next ? 0 : 1)
    setMuted(next)
  }

  return (
    <div className="controls" role="toolbar" aria-label="Controls">
      <button
        type="button"
        className="tap control"
        onClick={onPlayPause}
        // Loading disables the tap rather than merely relabelling it: there
        // is no `pause()` (nothing is playing) and no `resume()` (there is
        // still no buffer) this press could mean, so pretending it is live
        // would only trade one broken promise for another.
        disabled={loading}
      >
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">{loading ? '⏳' : playing ? '⏸' : '▶'}</span>
          <span className="control__label">{loading ? 'Loading' : playing ? 'Pause' : 'Play'}</span>
        </span>
      </button>

      <button type="button" className="tap control" onClick={() => (onReplay ? onReplay() : void n.replay())}>
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">↺</span>
          <span className="control__label">Say it again</span>
        </span>
      </button>

      <button type="button" className="tap control" onClick={toggleSlow}>
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">🐢</span>
          <span className="control__label">{slow ? 'Normal speed' : 'Slower'}</span>
        </span>
      </button>

      <button type="button" className="tap control" onClick={toggleMuted}>
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
          <span className="control__label">{muted ? 'Sound off' : 'Sound on'}</span>
        </span>
      </button>

      <button type="button" className="tap control" onClick={onHome}>
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">🏠</span>
          <span className="control__label">Home</span>
        </span>
      </button>
    </div>
  )
}
