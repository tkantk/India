import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { StartGate } from './screens/StartGate'
import { IndiaScreen } from './screens/IndiaScreen'
import { getNarrator } from './audio/Narrator'

// The engine is built on first use, which is inside the tap handler: iOS only
// gives a usable AudioContext to a real gesture. Both calls are guarded
// because a browser with no Web Audio at all must still reach the gate's
// "I heard nothing" help rather than dying on an unhandled rejection.
const unlock = async () => {
  try {
    await getNarrator().unlock()
  } catch { /* no Web Audio; the gate's own check is the fallback */ }
}

// A short, gentle chime. The point is only "did any sound reach the child",
// which no web API can answer for us.
const playTestSound = async () => {
  try {
    await getNarrator().sfx('chime-correct')
  } catch { /* silence is the answer the gate is already prepared for */ }
}

function App() {
  const [ready, setReady] = useState(false)

  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route
          path="/"
          element={
            ready ? (
              <IndiaScreen />
            ) : (
              <StartGate onReady={() => setReady(true)} unlock={unlock} playTestSound={playTestSound} />
            )
          }
        />
      </Routes>
    </MotionConfig>
  )
}

export default App
