#!/usr/bin/env node
/**
 * Drive a real browser over the real map and measure whether a child's tap
 * lands where they aimed.
 *
 *   npm run probe:map              the map as it ships
 *   npm run probe:map -- --before  the map before fix round 1: one pin radius
 *                                  of 22 for everyone, and no snapping
 *
 * jsdom does no hit testing at all — it has no getScreenCTM, no
 * createSVGPoint, no DOMMatrix — so nothing in the vitest suite can tell you
 * whether a tap reaches anything. This can, and it exists because it caught a
 * bug the whole suite was blind to: the delegated listener sat on the hit
 * layer, whose root is `pointer-events: none`, so every tap that hit no place
 * fell through to the sibling below and the snap was unreachable dead code.
 *
 * The markup and the snapping come from `src/map/hitLayer.ts` through Node's
 * type stripping — the same code the app ships, not a copy of it. Only the
 * page shell is written out here, and `MapStage.test.tsx` asserts the
 * component's shell matches it.
 *
 * Reports, per place and overall:
 *   - dead zones: taps that resolve to nothing, before and after snapping
 *   - theft: taps inside one place that resolve to a different one
 *   - whether the 269 KB of visible geometry is ever hit-tested (it must not be)
 *   - whether every pole still resolves to its own place
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  PICK_ROOT, SNAP_PX, baseMarkup, hitMarkup, buildOutlines, nearestOutline,
} from '../src/map/hitLayer.ts'

const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => { try { readFileSync(p); return true } catch { return false } })

if (!CHROME) {
  console.error('No Chrome found. Set CHROME=/path/to/chrome and try again.')
  process.exit(1)
}

/**
 * Render big enough that one viewBox unit is more than one CSS pixel.
 *
 * This matters more than it looks. At the app's own scale (about 0.4 px per
 * unit) a dropped island a unit across is a third of a pixel, so
 * elementFromPoint quantises it away and the probe reports a dead zone as
 * healthy. The dead zone is a property of the geometry, not of the screen, so
 * it must be measured where the screen cannot hide it.
 */
const PX_PER_UNIT = Number(process.env.PX_PER_UNIT ?? 1.6)
const W = Math.round(1000 * PX_PER_UNIT), H = Math.round(1100 * PX_PER_UNIT)
/**
 * Sample points per RING, not per place.
 *
 * A step derived from a place's total area is far too coarse for an
 * archipelago: West Bengal's land is mostly one mass, so its step comes out at
 * 3.9 units and 52 of its 55 Sundarbans islands never receive a single sample.
 * Andaman & Nicobar loses 27 of 52. Those dropped islands are exactly where
 * the dead zones are, so a per-place step measures the map as healthier than
 * it is.
 *
 * Every ring therefore gets its own grid, and every sample carries the area it
 * stands for. The overall figures are weighted by those areas, which is what
 * "a point chosen at random from India" means — so sampling a one-unit islet
 * as densely as Rajasthan does not distort the total.
 */
const PER_RING = Number(process.env.PER_RING ?? 120)

/**
 * `--before` reproduces the map as it was before fix round 1 — a single pin
 * radius of 22 units for every place, and no snapping — so the before and
 * after figures come from one instrument rather than from two.
 */
const BEFORE = process.argv.includes('--before')

const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))
const hit = JSON.parse(readFileSync('src/data/hit.json', 'utf8'))
if (BEFORE) for (const p of Object.values(hit.places)) p.pinR = 22

// ------------------------------------------------------- sample the land

const parseRings = (d) => d.split('M').filter((s) => s.trim()).map((chunk) => {
  const nums = chunk.match(/-?\d+(?:\.\d+)?/g).map(Number)
  const ring = []
  for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]])
  return ring
})
const signedArea = (r) => {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return a / 2
}
const inRing = ([px, py], r) => {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const samples = []       // [slug, x, y]
const weights = []       // land area each sample stands for
const area = {}
for (const [slug, place] of Object.entries(geo.places)) {
  const rings = parseRings(place.d)
  const outers = rings.filter((r) => signedArea(r) > 0)
  const holes = rings.filter((r) => signedArea(r) < 0)
  area[slug] = rings.reduce((a, r) => a + Math.abs(signedArea(r)), 0)

  for (const ring of outers) {
    const ringArea = Math.abs(signedArea(ring))
    const step = Math.max(0.02, Math.sqrt(ringArea / PER_RING))
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of ring) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const taken = []
    for (let x = x0; x <= x1; x += step) {
      for (let y = y0; y <= y1; y += step) {
        if (!inRing([x, y], ring)) continue
        if (holes.some((h) => inRing([x, y], h))) continue
        taken.push([slug, Math.round(x * 100) / 100, Math.round(y * 100) / 100])
      }
    }
    // An island smaller than its own grid step still gets one probe, at a
    // vertex nudged inward, so it cannot disappear from the measurement.
    if (!taken.length) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      taken.push([slug, Math.round(cx * 100) / 100, Math.round(cy * 100) / 100])
    }
    for (const t of taken) {
      samples.push(t)
      weights.push(ringArea / taken.length)
    }
  }
}

// The poles, probed separately: each one is a place's tap point of last resort.
const poles = Object.fromEntries(Object.entries(hit.places).map(([s, p]) => [s, p.pin]))

// ------------------------------------------------------------- the page

const css = readFileSync('src/styles/base.css', 'utf8') + readFileSync('src/map/map.css', 'utf8')
const names = Object.fromEntries(Object.entries(geo.places).map(([s, p]) => [s, p.name]))
const viewBox = geo.viewBox.join(' ')

// The one thing here that is not the app's own code. MapStage.test.tsx
// asserts the component renders this same shape.
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body { position: absolute; padding: 0; } #frame { position: absolute; inset: 0; }
</style></head><body><div id="frame">
  <div class="map"><div class="${PICK_ROOT}">
    <svg class="base" viewBox="${viewBox}" aria-hidden="true"><g pointer-events="none">${baseMarkup(geo.places)}</g></svg>
    <svg class="hit" viewBox="${viewBox}">${hitMarkup(hit.places, names)}</svg>
    <svg class="glow" viewBox="${viewBox}" aria-hidden="true"><path/></svg>
  </div><p class="credit">${geo.attribution}</p></div>
</div><pre id="out"></pre><script>
const samples = ${JSON.stringify(samples)}
const poles = ${JSON.stringify(poles)}
const svg = document.querySelector('.hit')
const m = svg.getScreenCTM()
const root = document.querySelector('.${PICK_ROOT}')
let reached = 0, strays = 0, visibleHitTested = 0
root.addEventListener('pointerdown', () => { reached++ })
const at = (x, y) => {
  const p = svg.createSVGPoint(); p.x = x; p.y = y
  return p.matrixTransform(m)
}
const resolve = (x, y) => {
  const q = at(x, y)
  const el = document.elementFromPoint(q.x, q.y)
  if (!el) return '@nothing'
  if (el.tagName === 'path' && el.closest('.base')) visibleHitTested++
  const near = el.closest && el.closest('[data-slug]')
  if (near) return near.getAttribute('data-slug')
  // A miss. Does it even reach the element carrying the handler?
  strays++
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: q.x, clientY: q.y }))
  return '@' + el.tagName + '.' + (el.getAttribute('class') || '-')
}
const results = samples.map(([, x, y]) => resolve(x, y))
const poleHits = {}
for (const [slug, [x, y]] of Object.entries(poles)) poleHits[slug] = resolve(x, y)
document.getElementById('out').textContent = JSON.stringify({
  results, poleHits, strays, reached, visibleHitTested,
  scale: Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)),
})
</script></body></html>`

mkdirSync('build', { recursive: true })
writeFileSync(`build/map-probe${BEFORE ? '-before' : ''}.html`, page)

// ----------------------------------------------------------- run Chrome

const dump = execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--hide-scrollbars',
  `--window-size=${W},${H}`, '--virtual-time-budget=120000',
  '--dump-dom', `file://${process.cwd()}/build/map-probe${BEFORE ? '-before' : ''}.html`,
], { maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString()

const raw = /<pre id="out">(.*?)<\/pre>/s.exec(dump)
if (!raw) {
  console.error('The probe page produced no output. Open build/map-probe.html to see why.')
  process.exit(1)
}
const { results, poleHits, strays, reached, visibleHitTested, scale } =
  JSON.parse(raw[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

// -------------------------------------- apply the app's own snap to misses

const outlines = buildOutlines(hit.places)
const within = SNAP_PX / scale

const stat = {}
let deadRaw = 0, deadSnapped = 0, stolen = 0, correct = 0
let wTotal = 0, wDeadRaw = 0, wDead = 0, wStolen = 0
for (let i = 0; i < samples.length; i++) {
  const [slug, x, y] = samples[i]
  const w = weights[i]
  stat[slug] ??= { n: 0, deadRaw: 0, dead: 0, stolen: 0, w: 0, wDeadRaw: 0, wDead: 0, wStolen: 0 }
  stat[slug].n++
  stat[slug].w += w
  wTotal += w
  let got = results[i]
  if (got.startsWith('@')) {
    deadRaw++
    stat[slug].deadRaw++
    stat[slug].wDeadRaw += w
    wDeadRaw += w
    got = BEFORE ? null : nearestOutline(outlines, x, y, within)
  }
  if (got === slug) correct++
  else if (got === null) { deadSnapped++; stat[slug].dead++; stat[slug].wDead += w; wDead += w }
  else { stolen++; stat[slug].stolen++; stat[slug].wStolen += w; wStolen += w }
}

const n = samples.length
/** Weighted by the land each sample stands for: the experience of a point
 *  chosen at random from India, rather than of an average state. */
const weighted = (x) => (100 * x) / wTotal

const pct = (x) => `${x.toFixed(2)}%`
console.log(`\n${BEFORE ? 'BEFORE fix round 1 (uniform r=22 pins, no snap)' : 'as it ships'}`)
console.log(`${n} interior points across 36 places, ${(scale).toFixed(2)} CSS px per viewBox unit`)
console.log(`poles resolving to their own place: ${Object.entries(poleHits).filter(([s, g]) => s === g).length}/36`)
console.log(`taps that hit no place: ${strays}; of those, reaching the pick root ('.${PICK_ROOT}'): ${reached}`)
console.log(`taps hit-tested against the VISIBLE geometry: ${visibleHitTested} (must be 0)`)
console.log(`\n                        area-weighted    flat mean`)
console.log(`dead before snapping    ${pct(weighted(wDeadRaw)).padStart(13)}  ${pct((100 * deadRaw) / n).padStart(11)}`)
console.log(`dead after snapping     ${pct(weighted(wDead)).padStart(13)}  ${pct((100 * deadSnapped) / n).padStart(11)}`)
console.log(`taken by another place  ${pct(weighted(wStolen)).padStart(13)}  ${pct((100 * stolen) / n).padStart(11)}`)
console.log(`correct                 ${pct(100 - weighted(wStolen) - weighted(wDead)).padStart(13)}  ${pct((100 * correct) / n).padStart(11)}`)

// Per place, also weighted by land: "how much of West Bengal is dead", not
// "how many of the points I happened to take in West Bengal were dead".
const worstDead = Object.entries(stat).map(([s, v]) => [s, (100 * v.wDeadRaw) / v.w])
  .filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])
console.log(`\nworst dead zones before snapping (share of each place's land):`)
for (const [s, p] of worstDead.slice(0, 8)) console.log(`  ${s.padEnd(42)}${p.toFixed(1)}%`)

const worstTheft = Object.entries(stat).map(([s, v]) => [s, (100 * v.wStolen) / v.w])
  .filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])
console.log(`\nworst theft (share of each place's land):`)
for (const [s, p] of worstTheft.slice(0, 10)) console.log(`  ${s.padEnd(42)}${p.toFixed(1)}%`)

writeFileSync(`build/map-probe-results${BEFORE ? '-before' : ''}.json`, JSON.stringify({ stat, poleHits, strays, reached, visibleHitTested, scale }, null, 1))
console.log(`\nfull results in build/map-probe-results${BEFORE ? '-before' : ''}.json`)
