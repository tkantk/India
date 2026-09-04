#!/usr/bin/env node
/**
 * ONE PHONE ROW, INSTRUMENTED. A diagnosis tool for the one check inside
 * `place-strip.mjs` that has never run: `measureReadAlong` reports
 * "skipped (no audio yet)" on all 72 phone rows, while the screenshot the
 * same row writes shows the read-along mid-sentence with a word lit.
 *
 * Replays that function's exact sequence against a single place and prints
 * what the DOM actually holds at each step, so the answer costs a minute
 * instead of a one-hour gate run per guess.
 *
 *   node scripts/probe-readalong.mjs [slug]
 *
 * `CLOCK` and `READALONG_SNAPSHOT` are EXTRACTED from place-strip.mjs at
 * runtime rather than copied, so this probe cannot silently diverge from
 * the thing it is diagnosing.
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const SLUG = process.argv[2] ?? 'west-bengal'
const PORT = 4199          // NOT place-strip's 4198 — the two must never collide
const DEBUG_PORT = 9344
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Pull a top-level `const NAME = \`...\`` template literal out of
 *  place-strip.mjs and evaluate it exactly as JS would, so what runs here is
 *  byte-identical to what the gate runs. */
function borrow(name) {
  const src = readFileSync('scripts/place-strip.mjs', 'utf8')
  const key = `const ${name} = \``
  const i = src.indexOf(key)
  if (i < 0) throw new Error(`could not find ${name} in place-strip.mjs`)
  const from = i + key.length - 1
  let end = from + 1
  for (let j = from + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue }
    if (src[j] === '`') { end = j; break }
  }
  // eslint-disable-next-line no-eval
  return eval(src.slice(from, end + 1))
}
const CLOCK = borrow('CLOCK')
const SNAPSHOT = borrow('READALONG_SNAPSHOT')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Chrome {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.waiting = new Map()
    socket.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      const p = this.waiting.get(msg.id); if (!p) return
      this.waiting.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    })
  }
  static async attach(url) {
    const socket = new WebSocket(url)
    await new Promise((res, rej) => {
      socket.addEventListener('open', res, { once: true })
      socket.addEventListener('error', rej, { once: true })
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
const stop = () => {
  try { preview?.kill('SIGTERM') } catch { /* gone */ }
  try { browser?.kill('SIGTERM') } catch { /* gone */ }
}
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1) })

console.log('building')
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })

preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
await sleep(2500)

browser = spawn(CHROME, [
  `--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--no-first-run',
  '--user-data-dir=build/.chrome-readalong', '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' })
await sleep(2500)

const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const chrome = await Chrome.attach(page.webSocketDebuggerUrl)
await chrome.send('Page.enable')
await chrome.send('Runtime.enable')
await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK })

/** Everything worth knowing about the read-along, in one round trip. */
const STATE = `(() => {
  const spans = document.querySelectorAll('.read-along .word')
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').replace(/\\s+/g, ' ').trim())
  const say = document.querySelector('.say')
  return {
    place: !!document.querySelector('.place'),
    readAlongEl: !!document.querySelector('.read-along'),
    words: spans.length,
    current: !!document.querySelector('.read-along .word[data-current]'),
    sayQuiet: say ? say.getAttribute('data-quiet') : null,
    sayPage: say ? say.getAttribute('data-page') : null,
    buttons: btns,
  }
})()`

const show = async (label) => {
  const s = await chrome.eval(STATE).catch((e) => ({ error: String(e.message).slice(0, 90) }))
  console.log(`  ${label.padEnd(34)} ${JSON.stringify(s)}`)
  return s
}

console.log(`\nreplaying measureReadAlong's sequence for "${SLUG}" at 390x844\n`)
await chrome.send('Page.navigate', { url: 'about:blank' })
await chrome.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/place/${SLUG}` })
for (let i = 0; i < 40; i++) {
  if (await chrome.eval(`!!document.querySelector('.place')`).catch(() => false)) break
  await sleep(100)
}
await show('after .place appears')
await sleep(1300)
await show('after the 1300ms arrival sleep')

// The gate's own press(): find a control whose text matches /play/i.
const pressed = await chrome.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.classList.contains('control') && /play/i.test(b.textContent))
  if (!b) return 'NO MATCHING BUTTON'
  b.click(); return 'clicked: ' + b.textContent.replace(/\\s+/g,' ').trim()
})()`, { gesture: true })
console.log(`  press -> ${pressed}`)
await show('immediately after the press')

await chrome.eval(`window.__clock.speed(6)`).catch((e) => console.log('  clock speed failed:', e.message))
for (const ms of [200, 500, 1000, 2000, 4000]) {
  await sleep(ms)
  const s = await show(`+${ms}ms after speed(6)`)
  if (s.words > 0) { console.log('\n  >>> words appeared'); break }
}
// --follow: play the whole clip and report the first word that leaves the
// lane, with the scroller's own numbers — which is what tells "the paging
// logic decided wrong" apart from "the paging logic was never consulted".
if (process.argv.includes('--follow')) {
  const DIAG = `(() => {
    const root = document.querySelector('.read-along')
    if (!root) return { err: 'no read-along' }
    const wordEl = root.querySelector('[data-current]')
    if (!wordEl) return { err: 'no current word' }
    let node = root.parentElement, scroller = null
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 1) {
        const oy = getComputedStyle(node).overflowY
        if (oy === 'auto' || oy === 'scroll') { scroller = node; break }
      }
      node = node.parentElement
    }
    const lane = document.querySelector('.say-lane') ?? document.querySelector('.say')
    const w = wordEl.getBoundingClientRect(), l = lane.getBoundingClientRect()
    const spans = [...root.querySelectorAll('.word')]
    return {
      i: spans.indexOf(wordEl), total: spans.length, saying: wordEl.textContent,
      inLane: w.top >= l.top - 0.5 && w.bottom <= l.bottom + 0.5,
      wordTop: Math.round(w.top), wordBottom: Math.round(w.bottom),
      laneTop: Math.round(l.top), laneBottom: Math.round(l.bottom),
      scroller: scroller ? scroller.className : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      clientH: scroller ? scroller.clientHeight : null,
      scrollH: scroller ? scroller.scrollHeight : null,
      maxScroll: scroller ? Math.round(scroller.scrollHeight - scroller.clientHeight) : null,
    }
  })()`
  console.log('\nfollowing the whole clip (--follow)\n')
  let last = -1, bad = 0
  for (let i = 0; i < 400; i++) {
    const d = await chrome.eval(DIAG).catch(() => null)
    if (d && !d.err && d.i !== last) {
      last = d.i
      if (process.env.VERBOSE) console.log(`  word ${String(d.i).padStart(2)} "${(d.saying||'').slice(0,12)}" scrollTop=${d.scrollTop} inLane=${d.inLane}`)
      if (!d.inLane) {
        bad++
        console.log(`  OUT OF LANE  word ${d.i}/${d.total} "${d.saying}"`)
        console.log(`     word ${d.wordTop}-${d.wordBottom} vs lane ${d.laneTop}-${d.laneBottom}`)
        console.log(`     scroller .${d.scroller} scrollTop=${d.scrollTop} client=${d.clientH} scroll=${d.scrollH} max=${d.maxScroll}`)
        if (bad >= 3) break
      }
    }
    if (d && d.i >= d.total - 1) break
    await sleep(60)
  }
  if (!bad) console.log('  every word stayed inside the lane')
}

console.log('\nfinal snapshot (the exact object the gate reads):')
console.log(' ', JSON.stringify(await chrome.eval(SNAPSHOT).catch((e) => ({ error: e.message }))))
stop()
