import { lazy, Suspense, useCallback, useState } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { StartGate } from './screens/StartGate'
import { IndiaScreen } from './screens/IndiaScreen'
import { PlaceScreen } from './screens/PlaceScreen'
import { PassportScreen } from './screens/PassportScreen'
import { getNarrator } from './audio/Narrator'
import { prefetchPlace } from './content/places'

/**
 * THE CREDITS PAGE IS ITS OWN CHUNK. It is the one screen that reads every
 * photograph's and every sound's full credit record — all of
 * `photo-credits.json`, 189 KB — and it is an adult's page, reached through
 * a small link on the map's credit line that most sessions never touch. So
 * it is fetched when that link is followed, not parsed before the start gate
 * can draw. (`sound-credits.json` stays in the main bundle regardless: the
 * narration engine reads it to know which sounds exist.)
 *
 * `fallback={null}`: the page arrives in a moment from the site's own
 * origin, and a grown-up who just tapped "credits" is better served by a
 * blank frame for that moment than by a spinner flashing up and away.
 */
const Credits = lazy(() => import('./screens/Credits').then((m) => ({ default: m.Credits })))

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
 * Go to a place — and START FETCHING IT FIRST, in that order.
 *
 * A place's page, clips and photo credits are its own chunk now
 * (`content/places.ts`). The tap that brings a child here is the earliest
 * moment anything knows which one he wants, so the request goes out right
 * here, before React has even begun building the place's screen — which is
 * real time on an old iPad (the whole map is re-mounted) — and the screen's
 * own load, once it mounts, simply joins the request already in the air.
 * By the time the 900ms arrival flight is a third of the way through, the
 * page is nearly always there.
 *
 * Every way into a place goes through here: a state tapped on the tour's
 * map, a neighbour tapped on a place's own map (or offered on its "not been
 * here yet" page), a stamp tapped in the passport. A deep link has no tap to
 * get ahead of; the screen starts that load itself.
 */
function useVisit() {
  const navigate = useNavigate()
  return useCallback((slug: string) => {
    prefetchPlace(slug)
    navigate(`/place/${slug}`)
  }, [navigate])
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
  const visit = useVisit()
  return (
    <IndiaScreen
      onPickState={visit}
      onPassport={() => navigate('/passport')}
    />
  )
}

function PassportRoute() {
  const navigate = useNavigate()
  const visit = useVisit()
  return (
    <PassportScreen
      onPick={visit}
      onHome={() => navigate('/')}
    />
  )
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
  const visit = useVisit()
  const { slug = '' } = useParams()
  return (
    <PlaceScreen
      key={slug}
      slug={slug}
      onPick={visit}
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
        {/* Not behind the gate, for the same reason `/place/:slug` is not: a
            grown-up reloading the iPad here must land here, not back at the
            start. The screen itself waits for a real tap before it speaks. */}
        <Route path="/passport" element={<PassportRoute />} />
        <Route path="/credits" element={<Suspense fallback={null}><Credits /></Suspense>} />
      </Routes>
    </MotionConfig>
  )
}

export default App
