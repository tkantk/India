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
 * `playing` and `stuck` are read with `useSyncExternalStore` against the
 * engine's own `subscribe`, not polled after an `await`: the
 * `visibilitychange` handler inside the engine can flip `stuck` with no tap
 * at all, and a poll-after-await design would miss that entirely.
 *
 * Slower and sound are the bar's own business — they are settings on the
 * engine and mean the same thing on every screen. Play and home are not, so
 * they come in as props.
 */
export function Controls({ onPlayPause, onHome, onReplay }: Props) {
  const n = getNarrator()
  const playing = useSyncExternalStore(n.subscribe, () => n.playing)
  const stuck = useSyncExternalStore(n.subscribe, () => n.stuck)

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
      >
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">{playing ? '⏸' : '▶'}</span>
          <span className="control__label">{playing ? 'Pause' : 'Play'}</span>
        </span>
      </button>

      <button type="button" className="tap control" onClick={() => (onReplay ? onReplay() : n.replay())}>
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
