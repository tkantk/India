/**
 * The contact sheet: every piece of tour art, on the real map, at once.
 *
 * Built by `npm run contact-sheet:art` into build/symbols.png. Automated tests prove a symbol
 * renders; only an eye proves it reads as a tiger in under a second, and only
 * seeing all of them together proves they look like one set.
 *
 * Every cell goes through the REAL seam — `OVERLAYS[verb](arg)` — over the
 * real map paths with the real map stylesheet, so what is photographed is
 * what a child gets. The cells are drawn at roughly iPad size and then scaled
 * down, which is also what "can you tell what it is across the room" means.
 */
import { createRoot } from 'react-dom/client'
import { MotionConfig, MotionGlobalConfig } from 'motion/react'
import geo from '../../src/data/geo.json'
import vocab from '../../content/vocab.json'
import { OVERLAYS } from '../../src/tour/overlays'
import '../../src/styles/base.css'
import '../../src/map/map.css'
import '../../src/tour/tourStage.css'
import './sheet.css'

/**
 * Every animation lands instantly, before the shutter.
 *
 * Headless Chrome runs no animation frames — `requestAnimationFrame` never
 * fires under a virtual time budget, and neither does the Web Animations API
 * that Motion hands opacity to. Without this the whole sheet photographs its
 * FIRST frame, which for art that fades in is a page of empty maps: every
 * cue in the DOM, every one of them at `opacity: 0`. (Shimming rAF with
 * setTimeout does not help — the accelerated values never finish either.)
 *
 * `skipAnimations` makes Motion apply every target value synchronously, so
 * what is photographed is the settled state. It has to be set BEFORE the
 * first render, which is why it is here and not inside a component.
 */
MotionGlobalConfig.skipAnimations = true

type Cell = [verb: string, arg: string | undefined]

const CELLS: Cell[] = [
  ...vocab.revealSymbol.map((s): Cell => ['revealSymbol', s]),
  ['unfurlFlag', undefined],
  ['countTo', '28'],
  ['countTo', '8'],
  ['countTo', '24'],
  ['traceRiver', 'ganga'],
  ['raiseMountains', undefined],
  ...vocab.showScript.map((g): Cell => ['showScript', g]),
]

const places = Object.entries(geo.places as Record<string, { d: string; type: string }>)

/** The map as the child sees it behind the art: the real paths, the real
 *  stylesheet, no hit layer and no camera. */
function MapUnder() {
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

function Sheet() {
  return (
    /* reducedMotion="always" on purpose, on top of skipAnimations above: it
       is what makes the art skip its own draw-ons (a `pathLength` is an SVG
       attribute, not something Motion can jump for us) and it photographs,
       for free, exactly what a child who has asked for less motion sees —
       every symbol whole, nothing missing. */
    <MotionConfig reducedMotion="always">
      <h1>Namaste India — the tour art</h1>
      <p className="note">
        Every cell is one cue, rendered through src/tour/overlays.tsx over the real
        map, settled (reduced motion — headless Chrome runs no animation frames).
        Ask of each one: would a six-year-old name it in a second, without a
        caption?
      </p>
      <div className="grid">
        {CELLS.map(([verb, arg]) => (
          <figure className="cell" key={`${verb}:${arg}`}>
            <div className="stage-box">
              <div className="tour-stage">
                <MapUnder />
                <div className="tour-overlay">{OVERLAYS[verb](arg)}</div>
              </div>
            </div>
            <figcaption>
              {verb}
              {arg ? <b> {arg}</b> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </MotionConfig>
  )
}

createRoot(document.getElementById('root')!).render(<Sheet />)
