import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { StartGate } from './screens/StartGate'

// Task 2 replaces these with the real audio engine (Web Audio unlock + a
// short test-tone playback). StartGate only needs the shape of the
// functions to run its tap -> unlock -> confirm flow.
const unlock = async () => {}
const playTestSound = async () => {}

function IndiaScreen() {
  return (
    <main className="india">
      <h1>Namaste India</h1>
      <p>The map is coming soon.</p>
    </main>
  )
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
