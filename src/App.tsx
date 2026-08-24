import { useState } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { StartGate } from './screens/StartGate'
import { IndiaScreen } from './screens/IndiaScreen'
import { PlaceScreen } from './screens/PlaceScreen'
import { Credits } from './screens/Credits'
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

/**
 * The two screens that navigate, wrapped where `useNavigate` is legal.
 *
 * Nothing below `IndiaScreen` may call a router hook: `GrandTour`,
 * `TourStage` and `MapStage` are mounted with no Router by their own tests
 * and by `probe-map-hits.mjs` / `probe-camera.mjs`, and `MapStage` already
 * uses a plain `<a href="#/credits">` rather than a `<Link>` because of it.
 * So the navigation is created here and injected as an ordinary callback.
 */
function IndiaRoute() {
  const navigate = useNavigate()
  return <IndiaScreen onPickState={(slug) => navigate(`/place/${slug}`)} />
}

/**
 * `key={slug}` is load-bearing. Tapping a neighbouring state from a place's
 * own page changes the param without changing the route, which React would
 * otherwise treat as the same component with new props — leaving the open
 * card, the "heard" ticks and the camera's own arrival effect belonging to
 * the place the child just left. A key makes turning to a neighbour exactly
 * as clean as arriving from the map.
 */
function PlaceRoute() {
  const navigate = useNavigate()
  const { slug = '' } = useParams()
  return (
    <PlaceScreen
      key={slug}
      slug={slug}
      onPick={(next) => navigate(`/place/${next}`)}
      onHome={() => navigate('/')}
    />
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
              <IndiaRoute />
            ) : (
              <StartGate onReady={() => setReady(true)} unlock={unlock} playTestSound={playTestSound} />
            )
          }
        />
        {/* Not behind the gate. The credits are owed to the people whose
            photographs and recordings this app redistributes, and the licence
            terms do not care whether a child has tapped "I heard it" — so the
            deep link works from a cold start, and from the map's credit line
            at any point in the tour. */}
        {/* One state's own page. Not behind the gate either, and for a
            plainer reason than the credits: a child only ever reaches it
            from the map, which is already past the gate — but a grown-up
            reloading the iPad on Rajasthan should land on Rajasthan, not be
            sent back to "Tap here to begin" having lost their place. The
            audio unlock is a property of the engine singleton, not of this
            route, so nothing about the gate's job is skipped by arriving
            here directly; there is simply no narration until a gesture has
            unlocked the context, which is true everywhere. */}
        <Route path="/place/:slug" element={<PlaceRoute />} />
        <Route path="/credits" element={<Credits />} />
      </Routes>
    </MotionConfig>
  )
}

export default App
