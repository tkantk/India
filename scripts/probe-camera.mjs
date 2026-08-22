#!/usr/bin/env node
/**
 * Drive a real browser over the real camera.
 *
 *   npm run probe:camera                    fly to Delhi, measure, draw frames
 *   npm run probe:camera -- --place=kerala  somewhere else
 *
 * Three questions nothing in the vitest suite can answer, because jsdom has no
 * layout, no hit testing, no getScreenCTM and no Web Animations API:
 *
 *   1. IS THE COMMIT SEAMLESS? The flight animates a CSS transform on the
 *      HTML wrapper and then, in one frame, swaps that transform for a new
 *      `viewBox`. Those are two completely different rendering paths — a
 *      composited layer transform, and `preserveAspectRatio` letterboxing
 *      inside an SVG viewport — and they agree only if the committed rect is
 *      the preimage of the whole view. Get it wrong and the map jumps at the
 *      exact moment the child arrives. Measured here by comparing the screen
 *      CTM at the end of the transform with the screen CTM after the commit,
 *      at three window shapes, because the letterbox is what differs between
 *      a landscape iPad and a portrait one.
 *
 *   2. DOES TAPPING STILL WORK AFTERWARDS? Once the viewBox changes, so does
 *      the mapping from a finger's client coordinates to viewBox units, and
 *      so does everything derived from it — which place is under a point, how
 *      many viewBox units a fingertip's forgiveness is worth. A camera that
 *      left the hit layer behind would make the map go dead the moment a
 *      child zoomed in, and every unit test would still pass.
 *
 *   3. WHAT HAPPENS IF THE MAP IS TORN OUT MID-FLIGHT? A browser stops
 *      ticking an animation whose target has left the render tree, so the
 *      flight's promise never settles and it never lands: a detached map with
 *      a transform still on it, held alive by a chain nobody can resolve. The
 *      cue registry awaits that promise, and a child tapping a state during
 *      the tour is exactly how a map gets torn out mid-flight.
 *
 * The camera itself is not reimplemented here: `src/map/camera.ts` and
 * `src/lib/cheapMode.ts` are read, type-stripped by Node, and inlined into
 * the page. What runs in the browser is the code that ships. The page shell
 * is shared with `probe-map-hits.mjs` via `lib/mapPage.mjs`.
 *
 * It also writes the flight out as a sequence of PNGs, so a human can check
 * the framing — that the place is centred, that nothing is cut off, and that
 * the last frame of the flight and the first frame after the commit are the
 * same picture.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { PICK_ROOT, SNAP_PX } from '../src/map/hitLayer.ts'
import { mapPage } from './lib/mapPage.mjs'

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

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const PLACE = arg('place', 'delhi')

/**
 * The flight is stretched to four seconds for the probe, and then paused and
 * scrubbed frame by frame. The shape is identical to the 400 ms one — the
 * same keyframes, the same easing — but a paused animation can be measured
 * and photographed at an exact fraction of the way through, which a running
 * one cannot.
 */
const SCRUB_MS = 4000

/** Window shapes, in CSS pixels. The letterbox differs in every one of them,
 *  and the letterbox is the term most likely to be wrong. */
const SHAPES = [
  ['landscape', 1024, 768],  // an iPad held the usual way
  ['portrait', 768, 1024],
  ['square', 900, 900],      // no letterbox on either axis to hide behind
]

const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))
const hit = JSON.parse(readFileSync('src/data/hit.json', 'utf8'))

if (!geo.places[PLACE]) {
  console.error(`No such place: ${PLACE}`)
  process.exit(1)
}

// ------------------------------------------- the shipping camera, inlined

/**
 * Type-strip a module and hand back its body with the import statements
 * removed, so several of them can be concatenated into one page script.
 *
 * Chrome will not load an ES module over file://, and adding a web server to
 * a probe that otherwise needs none is a worse trade than this. The guard is
 * the point: if either file grows an import that is not accounted for here,
 * this throws instead of quietly shipping a half-built camera to the browser.
 */
function inline(path, allowed = []) {
  const stripped = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'strip' })
  const imports = stripped.split('\n').filter((l) => /^\s*import\b/.test(l))
  for (const line of imports) {
    if (!allowed.some((a) => line.includes(a))) {
      throw new Error(`${path} imports something this probe cannot inline:\n  ${line.trim()}`)
    }
  }
  return stripped.split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n')
}

const CAMERA_SOURCE = [
  inline('src/lib/cheapMode.ts'),
  inline('src/map/camera.ts', ['cheapMode.ts']),
].join('\n')

// ------------------------------------------------------------- the page

const poles = Object.fromEntries(Object.entries(hit.places).map(([s, p]) => [s, p.pin]))
const target = geo.places[PLACE].bbox
const pin = hit.places[PLACE]

const probe = CAMERA_SOURCE + '\n' + `
const PLACE = ${JSON.stringify(PLACE)}
const TARGET = ${JSON.stringify(target)}
const POLES = ${JSON.stringify(poles)}
const PIN = ${JSON.stringify(pin.pin)}
const PIN_R = ${pin.pinR}
// Mirrors cues.ts's zoomTo / GrandTour.tsx's pick: PLACE_PADDING (from the
// inlined camera.ts above) is a floor, not a ceiling. Flying a real state's
// bbox with no padding override, the way this probe used to, is not what
// the app does for any place with a pinR bigger than the floor — Andaman &
// Nicobar and Lakshadweep both are.
const TARGET_PADDING = Math.max(PLACE_PADDING, PIN_R)
const SNAP_PX = ${SNAP_PX}
const SCRUB_MS = ${SCRUB_MS}
const PHASE = Number(new URLSearchParams(location.search).get('phase') || 0)
const MEASURE = new URLSearchParams(location.search).has('measure')
const UNMOUNT = new URLSearchParams(location.search).has('unmount')

const stage = document.querySelector('.${PICK_ROOT}')
const layers = [...stage.querySelectorAll(':scope > svg')]
const baseSvg = document.querySelector('svg.base')

let reached = 0, strays = 0, visibleHitTested = 0
stage.addEventListener('pointerdown', () => { reached++ })

/**
 * viewBox units -> client pixels, through the VISIBLE layer.
 *
 * Deliberately not through the hit layer. A child aims at the art they can
 * see and lands on a client pixel; the hit layer is only what answers. Ask
 * the hit layer where a place is drawn and it will tell you where IT thinks
 * the place is, which is self-consistent even when it has been left behind at
 * the old viewBox — the exact bug this probe exists to catch.
 */
const client = (x, y) => {
  const p = baseSvg.createSVGPoint()
  p.x = x
  p.y = y
  return p.matrixTransform(baseSvg.getScreenCTM())
}
const onScreen = (q) => q.x >= 0 && q.y >= 0 && q.x < innerWidth && q.y < innerHeight

/** What a child tapping this point in viewBox units would actually pick. */
const resolve = (x, y) => {
  const q = client(x, y)
  if (!onScreen(q)) return '@offscreen'
  const el = document.elementFromPoint(q.x, q.y)
  if (!el) return '@nothing'
  if (el.tagName === 'path' && el.closest('.base')) visibleHitTested++
  const near = el.closest && el.closest('[data-slug]')
  if (near) return near.getAttribute('data-slug')
  strays++
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: q.x, clientY: q.y }))
  return '@' + el.tagName + '.' + (el.getAttribute('class') || '-')
}

const ctm = () => {
  const m = baseSvg.getScreenCTM()
  return [m.a, m.b, m.c, m.d, m.e, m.f]
}
const ctmScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

/** The four corners of the target, in client pixels: where the child sees it. */
const corners = () => [
  [TARGET[0], TARGET[1]],
  [TARGET[0] + TARGET[2], TARGET[1]],
  [TARGET[0], TARGET[1] + TARGET[3]],
  [TARGET[0] + TARGET[2], TARGET[1] + TARGET[3]],
].map(([x, y]) => { const q = client(x, y); return [q.x, q.y] })

const polesNow = () => {
  const got = {}
  for (const slug in POLES) got[slug] = resolve(POLES[slug][0], POLES[slug][1])
  return got
}

/** Start the flight and hold it, paused, at a fraction of the way through. */
const hold = (fraction) => {
  const flight = camera.flyTo(TARGET, { duration: SCRUB_MS, padding: TARGET_PADDING })
  const anim = stage.getAnimations()[0]
  anim.pause()
  anim.currentTime = SCRUB_MS * fraction
  return { flight, anim }
}

async function measure() {
  const out = { place: PLACE, window: [innerWidth, innerHeight] }
  bindCamera(stage)
  out.viewHome = camera.view()
  out.ctmHome = ctm()
  out.polesBefore = polesNow()

  const { flight, anim } = hold(0.5)
  // Mid-flight: the wrapper is transformed, and nothing else in the map is.
  out.midWillChange = stage.style.willChange
  out.midStageTransform = stage.style.transform
  out.midSvgTransforms = layers.map((l) => l.style.transform)
  out.midViewBoxes = layers.map((l) => l.getAttribute('viewBox'))
  out.midAnimations = stage.getAnimations().length
  out.midSvgAnimations = layers.reduce((n, l) => n + l.getAnimations().length, 0)
  out.ctmMid = ctm()

  // The last frame of the transform, before anything is committed.
  anim.currentTime = SCRUB_MS
  out.ctmEnd = ctm()
  out.cornersEnd = corners()

  // ...and the first frame after. These two must be the same picture.
  anim.finish()
  await flight
  out.ctmAfter = ctm()
  out.cornersAfter = corners()
  out.willChangeAfter = stage.style.willChange
  out.transformAfter = stage.style.transform
  out.viewBoxAfter = layers.map((l) => l.getAttribute('viewBox'))
  out.viewAfter = camera.view()

  // Tapping, after the camera has moved.
  out.polesAfter = polesNow()
  out.tapOnPlace = resolve(PIN[0], PIN[1])
  const ring = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ring.push(resolve(PIN[0] + Math.cos(a) * PIN_R * 0.8, PIN[1] + Math.sin(a) * PIN_R * 0.8))
  }
  out.tapsAroundPlace = ring

  // A grid over everything on screen, in client pixels this time: the answer
  // must still be a place whose land is actually visible.
  const grid = []
  for (let gx = 0; gx < 24; gx++) {
    for (let gy = 0; gy < 24; gy++) {
      const x = ((gx + 0.5) / 24) * innerWidth
      const y = ((gy + 0.5) / 24) * innerHeight
      const el = document.elementFromPoint(x, y)
      if (!el) { grid.push('@nothing'); continue }
      if (el.tagName === 'path' && el.closest('.base')) visibleHitTested++
      const near = el.closest && el.closest('[data-slug]')
      if (near) { grid.push(near.getAttribute('data-slug')); continue }
      strays++
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
      grid.push('@' + el.tagName + '.' + (el.getAttribute('class') || '-'))
    }
  }
  out.grid = grid

  // A fingertip is a physical distance, so its worth in viewBox units must
  // shrink by exactly as much as the camera zoomed in.
  out.snapUnitsHome = SNAP_PX / ctmScale(out.ctmHome)
  out.snapUnitsAfter = SNAP_PX / ctmScale(out.ctmAfter)

  await camera.home({ duration: 0 })
  out.ctmBack = ctm()
  out.polesBack = polesNow()
  out.viewBack = camera.view()

  out.strays = strays
  out.reached = reached
  out.visibleHitTested = visibleHitTested
  document.getElementById('out').textContent = JSON.stringify(out)
}

/**
 * Tear the map out of the page while a flight is still in the air.
 *
 * A browser stops ticking an animation whose target has left the render tree,
 * so the finished promise never settles and the flight never lands. Task 7
 * awaits it, and a child tapping a state mid-tour is exactly how it happens.
 */
async function unmount() {
  const out = { place: PLACE, window: [innerWidth, innerHeight] }
  bindCamera(stage)
  let settled = false
  camera.flyTo(TARGET, { duration: 400, padding: TARGET_PADDING }).then(() => { settled = true })

  await new Promise((r) => setTimeout(r, 50))
  out.airborne = stage.getAnimations().length
  out.airborneWillChange = stage.style.willChange

  // React detaches the DOM first and runs the passive cleanup afterwards, so
  // this is the harder of the two orders.
  document.querySelector('.map').remove()
  bindCamera(null)

  // Far longer than the flight, and longer than the reviewer waited.
  await new Promise((r) => setTimeout(r, 3000))
  out.settled = settled
  out.transform = stage.style.transform
  out.willChange = stage.style.willChange
  out.viewBoxes = layers.map((l) => l.getAttribute('viewBox'))
  out.stillAnimating = stage.getAnimations().filter((a) => a.playState === 'running').length
  document.getElementById('out').textContent = JSON.stringify(out)
}

async function draw() {
  bindCamera(stage)
  if (PHASE <= 0) return
  if (PHASE >= 1) { await camera.flyTo(TARGET, { duration: 0, padding: TARGET_PADDING }); return }
  hold(PHASE)
}

// A failure in here is otherwise an empty <pre> and a shrug.
addEventListener('error', (e) => {
  document.getElementById('out').textContent = JSON.stringify({ error: String(e.message) })
})
const boom = (e) => {
  document.getElementById('out').textContent = JSON.stringify({ error: String(e && e.stack || e) })
}
if (MEASURE) measure().catch(boom)
else if (UNMOUNT) unmount().catch(boom)
else draw().catch(boom)
`

const page = mapPage({
  geo,
  hits: hit.places,
  script: probe,
  module: true,
  // The probe photographs the map, so it wants the map to fill the window
  // exactly as it will on an iPad — no gutter, no scrollbar, no surprises.
  style: '\n  html, body { width: 100%; height: 100%; }',
})

mkdirSync('build', { recursive: true })
const pagePath = `${process.cwd()}/build/camera-probe.html`
writeFileSync(pagePath, page)

// ----------------------------------------------------------- run Chrome

const chrome = (extra, url) =>
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--virtual-time-budget=30000', ...extra, url,
  ], { maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString()

const unescape = (s) => s
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function run(query, w, h) {
  const dump = chrome(['--dump-dom', `--window-size=${w},${h}`], `file://${pagePath}?${query}`)
  const raw = /<pre id="out">(.*?)<\/pre>/s.exec(dump)
  if (!raw) {
    console.error(`No output at ${w}x${h}. Open build/camera-probe.html?${query} to see why.`)
    process.exit(1)
  }
  return JSON.parse(unescape(raw[1]))
}

// -------------------------------------------------------------- measure

const maxAbs = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
const ctmScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
const maxPoint = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])))

let failures = 0
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`) }
const pass = (msg) => console.log(`  ok    ${msg}`)

console.log(`\nflying to ${PLACE} — ${geo.places[PLACE].name}`)

for (const [name, w, h] of SHAPES) {
  const r = run('measure', w, h)
  console.log(`\n${name} ${w}x${h}`)

  const seamCtm = maxAbs(r.ctmEnd, r.ctmAfter)
  const seamPx = maxPoint(r.cornersEnd, r.cornersAfter)
  const moved = maxAbs(r.ctmHome, r.ctmEnd)
  if (moved < 1) fail(`the transform never moved anything (CTM delta ${moved.toFixed(4)})`)
  else if (seamPx < 0.5) pass(`commit is seamless: ${seamPx.toFixed(4)} px at the target's corners`)
  else fail(`the map jumps ${seamPx.toFixed(2)} px at the commit (CTM delta ${seamCtm.toFixed(4)})`)

  if (r.midSvgTransforms.every((t) => !t) && r.midSvgAnimations === 0) {
    pass('mid-flight, no SVG element is transformed or animated')
  } else {
    fail(`an SVG element is being animated: ${JSON.stringify(r.midSvgTransforms)}`)
  }
  // Halfway through, at the exact place the maths says it should be. The
  // transform interpolates linearly and the easing is symmetric about its
  // midpoint, so the scale must be the mean of the two ends. This is also
  // what makes the seam figure above meaningful: if an ancestor's CSS
  // transform did not reach getScreenCTM, this would read as no movement.
  const flown = ctmScale(r.ctmEnd) / ctmScale(r.ctmHome)
  const wantMid = ctmScale(r.ctmHome) * (1 + flown) / 2
  const offBy = Math.abs(ctmScale(r.ctmMid) - wantMid) / wantMid
  if (offBy < 0.01) pass(`halfway is halfway: ${ctmScale(r.ctmMid).toFixed(3)} px/unit against ${wantMid.toFixed(3)} predicted`)
  else fail(`mid-flight is ${(offBy * 100).toFixed(1)}% off the predicted transform`)

  if (r.midAnimations === 1 && r.midWillChange === 'transform') pass('one animation, on the wrapper, with will-change')
  else fail(`mid-flight state is wrong: ${r.midAnimations} animations, will-change "${r.midWillChange}"`)
  if (r.midViewBoxes.every((v) => v === r.viewHome.join(' '))) pass('the viewBox is untouched until the flight lands')
  else fail(`the viewBox changed mid-flight: ${JSON.stringify(r.midViewBoxes)}`)

  if (!r.willChangeAfter && !r.transformAfter) pass('the compositor hint and the transform are both dropped on landing')
  else fail(`left behind: transform "${r.transformAfter}", will-change "${r.willChangeAfter}"`)
  if (new Set(r.viewBoxAfter).size === 1) pass(`every layer committed to ${r.viewBoxAfter[0]}`)
  else fail(`the layers disagree: ${JSON.stringify(r.viewBoxAfter)}`)

  // Tapping, after the flight.
  const wrong = r.tapsAroundPlace.filter((s) => s !== PLACE)
  if (r.tapOnPlace === PLACE && wrong.length === 0) {
    pass(`a tap on ${PLACE} still picks ${PLACE}, at its pole and all round it`)
  } else {
    fail(`tapping ${PLACE} after the flight gives ${r.tapOnPlace}, ring: ${JSON.stringify(wrong)}`)
  }

  const visible = r.grid.filter((s) => !s.startsWith('@'))
  const places = [...new Set(visible)]
  const impossible = places.filter((slug) => {
    const [x, y, bw, bh] = geo.places[slug].bbox
    const [vx, vy, vw, vh] = r.viewAfter
    return x > vx + vw || x + bw < vx || y > vy + vh || y + bh < vy
  })
  if (visible.length && !impossible.length) {
    pass(`${visible.length}/${r.grid.length} screen points pick a place, all of them on screen: ${places.join(', ')}`)
  } else {
    fail(`points resolved to places that are not even in view: ${impossible.join(', ')}`)
  }

  const back = Object.entries(r.polesBack).filter(([s, got]) => s !== got)
  if (!back.length) pass('after coming home, all 36 poles resolve to their own place again')
  else fail(`${back.length} places stopped answering after the round trip: ${back.slice(0, 4).map(([s, g]) => `${s}->${g}`).join(', ')}`)

  if (maxAbs(r.ctmHome, r.ctmBack) < 1e-6) pass('home really is home: the CTM matches to a millionth')
  else fail(`home is off by ${maxAbs(r.ctmHome, r.ctmBack).toFixed(4)}`)

  if (r.visibleHitTested === 0) pass('no tap was hit-tested against the 269 KB of visible geometry')
  else fail(`${r.visibleHitTested} taps hit-tested the visible art`)
  if (r.strays === r.reached) pass(`all ${r.strays} taps that hit no place still reached the pick root`)
  else fail(`${r.strays - r.reached} of ${r.strays} stray taps never reached '.${PICK_ROOT}'`)

  const zoom = r.snapUnitsHome / r.snapUnitsAfter
  console.log(`  note  a fingertip is worth ${r.snapUnitsHome.toFixed(1)} viewBox units at home and ${r.snapUnitsAfter.toFixed(1)} here (${zoom.toFixed(1)}x closer)`)
  console.log(`  note  ${r.viewHome.join(' ')}  ->  ${r.viewAfter.map((v) => Math.round(v)).join(' ')}`)

  if (name === 'landscape') {
    writeFileSync('build/camera-probe-results.json', JSON.stringify(r, null, 1))
  }
}

// --------------------------------------------- torn down in mid-flight

{
  const [, w, h] = SHAPES[0]
  const r = run('unmount', w, h)
  console.log(`\ntorn out of the page mid-flight, ${w}x${h}`)
  if (r.airborne !== 1) fail(`the flight never got airborne: ${r.airborne} animations`)
  else if (r.settled) pass('the flight settles instead of hanging for the life of the page')
  else fail('the promise never settled — Task 7 would await this forever')
  if (!r.transform && !r.willChange) pass('the detached wrapper is left clean')
  else fail(`left behind on a detached element: transform "${r.transform}", will-change "${r.willChange}"`)
  if (new Set(r.viewBoxes).size === 1 && r.viewBoxes[0] !== '0 0 1000 1100') {
    pass(`it landed anyway: every layer committed to ${r.viewBoxes[0]}`)
  } else {
    fail(`the viewBox was never committed: ${JSON.stringify(r.viewBoxes)}`)
  }
}

// ------------------------------------------------------------- the frames

const shots = [
  ['0-home', 0],
  ['1-quarter', 0.25],
  ['2-half', 0.5],
  ['3-three-quarters', 0.75],
  ['4-arrived', 1],
]
const [, PW, PH] = SHAPES[0]
console.log('')
for (const [name, phase] of shots) {
  const out = `build/camera-flight-${name}.png`
  chrome([`--window-size=${PW},${PH}`, `--screenshot=${process.cwd()}/${out}`],
    `file://${pagePath}?phase=${phase}`)
  console.log(`wrote ${out}`)
}

console.log(failures ? `\n${failures} FAILED` : '\nall good')
process.exit(failures ? 1 : 0)
