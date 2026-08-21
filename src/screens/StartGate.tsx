import { useState } from 'react'

type Props = {
  onReady: () => void
  unlock: () => Promise<void>
  playTestSound: () => Promise<void>
}

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
        <h1>Namaste!</h1>
        <p>Shall we go and see India?</p>
        <button className="tap begin" onClick={begin}>Tap here to begin</button>
      </main>
    )
  }

  return (
    <main className="gate">
      <h1>Did you hear that?</h1>
      <div className="row">
        <button className="tap" onClick={onReady}>Yes, I heard it</button>
        <button className="tap" onClick={() => setPhase('silent')}>No, it was quiet</button>
      </div>
      {phase === 'silent' && (
        <>
          {/* No web API can read the iPad's mute state, so words are the cure. */}
          <p className="help">
            Turn the volume up, and check the sound is not switched off in
            Control Centre. Then try again.
          </p>
          <button className="tap" onClick={() => { setPhase('checking'); void playTestSound() }}>
            Try again
          </button>
        </>
      )}
    </main>
  )
}
