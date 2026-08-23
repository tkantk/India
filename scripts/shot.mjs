#!/usr/bin/env node
/**
 * Photograph any screen of the real app, at any viewport, to a PNG.
 *
 *   node scripts/shot.mjs gate home tour.07 --w=820 --h=1024
 *   node scripts/shot.mjs tour.13@33 --w=390 --h=844 --out=build/shots
 *   node scripts/shot.mjs home --build          # against `npm run build` + vite preview
 *
 * WHY THIS EXISTS. `npm run tour:strip` is a GATE: it builds, watches the
 * whole tour end to end at real speed, measures twelve viewports and exits
 * non-zero on a collision. Three and a half minutes of narration plus a
 * production build is the wrong tool for "did that CSS change look better".
 * This is the same machinery — the same DevTools client, the same audio-clock
 * shim, the same Chrome flags — pointed at ONE moment.
 *
 * WHAT IT DOES NOT CHANGE. Not one line of `src/` is reimplemented or
 * stubbed. The only thing replaced is the audio HARDWARE, exactly as
 * `tour-strip.mjs` replaces it and for exactly the same reason: headless
 * Chrome has no output device, so `AudioContext.currentTime` freezes after
 * two render quanta and an `AudioBufferSourceNode` never reaches `onended` —
 * and since `Narrator` takes its position from that clock and ends a clip
 * only on that event, the tour would not merely play silently, it would
 * never advance past beat one.
 *
 * THE SPEED KNOB is the one thing here that `tour-strip.mjs` does not have,
 * and it is why this is usable. Beat 13 is 2 minutes 45 seconds into the
 * narration. The shim's clock is scaled, so the ENGINE runs fast — cues,
 * words, holds and clip ends all come off that one clock — and then it is
 * put back to 1x a beat early, so the art arrives, animates and settles at
 * its real speed for the photograph. Motion's own animations are wall-clock
 * and are never scaled.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

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

const argv = process.argv.slice(2)
const flag = (name, fallback) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const has = (name) => argv.includes(`--${name}`)

const W = Number(flag('w', 820))
const H = Number(flag('h', 1024))
const SCALE = Number(flag('scale', 1))
const OUT = flag('out', 'build/shots')
const SPEED = Number(flag('speed', 6))
const BUILD = has('build')
const PORT = Number(flag('port', BUILD ? 4189 : 4191))
const DEBUG_PORT = Number(flag('debug-port', 9334))

const targets = argv.filter((a) => !a.startsWith('--'))
if (!targets.length) {
  console.error(`Nothing to photograph.

  targets:
    gate            the start screen, as a child first sees it
    heard           the gate's second question ("Did you hear that?")
    quiet           the gate's "No, it was quiet" help text
    home            the map at rest, with the big gold button
    tour.NN         beat NN, a breath after its last visible cue
    tour.NN@W       beat NN at word W exactly
    end             the tour finished: the map shimmers, the button is back
    credits         #/credits

  flags:
    --w= --h=       viewport in CSS px          (default 820x1024, iPad Air 11 in Safari)
    --scale=        deviceScaleFactor           (default 1; 2 for a retina PNG)
    --out=          directory                   (default build/shots)
    --speed=        how fast to run the narration to reach a beat (default 6)
    --build         production build + vite preview instead of the dev server
`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

// ------------------------------------------------------------ the protocol

/** The thinnest possible DevTools client: send a method, await its result. */
class Chrome {
  constructor(socket) {
    this.socket = socket
    this.next = 1
    this.waiting = new Map()
    socket.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      const pending = this.waiting.get(msg.id)
      if (!pending) return
      this.waiting.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error.message))
      else pending.resolve(msg.result)
    })
  }

  static async attach(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new Chrome(socket)
  }

  send(method, params = {}) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** `userGesture` is not decoration: both engines gate audio on user
   *  activation, and a tap that does not count as one leaves the tour
   *  silent — which, since beats advance on the audio clock, means it never
   *  starts at all. */
  async eval(expression, { gesture = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: gesture,
    })
    if (r.exceptionDetails) {
      throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    }
    return r.result.value
  }

  async shot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
    return path
  }

  viewport(width, height, deviceScaleFactor = 1) {
    return this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile: false,
    })
  }
}

async function until(check, { every = 80, limit = 30000, what = 'something' } = {}) {
  const deadline = Date.now() + limit
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(every)
  }
}

/**
 * The audio hardware, replaced — and nothing above it.
 *
 * `currentTime` becomes a scalable wall clock and a source node reports its
 * own end off that same clock (a polled deadline, not a fixed `setTimeout`,
 * so a speed change mid-clip is honoured rather than leaving the clip to end
 * at the old rate). `__clock.speed(n)` retimes without ever going backwards:
 * `Narrator.position` is a difference against `startedAt`, and a clock that
 * jumped back would hand it a negative elapsed and un-say words already said.
 */
const CLOCK = `(() => {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  let base = 0, zero = performance.now(), speed = 1
  const now = () => base + ((performance.now() - zero) / 1000) * speed
  Object.defineProperty(AC.prototype, 'currentTime', { configurable: true, get: now })
  window.__clock = {
    speed(next) { base = now(); zero = performance.now(); speed = next },
    now,
  }
  const create = AC.prototype.createBufferSource
  AC.prototype.createBufferSource = function () {
    const ctx = this
    const node = create.call(this)
    const start = node.start.bind(node)
    const stop = node.stop.bind(node)
    let raf = 0
    node.start = function (when, offset) {
      start(when ?? 0, offset ?? 0)
      if (node.loop || !node.buffer) return
      const left = Math.max(0, node.buffer.duration - (offset ?? 0)) / (node.playbackRate.value || 1)
      const endAt = ctx.currentTime + left
      const tick = () => {
        if (ctx.currentTime >= endAt) { raf = 0; if (node.onended) node.onended(new Event('ended')); return }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    node.stop = function (when) {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      try { stop(when ?? 0) } catch (e) { /* already stopped */ }
    }
    return node
  }
})()`

/** Everything worth knowing about the screen, right now. */
const SNAPSHOT = `(() => {
  const el = (s) => document.querySelector(s)
  const spans = [...document.querySelectorAll('.read-along .word')]
  const cue = el('.cue')
  return {
    beat: el('[data-beat]')?.dataset.beat ?? '',
    word: spans.findIndex((s) => s.hasAttribute('data-current')),
    words: spans.length,
    saying: spans.find((s) => s.hasAttribute('data-current'))?.textContent ?? null,
    art: cue ? cue.dataset.verb + (cue.dataset.arg ? ':' + cue.dataset.arg : '') : null,
    mor: el('.mor')?.dataset.state ?? null,
    lit: document.querySelectorAll('svg.base path.lit').length,
    playButton: el('.play-big')?.textContent ?? null,
  }
})()`

// -------------------------------------------------------------- the harness

let server, browser, chrome
const profile = 'build/.chrome-shot'

function stop() {
  try { chrome?.socket.close() } catch { /* already gone */ }
  try { browser?.kill('SIGTERM') } catch { /* already gone */ }
  try { server?.kill('SIGTERM') } catch { /* already gone */ }
}
process.on('exit', stop)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stop(); process.exit(130) })
}

async function open() {
  if (BUILD) {
    console.log('building')
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
  }
  // The vite binary directly, never `npx vite`: npx forks a second node and
  // keeps only the wrapper's pid, so killing what we spawned would leave the
  // real server holding the port for the next run to measure staleley.
  const mode = BUILD ? 'preview' : 'dev'
  console.log(`serving (${mode}) on :${PORT}`)
  server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', ...(BUILD ? ['preview'] : []),
    '--port', String(PORT), '--strictPort',
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  let died = null
  server.on('exit', (code) => { died = code ?? 'a signal' })
  await until(async () => {
    if (died !== null) throw new Error(`vite exited (${died}). Is port ${PORT} in use?`)
    try { return (await fetch(`http://127.0.0.1:${PORT}/`)).ok } catch { return false }
  }, { what: 'the server', limit: 30000 })

  rmSync(profile, { recursive: true, force: true })
  browser = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${process.cwd()}/${profile}`,
    `--window-size=${W},${H}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    // A headless window is never "visible", and a throttled rAF makes every
    // animation in the tour a slideshow — and the engine's own clock loop
    // (Narrator.tick) is a rAF too, so a throttled one stops the narration.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  const target = await until(async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      return list.find((t) => t.type === 'page')
    } catch { return null }
  }, { what: 'a Chrome page target', limit: 20000 })

  chrome = await Chrome.attach(target.webSocketDebuggerUrl)
  await chrome.send('Page.enable')
  await chrome.send('Runtime.enable')
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK })
  await chrome.viewport(W, H, SCALE)
}

/**
 * Find a button and press it in ONE evaluation, retrying until it reports
 * success. Never "wait for it, then click it" as two round trips: React
 * commits asynchronously, so between the poll that saw the button and the
 * call that pressed it the element can be a different object.
 */
function press(what, match) {
  const expression = `(() => {
    const el = [...document.querySelectorAll('button')].find((b) => ${match})
    if (!el || el.disabled) return false
    el.click()
    return true
  })()`
  return until(() => chrome.eval(expression, { gesture: true }), { what: `a press on ${what}`, limit: 20000 })
}

async function reload() {
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  await until(() => chrome.eval(`!!document.querySelector('.gate button')`), { what: 'the gate' })
}

async function toTheMap() {
  await reload()
  await press('begin', `/begin/i.test(b.textContent)`)
  await press('yes, I heard it', `/heard it/i.test(b.textContent)`)
  await until(() => chrome.eval(`!!document.querySelector('.play-big')`), { what: 'the play button' })
  await sleep(400)
}

/** Content, only so a beat with no `@word` can be shot a breath after its
 *  last VISIBLE cue rather than at some arbitrary word. */
const tour = JSON.parse(readFileSync('content/tour.json', 'utf8'))
const timings = JSON.parse(readFileSync('src/data/timings.json', 'utf8'))

function defaultWord(id) {
  const beat = tour.beats.find((b) => b.id === id)
  if (!beat) throw new Error(`No such beat: ${id}. Beats are ${tour.beats.map((b) => b.id).join(', ')}`)
  const words = timings[id].words.length
  const seen = (beat.cues ?? []).filter((c) => c.do !== 'playSfx')
  if (!seen.length) return Math.floor(words / 2)
  return Math.min(seen.reduce((m, c) => Math.max(m, c.word), 0) + 4, words - 1)
}

async function toBeat(id, word) {
  await toTheMap()
  await chrome.eval(`window.__clock.speed(${SPEED})`)
  await press('show me India', `b.classList.contains('play-big')`)

  // Back to real speed one beat early, so the art of the beat being
  // photographed arrives, animates and settles at the speed it was drawn
  // for. Motion's own animations are wall-clock and were never scaled;
  // only the engine was.
  const order = tour.beats.map((b) => b.id)
  const slowFrom = order[Math.max(0, order.indexOf(id) - 1)]
  let slowed = false
  const snap = await until(async () => {
    const s = await chrome.eval(SNAPSHOT)
    if (!slowed && (s.beat === slowFrom || s.beat === id)) {
      slowed = true
      await chrome.eval(`window.__clock.speed(1)`)
    }
    return s.beat === id && s.word >= word ? s : null
  }, { every: 50, limit: 180000, what: `${id} word ${word}` })

  // A breath, so the art has finished arriving. Every hold is at least five
  // seconds, so nothing can have left in the meantime.
  await sleep(600)
  return snap
}

// -------------------------------------------------------------------- run it

await open()

for (const target of targets) {
  const [id, w] = target.split('@')
  const name = target.replace(/[^a-zA-Z0-9.]/g, '-')
  const file = `${OUT}/${name}-${W}x${H}.png`
  let note = ''

  if (id === 'gate') {
    await reload()
    await sleep(250)
  } else if (id === 'heard') {
    await reload()
    await press('begin', `/begin/i.test(b.textContent)`)
    await until(() => chrome.eval(`/heard it/.test(document.body.textContent)`), { what: 'the sound check' })
    await sleep(250)
  } else if (id === 'quiet') {
    await reload()
    await press('begin', `/begin/i.test(b.textContent)`)
    await press('no, it was quiet', `/was quiet/i.test(b.textContent)`)
    await until(() => chrome.eval(`!!document.querySelector('.help')`), { what: 'the help text' })
    await sleep(250)
  } else if (id === 'home') {
    await toTheMap()
    note = await chrome.eval(`document.querySelector('.play-big').textContent`)
  } else if (id === 'credits') {
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/credits` })
    await until(() => chrome.eval(`!!document.querySelector('.credits')`), { what: 'the credits' })
    await sleep(400)
  } else if (id === 'end') {
    await toTheMap()
    await chrome.eval(`window.__clock.speed(${SPEED})`)
    await press('show me India', `b.classList.contains('play-big')`)
    const s = await until(async () => {
      const x = await chrome.eval(SNAPSHOT)
      return x.beat === '' && x.playButton ? x : null
    }, { every: 100, limit: 180000, what: 'the end of the tour' })
    await chrome.eval(`window.__clock.speed(1)`)
    await sleep(600)
    note = `button="${s.playButton}" lit=${s.lit}`
  } else if (/^tour\.\d\d$/.test(id)) {
    const word = w === undefined ? defaultWord(id) : Number(w)
    const s = await toBeat(id, word)
    note = `word ${s.word}/${s.words} "${s.saying}" art=${s.art ?? 'none'} mor=${s.mor} lit=${s.lit}`
  } else {
    console.error(`Unknown target: ${target}`)
    continue
  }

  await chrome.shot(file)
  console.log(`${file}${note ? `   ${note}` : ''}`)
}

stop()
