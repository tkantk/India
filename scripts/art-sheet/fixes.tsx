/**
 * The two things a test cannot show you, photographed.
 *
 * `npm run contact-sheet:art` shoots this into build/fixes.png alongside the
 * main sheet. Two panels, and they are in separate documents on purpose:
 *
 *  - THE SEAS accumulate. Each cell drives the REAL seam,
 *    `OVERLAYS.revealSymbol(...)`, through one, two and then all three of
 *    beat 12's cues into ONE overlay slot — which is what the tour does, a
 *    few words apart — so the picture is the water building up rather than
 *    three separate reveals.
 *
 *  - THE GANGA, drawn while the camera is on Delhi. The real `MapStage`,
 *    the real `camera.flyTo`, the real cue. `tour.json` zooms to Delhi at
 *    beat 5 and never comes home, so this is exactly what beat 10 renders.
 *
 * The camera is a module singleton — there is one map on screen for the life
 * of the app — so a page cannot hold a map at Delhi and a map at home at the
 * same time. Hence one document per panel, and an outer page that puts the
 * two side by side in iframes.
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig, MotionGlobalConfig } from 'motion/react'
import geo from '../../src/data/geo.json'
import type { Bbox } from '../../src/types'
import { MapStage } from '../../src/map/MapStage'
import { camera } from '../../src/map/camera'
import { useCameraView } from '../../src/map/useCameraView'
import { OVERLAYS } from '../../src/tour/overlays'
import '../../src/styles/base.css'
import '../../src/map/map.css'
import '../../src/tour/tourStage.css'
import './fixes.css'

/** See sheet.tsx: headless Chrome runs no animation frames, so without this
 *  every cue is photographed at `opacity: 0`. */
MotionGlobalConfig.skipAnimations = true

const NOOP = () => {}

/** The map as the child sees it behind the art, with no camera bound. */
function MapUnder() {
  const places = Object.entries(geo.places as Record<string, { d: string; type: string }>)
  return (
    <div className="map">
      <div className="stage">
        <svg className="base" viewBox={geo.viewBox.join(' ')} aria-hidden="true">
          {places.map(([slug, p]) => (
            <path key={slug} d={p.d} data-type={p.type} />
          ))}
        </svg>
      </div>
    </div>
  )
}

/** Beat 12's three cues, fired into one overlay slot, stopping after `upTo`. */
const SEAS = ['arabian-sea', 'bay-of-bengal', 'indian-ocean']

function Accumulated({ upTo }: { upTo: number }) {
  const [i, setI] = useState(0)
  // One cue per commit, in order, exactly as the audio clock delivers them.
  useLayoutEffect(() => {
    if (i < upTo) setI(i + 1)
  }, [i, upTo])
  return (
    <div className="tour-stage">
      <MapUnder />
      <div className="tour-overlay">{OVERLAYS.revealSymbol(SEAS[i])}</div>
    </div>
  )
}

/** The river, with the camera where beat 5 left it. */
function RiverAtDelhi() {
  useEffect(() => {
    const delhi = (geo.places as unknown as Record<string, { bbox: Bbox }>).delhi.bbox
    // The same call `zoomTo delhi` makes, minus the flight.
    void camera.flyTo(delhi, { duration: 0 })
  }, [])
  return (
    <div className="tour-stage">
      <MapStage onPick={NOOP} />
      <div className="tour-overlay">{OVERLAYS.traceRiver('ganga')}</div>
    </div>
  )
}

function Seas() {
  return (
    <>
      <h1>Beat 12 — “Water touches India on three sides”</h1>
      <p className="note">
        One overlay slot, three cues seven words apart. The named sea comes
        forward; the others stay. No writing on the water — the narrator says
        the names, the art says where.
      </p>
      <div className="grid grid--three">
        {SEAS.map((sea, i) => (
          <figure className="cell" key={sea}>
            <div className="stage-box">
              <Accumulated upTo={i} />
            </div>
            <figcaption>
              after cue {i + 1}: <b>{sea}</b>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  )
}

/** The camera's own committed rect, live — read through the same hook the
 *  art reads it through, so the caption cannot claim more than the art knows. */
function Rect() {
  const view = useCameraView()
  return <>{view ? view.map((n) => Math.round(n * 10) / 10).join(' ') : '(no map)'}</>
}

function River() {
  return (
    <>
      <h1>Beat 10 — the Ganga, with the camera still on Delhi</h1>
      <p className="note">
        The real MapStage, the real camera (<code>flyTo(delhi)</code>), the real
        cue. The layer takes its viewBox from the camera's committed rect, so
        the river runs down the valley it actually runs down, and the line
        keeps its weight on screen instead of thickening ten times over.
      </p>
      <div className="grid grid--one">
        <figure className="cell">
          <div className="stage-box stage-box--big">
            <RiverAtDelhi />
          </div>
          <figcaption>
            <b>traceRiver ganga</b> at viewBox <code><Rect /></code>
          </figcaption>
        </figure>
      </div>
    </>
  )
}

const panel = new URLSearchParams(location.search).get('panel')

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="always">{panel === 'river' ? <River /> : <Seas />}</MotionConfig>,
)
