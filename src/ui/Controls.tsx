import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNarrator } from '../audio/Narrator'
import './Controls.css'

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
 */
export function Controls() {
  const n = getNarrator()
  const playing = useSyncExternalStore(n.subscribe, () => n.playing)
  const stuck = useSyncExternalStore(n.subscribe, () => n.stuck)

  const [slow, setSlow] = useState(false)
  const [muted, setMuted] = useState(false)

  // Always inside a Router in production (main.tsx wraps <App /> in
  // <HashRouter>) and in the test double (MemoryRouter).
  const navigate = useNavigate()
  const goHome = () => navigate('/')

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
        onClick={() => (playing ? n.pause() : n.resume())}
      >
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">{playing ? '⏸' : '▶'}</span>
          <span className="control__label">{playing ? 'Pause' : 'Play'}</span>
        </span>
      </button>

      <button type="button" className="tap control" onClick={() => n.replay()}>
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

      <button type="button" className="tap control" onClick={goHome}>
        <span className="control__body">
          <span className="control__icon" aria-hidden="true">🏠</span>
          <span className="control__label">Home</span>
        </span>
      </button>
    </div>
  )
}
