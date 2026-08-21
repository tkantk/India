/**
 * The page shell the browser probes render the real map into.
 *
 * There are two of them now — `probe-map-hits.mjs` measures where a tap
 * lands, `probe-camera.mjs` measures what the camera does to that answer —
 * and they must measure the SAME map. The layers, their order, their
 * attributes and the stylesheet all come from here so that a change to the
 * shell cannot reach one probe and miss the other.
 *
 * The markup inside the layers is the app's own code (`hitLayer.ts`, imported
 * through Node's type stripping). Only this skeleton is a copy of what
 * `MapStage` renders, and `MapStage.test.tsx` asserts the two still agree.
 */
import { readFileSync } from 'node:fs'
import { PICK_ROOT, baseMarkup, hitMarkup } from '../../src/map/hitLayer.ts'

/**
 * @param {object} o
 * @param {object} o.geo    parsed `src/data/geo.json` — the caller owns the
 *                          data, so a probe may doctor it (see `--before`)
 * @param {object} o.hits   parsed `src/data/hit.json` `places`
 * @param {string} o.script the probe's own code, run in the page
 * @param {boolean} [o.module] run the script as an ES module
 * @param {string} [o.style]   extra CSS, appended after the app's own
 */
export function mapPage({ geo, hits, script, module = false, style = '' }) {
  const css = readFileSync('src/styles/base.css', 'utf8') + readFileSync('src/map/map.css', 'utf8')
  const names = Object.fromEntries(Object.entries(geo.places).map(([s, p]) => [s, p.name]))
  const viewBox = geo.viewBox.join(' ')

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body { position: absolute; padding: 0; } #frame { position: absolute; inset: 0; }${style}
</style></head><body><div id="frame">
  <div class="map"><div class="${PICK_ROOT}">
    <svg class="base" viewBox="${viewBox}" aria-hidden="true"><g pointer-events="none">${baseMarkup(geo.places)}</g></svg>
    <svg class="hit" viewBox="${viewBox}">${hitMarkup(hits, names)}</svg>
    <svg class="glow" viewBox="${viewBox}" aria-hidden="true"><path/></svg>
  </div><p class="credit">${geo.attribution}</p></div>
</div><pre id="out"></pre><script${module ? ' type="module"' : ''}>${script}</script></body></html>`
}
