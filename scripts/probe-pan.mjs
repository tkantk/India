#!/usr/bin/env node
/**
 * DOES A FINGER ACTUALLY MOVE THE MAP? jsdom cannot answer this — it has no
 * `getScreenCTM`, no `createSVGPoint` and no `DOMMatrix`, which is the whole
 * mechanism `MapStage`'s pan and pinch are built on (see that file's own
 * `toMap`). So the unit tests cover `clampView` and `setView` and this
 * covers the gesture, in the same headless Chrome every other probe uses.
 *
 *   node scripts/probe-pan.mjs [slug]
 *
 * Checks, against the real built app on a real phone viewport:
 *   1. a one-finger drag pans, and the map follows the finger's direction
 *   2. a two-finger pinch zooms
 *   3. the clamp holds — a huge drag cannot throw the country off screen
 *   4. a drag does NOT count as a tap (it must not open a neighbouring state)
 *
 * It does NOT check the tour's map. The tour lives behind `StartGate`, which
 * waits on a real audio unlock, and a synthetic click cannot unlock audio in
 * headless Chrome — see docs/handover.md's own note on reproducing exactly
 * that. So the map never mounts on `#/` here and the comparison is between
 * two nulls, which passes or fails for the wrong reason either way. That the
 * tour's map is NOT explorable is asserted in `MapStage.test.tsx` instead,
 * where the prop's default is directly observable.
 */
import { spawn, execFileSync } from 'node:child_process'

const SLUG = process.argv[2] ?? 'kerala'
const PORT = 4200
const DEBUG_PORT = 9345
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Chrome {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.waiting = new Map()
    socket.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data); const p = this.waiting.get(msg.id); if (!p) return
      this.waiting.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    })
  }
  static async attach(url) {
    const socket = new WebSocket(url)
    await new Promise((res, rej) => {
      socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true })
    })
    return new Chrome(socket)
  }
  send(method, params = {}) {
    const id = this.next++
    return new Promise((res, rej) => { this.waiting.set(id, { resolve: res, reject: rej }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  async eval(expression, { gesture = false } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture })
    if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
}

let preview, browser
const stop = () => { try { preview?.kill('SIGTERM') } catch {} try { browser?.kill('SIGTERM') } catch {} }
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1) })

console.log('building')
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
await sleep(2500)
browser = spawn(CHROME, [
  `--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--no-first-run',
  '--user-data-dir=build/.chrome-pan', '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' })
await sleep(2500)
const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
const chrome = await Chrome.attach(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await chrome.send('Page.enable'); await chrome.send('Runtime.enable')
await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })

/** Synthetic pointer gesture, dispatched on the stage React actually listens on. */
const GESTURE = (steps) => `(() => {
  const stage = document.querySelector('.stage')
  if (!stage) return 'no stage'
  const ev = (type, id, x, y) => stage.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1,
  }))
  ${steps}
  return 'ok'
})()`

const viewBox = () => chrome.eval(`document.querySelector('.map .base')?.getAttribute('viewBox') ?? null`)
const nums = (s) => (s ? s.trim().split(/[\s,]+/).map(Number) : null)
const results = []
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

async function open(hash) {
  await chrome.send('Page.navigate', { url: 'about:blank' })
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hash}` })
  for (let i = 0; i < 60; i++) {
    if (await chrome.eval(`!!document.querySelector('.stage')`).catch(() => false)) break
    await sleep(100)
  }
  await sleep(1800) // the arrival flight
}

console.log(`\nplace screen: #/place/${SLUG} at 390x844\n`)
await open(`#/place/${SLUG}`)
const before = nums(await viewBox())

// 1. one-finger drag, downward: dragging DOWN should reveal what is NORTH,
//    so the view's y must DECREASE.
await chrome.eval(GESTURE(`
  ev('pointerdown', 1, 195, 100)
  for (let y = 110; y <= 220; y += 10) ev('pointermove', 1, 195, y)
  ev('pointerup', 1, 195, 220)
`), { gesture: true })
await sleep(120)
const afterDrag = nums(await viewBox())
check('a one-finger drag pans the map', before && afterDrag && (afterDrag[0] !== before[0] || afterDrag[1] !== before[1]),
  `${before?.join(' ')} -> ${afterDrag?.join(' ')}`)
check('dragging down moves the view north (y decreases)', before && afterDrag && afterDrag[1] < before[1],
  `y ${before?.[1]} -> ${afterDrag?.[1]}`)

// 2. pinch out (fingers apart) should zoom IN: the view gets narrower.
const preZoom = nums(await viewBox())
await chrome.eval(GESTURE(`
  ev('pointerdown', 1, 170, 120); ev('pointerdown', 2, 220, 120)
  for (let d = 5; d <= 60; d += 5) { ev('pointermove', 1, 170 - d, 120); ev('pointermove', 2, 220 + d, 120) }
  ev('pointerup', 1, 110, 120); ev('pointerup', 2, 280, 120)
`), { gesture: true })
await sleep(120)
const afterPinch = nums(await viewBox())
check('a two-finger pinch zooms in', preZoom && afterPinch && afterPinch[2] < preZoom[2],
  `width ${preZoom?.[2]} -> ${afterPinch?.[2]}`)

// 3. the clamp: an enormous drag must not lose the country.
await chrome.eval(GESTURE(`
  ev('pointerdown', 3, 195, 400)
  for (let i = 1; i <= 40; i++) ev('pointermove', 3, 195 + i * 40, 400 + i * 40)
  ev('pointerup', 3, 1800, 2000)
`), { gesture: true })
await sleep(120)
const clamped = nums(await viewBox())
const home = [0, 0, 1000, 1100]
const inside = clamped && clamped[0] >= home[0] - 0.01 && clamped[1] >= home[1] - 0.01
  && clamped[0] + clamped[2] <= home[0] + home[2] + 0.01 && clamped[1] + clamped[3] <= home[1] + home[3] + 0.01
check('a huge drag cannot push the map outside India', inside, clamped?.join(' '))

// 4. a drag must not be read as a tap (which would open another state).
const hashBefore = await chrome.eval(`location.hash`)
await chrome.eval(GESTURE(`
  ev('pointerdown', 4, 195, 120)
  for (let x = 200; x <= 300; x += 10) ev('pointermove', 4, x, 120)
  ev('pointerup', 4, 300, 120)
`), { gesture: true })
await sleep(400)
const hashAfter = await chrome.eval(`location.hash`)
check('a drag does not open a state the way a tap does', hashBefore === hashAfter, `${hashBefore} -> ${hashAfter}`)

// The place screen's map must actually be marked explorable — the one half
// of the opt-in this probe can see from here.
check('the place map is marked explorable',
  await chrome.eval(`!!document.querySelector('.stage[data-explorable="true"]')`), '')

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
stop()
process.exitCode = failed.length ? 1 : 0
