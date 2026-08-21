#!/usr/bin/env node
/**
 * Watch the whole tour, in a real browser, and photograph every beat.
 *
 *   npm run tour:strip
 *
 *     build/tour/NN-tour.MM.png   one frame per beat, at the moment its art is on stage
 *     build/tour-strip.png        all fourteen on one sheet, captioned
 *     build/tour-watch.json       what actually happened, beat by beat
 *     build/tour-layout.png       the phone and both iPads, idle and mid-beat
 *     build/tour-layout.json      the overlap numbers for the three collisions
 *
 * WHY A REAL BROWSER. jsdom does no layout, no hit testing, no Web Audio and
 * no Web Animations. Every question this task actually has to answer — does
 * the tiger arrive on the word "tiger", does the camera come home from Delhi,
 * does Mor fold his tail when the picture goes, does the control bar fit a
 * 390px phone, is the licence credit visible — is a question about layout or
 * about the audio clock. None of them can be asked in the test suite, and
 * "it renders" is not an answer to any of them.
 *
 * It drives the REAL app: `npm run build` and `vite preview`, the same server
 * Task 11 uses for the iPad pass, because it serves `.m4a` as `audio/mp4`
 * exactly as GitHub Pages does. Nothing here reimplements a line of the tour.
 *
 * It talks to Chrome over the DevTools protocol with Node's own WebSocket, so
 * it adds no dependency. `Runtime.evaluate` with `userGesture: true` is what
 * makes the taps real taps as far as the autoplay policy is concerned — an
 * AudioContext that has never been unlocked would leave every beat silent and
 * the tour would never advance.
 *
 * IT WATCHES, IT DOES NOT SIMULATE. The tour runs at its own speed, off its
 * own audio clock, for its own 2 minutes 41 seconds.
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

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const PORT = 4188
const DEBUG_PORT = 9333
const OUT = 'build'
const FRAMES = `${OUT}/tour`

const tour = JSON.parse(readFileSync('content/tour.json', 'utf8'))
const timings = JSON.parse(readFileSync('src/data/timings.json', 'utf8'))
const BEATS = tour.beats.map((b) => ({ ...b, clip: timings[b.id] }))

mkdirSync(FRAMES, { recursive: true })

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
      if (msg.error) pending.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`))
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

  /**
   * Run an expression in the page and hand back its value.
   *
   * `userGesture` is not decoration: WebKit and Chrome both gate audio on
   * user activation, and a tap that does not count as one leaves the whole
   * tour silent — which, since beats advance on the audio clock, means it
   * never starts at all.
   */
  async eval(expression, { gesture = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: gesture,
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

  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    })
  }
}

/** Poll until `check` returns something truthy, or give up. */
async function until(check, { every = 100, limit = 30000, what = 'something' } = {}) {
  const deadline = Date.now() + limit
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(every)
  }
}

/**
 * THE ONE THING THAT IS NOT REAL, and it is worth being precise about.
 *
 * Headless Chrome has no audio output device, so its AudioContext never
 * renders: `currentTime` freezes after two render quanta (measured every run
 * by the sound check below — 6 ms, and `getOutputTimestamp()` flat at zero)
 * and an AudioBufferSourceNode never reaches `onended`. The narration engine
 * takes its position from `ctx.currentTime` on purpose — that is the clock
 * the words and the cues are pinned to, and the reason none of this drifts on
 * a real device — so with a frozen clock the tour does not merely play
 * silently, it does not play at all: beat one starts and nothing ever ends.
 *
 * So the probe replaces the audio HARDWARE and nothing else. `currentTime`
 * becomes the wall clock, and a source node reports its end after its
 * buffer's own duration. Everything above that line is the shipping code: the
 * real engine, the real timings, the real cue registry, the real map, the
 * real camera, the real art, the real stylesheet, at real speed for the real
 * 2 minutes 41 seconds.
 *
 * What this CANNOT tell you is whether the audio sounds right, or whether the
 * words are in step with a voice. That needs ears, on the iPad, in Task 11.
 */
const CLOCK = `(() => {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  const zero = performance.now()
  Object.defineProperty(AC.prototype, 'currentTime', {
    configurable: true,
    get() { return (performance.now() - zero) / 1000 },
  })
  const create = AC.prototype.createBufferSource
  AC.prototype.createBufferSource = function () {
    const node = create.call(this)
    const start = node.start.bind(node)
    const stop = node.stop.bind(node)
    let timer = 0
    node.start = function (when, offset) {
      start(when ?? 0, offset ?? 0)
      if (node.loop || !node.buffer) return
      const left = Math.max(0, node.buffer.duration - (offset ?? 0)) / (node.playbackRate.value || 1)
      timer = setTimeout(() => { if (node.onended) node.onended(new Event('ended')) }, left * 1000)
    }
    node.stop = function (when) {
      clearTimeout(timer)
      try { stop(when ?? 0) } catch (e) { /* already stopped */ }
    }
    return node
  }
})()`

// ------------------------------------------------------- the page's recorder
//
// Installed once, before the tour starts. It watches the three things a cue
// can actually do to the page and stamps each one with the word that was lit
// at the time — which is the only honest way to check "the tiger arrives on
// the word tiger" from outside the app.

const RECORDER = `(() => {
  const log = []
  const beat = () => document.querySelector('[data-beat]')?.dataset.beat ?? ''
  const word = () => {
    const spans = [...document.querySelectorAll('.read-along .word')]
    return spans.findIndex((s) => s.hasAttribute('data-current'))
  }
  const at = (what, detail) => log.push({ what, detail, beat: beat(), word: word(), ms: Math.round(performance.now()) })

  // 1. Art landing on the overlay. Both ways it can land: a fresh mount, and
  //    a rename of the one that is already there. The seas and the three
  //    greetings deliberately keep ONE component instance across their cues
  //    (overlays.tsx: they accumulate into a single picture), so watching only
  //    for added nodes would report four of the tour's cues as never firing.
  const named = (el) => el.dataset.verb + (el.dataset.arg ? ':' + el.dataset.arg : '')
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') { at('art', named(r.target)); continue }
      for (const node of r.addedNodes) {
        const el = node.nodeType === 1 && (node.matches?.('.cue') ? node : node.querySelector?.('.cue'))
        if (el) at('art', named(el))
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-arg', 'data-verb'] })

  // 2. The camera committing a new view.
  let lastView = null
  new MutationObserver(() => {
    const view = document.querySelector('svg.base')?.getAttribute('viewBox')
    if (view && view !== lastView) { lastView = view; at('camera', view) }
  }).observe(document.querySelector('svg.base'), { attributes: true, attributeFilter: ['viewBox'] })

  // 3. The first state lighting up in a wave.
  let litBeat = null
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target
      if (!el.classList.contains('lit')) continue
      if (litBeat === beat()) return
      litBeat = beat()
      at('lit', el.dataset.slug)
      return
    }
  }).observe(document.querySelector('svg.base'), { attributes: true, attributeFilter: ['class'], subtree: true })

  window.__watch = log
  return true
})()`

/** Everything worth knowing about the screen, right now. */
const SNAPSHOT = `(() => {
  const el = (s) => document.querySelector(s)
  const r = (s) => el(s)?.getBoundingClientRect() ?? null
  const round = (n) => Math.round(n * 10) / 10
  const box = (b) => b && { left: round(b.left), top: round(b.top), w: round(b.width), h: round(b.height) }
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
    view: el('svg.base')?.getAttribute('viewBox') ?? null,
    playButton: el('.play-big')?.textContent ?? null,
    say: box(r('.say')),
  }
})()`

/** The three collisions, measured. Same shape as build/mor-clearance.json,
 *  which is what Task 9 left these numbers in. */
const LAYOUT = `(() => {
  const el = (s) => document.querySelector(s)
  const r = (s) => el(s)?.getBoundingClientRect() ?? null
  const round = (n) => Math.round(n * 10) / 10
  const over = (a, b) => {
    if (!a || !b) return null
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0 && h > 0 ? { w: round(w), h: round(h) } : null
  }
  /** What is actually drawn of Mor, not the box sized for his open fan. */
  const ink = () => {
    const svg = el('.mor__art')
    if (!svg) return null
    const b = svg.getBBox(), e = svg.getBoundingClientRect()
    const [, , vw, vh] = (svg.getAttribute('viewBox') ?? '0 0 120 120').split(' ').map(Number)
    const xs = [b.x, b.x + b.width].map((x) => e.left + (x / vw) * e.width)
    const ys = [b.y, b.y + b.height].map((y) => e.top + (y / vh) * e.height)
    return new DOMRect(Math.min(...xs), Math.min(...ys), Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0]))
  }
  const bar = el('.controls')
  const barBox = r('.controls')
  const morInk = ink()
  const credit = r('.map .credit')
  const play = r('.play-big')
  const say = r('.say')
  const buttons = [...document.querySelectorAll('.controls .control')].map((b) => {
    const box = b.getBoundingClientRect()
    return {
      label: b.textContent.replace(/[^A-Za-z ]/g, '').trim(),
      left: round(box.left), top: round(box.top), w: round(box.width), h: round(box.height),
      onScreen: box.left >= -0.5 && box.right <= innerWidth + 0.5,
      bigEnough: box.width >= 103.5 && box.height >= 103.5,
    }
  })
  return {
    viewport: [innerWidth, innerHeight],
    // .controls is left:0 right:0, so its own rect is always the viewport
    // width and only its CONTENT can overflow. Hence scrollWidth.
    barOverflow: bar ? round(bar.scrollWidth - bar.clientWidth) : null,
    barHeight: barBox ? round(barBox.height) : null,
    barRows: new Set(buttons.map((b) => b.top)).size,
    buttons,
    morInkOverBar: over(morInk, barBox),
    morInkOverPlay: over(morInk, play),
    creditOverBar: over(credit, barBox),
    // A credit with a big gold button sitting on it is no better than one
    // behind a toolbar, and on a phone the credit wraps onto two lines under
    // exactly where the button is centred.
    creditOverPlay: over(credit, play),
    creditOverSay: over(credit, say),
    creditOverMor: over(credit, morInk),
    creditVisible: credit ? credit.bottom <= (barBox ? barBox.top : innerHeight) + 0.5 : false,
    sayOverBar: over(say, barBox),
    sayOverMor: over(say, morInk),
    sayOverPlay: over(say, play),
    pageScrolls: document.documentElement.scrollWidth > innerWidth + 0.5
      || document.documentElement.scrollHeight > innerHeight + 0.5,
    // What a finger actually reaches. Task 10 puts two new full-stage layers
    // over the map — the read-along and the box Mor and the button stand in —
    // and a layer that swallowed taps would make the map go dead without any
    // test noticing: jsdom does no hit testing at all.
    tapReaches: (() => {
      const map = el('.map')
      const hits = (x, y) => {
        const under = document.elementFromPoint(x, y)
        return under ? under.tagName.toLowerCase() + (under.getAttribute('class') ? '.' + under.getAttribute('class') : '') : 'nothing'
      }
      const m = map && map.getBoundingClientRect()
      const morBox = el('.mor') && el('.mor').getBoundingClientRect()
      const sayBox = say
      return {
        middleOfTheMap: m ? hits(m.left + m.width / 2, m.top + m.height / 2) : null,
        throughMor: morBox ? hits(morBox.left + morBox.width / 2, morBox.top + morBox.height / 2) : null,
        throughTheWords: sayBox ? hits(sayBox.left + sayBox.width / 2, sayBox.top + sayBox.height / 2) : null,
        onThePlayButton: play ? hits(play.left + play.width / 2, play.top + play.height / 2) : null,
      }
    })(),
  }
})()`

// -------------------------------------------------------------- the harness

let preview
let browser
let chrome
const profile = `${OUT}/.chrome-tour`

/**
 * Put everything down.
 *
 * The BROWSER matters as much as the server. A spawned Chrome keeps a handle
 * on this process's event loop, so a run that only closed the socket and the
 * preview server printed its results and then hung for ever waiting on a
 * browser nobody had told to stop — and every run left another headless
 * Chrome and its half-dozen helper processes behind. Twenty-seven of them,
 * after an afternoon of watching the tour.
 *
 * SIGTERM first, because Chrome flushes its profile on it; the profile is a
 * throwaway under build/ either way.
 */
function stop() {
  try { chrome?.socket.close() } catch { /* already gone */ }
  try { browser?.kill('SIGTERM') } catch { /* already gone */ }
  try { preview?.kill('SIGTERM') } catch { /* already gone */ }
}
process.on('exit', stop)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stop(); process.exit(130) })
}

async function open() {
  console.log('building')
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })

  console.log(`serving dist on :${PORT} (vite preview — the same MIME types Pages serves)`)
  // The vite binary directly, not `npx vite`: npx forks a second node and
  // keeps only the wrapper's pid, so killing what we spawned leaves the
  // actual server running on the port — and the NEXT run's `--strictPort`
  // then dies while its poll happily succeeds against the stale one. It is
  // also the same reason the contact sheets call the declared esbuild rather
  // than whatever npx resolves on the day.
  preview = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort',
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  // If the port is already held — a previous run's server that outlived it —
  // `--strictPort` makes this one exit, and the poll below would then happily
  // succeed against the OLD server and measure a stale build. Noticing the
  // child die is the difference between a wrong answer and no answer.
  let previewDied = null
  preview.on('exit', (code) => { previewDied = code ?? 'a signal' })
  await until(async () => {
    if (previewDied !== null) {
      throw new Error(`vite preview exited (${previewDied}). Is port ${PORT} already in use?`)
    }
    try { return (await fetch(`http://127.0.0.1:${PORT}/`)).ok } catch { return false }
  }, { what: 'the preview server', limit: 20000 })

  rmSync(profile, { recursive: true, force: true })
  console.log('launching Chrome')
  browser = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${process.cwd()}/${profile}`,
    '--window-size=1024,768',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--disable-gpu',
    // The tour runs off the audio clock. Without a sound device Chrome still
    // advances an AudioContext, but the autoplay policy would suspend it.
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    // A headless window is never "visible", and a throttled rAF would make
    // every animation in the tour a slideshow.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'], detached: false })

  const target = await until(async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      return list.find((t) => t.type === 'page')
    } catch { return null }
  }, { what: 'a Chrome page target', limit: 20000 })

  chrome = await Chrome.attach(target.webSocketDebuggerUrl)
  await chrome.send('Page.enable')
  await chrome.send('Runtime.enable')
  // Before the app's first line, so the engine never sees the dead one.
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK })
}

/**
 * Find a button and press it, in ONE evaluation.
 *
 * Never "wait for it, then click it" as two round trips: React commits
 * asynchronously and the tour re-renders on a subscription, so between the
 * poll that saw the button and the call that pressed it the element can be a
 * different object — and `querySelector(...).click()` on the gap throws
 * "Cannot read properties of null", which is exactly how this failed. Doing
 * both inside the page, and retrying until it reports success, has no gap.
 *
 * `userGesture` is what makes it a real press as far as the autoplay policy
 * is concerned.
 */
function press(what, match) {
  const expression = `(() => {
    const el = [...document.querySelectorAll('button')].find((b) => ${match})
    if (!el) return false
    el.click()
    return true
  })()`
  return until(() => chrome.eval(expression, { gesture: true }), { what: `a press on ${what}`, limit: 20000 })
}

/** Through the audibility gate and onto the map. */
async function toTheMap() {
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  await until(() => chrome.eval(`!!document.querySelector('.gate button')`), { what: 'the gate' })
  await press('begin', `/begin/i.test(b.textContent)`)
  await press('yes, I heard it', `/heard it/i.test(b.textContent)`)
  await until(() => chrome.eval(`!!document.querySelector('.play-big')`), { what: 'the play button' })
}

// ------------------------------------------------------------- the watching

/**
 * The moment in each beat worth photographing: a breath after its last cue,
 * so the art has finished arriving and the words underneath are still moving.
 */
function shutterWord(beat) {
  const words = beat.clip.words.length
  // Sound cues do not count. Beat 8 reveals the peacock on word 5 and calls
  // out on word 28, and a shutter that waited for the call would photograph
  // an empty map twenty seconds after the peacock had taken itself off.
  const seen = (beat.cues ?? []).filter((c) => c.do !== 'playSfx')
  if (!seen.length) return Math.floor(words / 2)
  const last = seen.reduce((m, c) => Math.max(m, c.word), 0)
  // Never before the last one: beat 9's mango is the second-to-last word of
  // its own sentence, and a shutter that clamped ahead of it would photograph
  // the banyan and call it the mango.
  return Math.min(last + 4, words - 1)
}

/**
 * Extra frames, for the two things a per-beat strip cannot show: that the
 * flight to Delhi ARRIVES, and that the camera comes back.
 */
const EXTRA = [
  { id: 'tour.05', word: 24, name: 'delhi-arrived', why: 'the flight has landed, and "look down" has something to look at' },
  { id: 'tour.06', word: 3, name: 'came-home', why: 'and the camera is home again' },
  // Where a beat draws twice, the per-beat frame only ever catches the last
  // one — the overlay is a single slot. These are the pictures that would
  // otherwise never appear in the strip at all.
  { id: 'tour.06', word: 14, name: 'the-flag', why: 'the tricolour, painted on, before the counter replaces it' },
  { id: 'tour.09', word: 12, name: 'the-lotus', why: 'the first of the beat\'s three: lotus, then banyan, then mango' },
  { id: 'tour.12', word: 24, name: 'two-seas', why: 'two of the three, accumulating into one picture' },
]

async function watchTheTour() {
  await chrome.viewport(1024, 768)
  await toTheMap()
  await chrome.eval(RECORDER)

  const sound = await chrome.eval(`(async () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const t0 = ctx.currentTime
    await new Promise((r) => setTimeout(r, 400))
    const moved = ctx.currentTime - t0
    let ok = false, bytes = 0, decoded = null
    try {
      const res = await fetch('audio/en/tour.01.m4a')
      ok = res.ok
      const buf = await res.arrayBuffer()
      bytes = buf.byteLength
      decoded = (await ctx.decodeAudioData(buf)).duration
    } catch (e) { decoded = 'FAILED: ' + e }
    const out = { state: ctx.state, clockMoved: Math.round(moved * 1000), ok, bytes, decoded }
    ctx.close()
    return out
  })()`, { gesture: true })
  console.log(`sound check: context ${sound.state}, clock moved ${sound.clockMoved}ms in 400ms, `
    + `tour.01 ${sound.ok ? `${sound.bytes} bytes` : 'DID NOT LOAD'}, decodes to ${sound.decoded}`)

  console.log('\npressing play. Two minutes forty-one seconds.\n')
  await press('show me India', `b.classList.contains('play-big')`)

  const seen = []
  const shots = []

  for (const [i, beat] of BEATS.entries()) {
    const target = shutterWord(beat)
    const extras = EXTRA.filter((e) => e.id === beat.id)

    // Everything that has to be photographed inside this beat, in order.
    const moments = [
      ...extras.map((e) => ({ ...e, word: e.word })),
      { name: 'beat', word: target, why: `beat ${i + 1}` },
    ].sort((a, b) => a.word - b.word)

    for (const moment of moments) {
      // The last word of a beat is current for only a few hundred
      // milliseconds. If the tour moves on before the shutter, photograph
      // what there is rather than failing the whole run — and say so.
      let last = null
      const snap = await until(async () => {
        const s = await chrome.eval(SNAPSHOT)
        if (s.beat !== beat.id) return last && { ...last, late: true }
        last = s
        return s.word >= moment.word ? s : null
      }, { every: 60, limit: 40000, what: `${beat.id} word ${moment.word}` })

      // A breath, so the art has finished arriving. Every hold is at least
      // five seconds, so nothing can have left in the meantime.
      await sleep(500)

      const file = moment.name === 'beat'
        ? `${FRAMES}/${String(i + 1).padStart(2, '0')}-${beat.id}.png`
        : `${FRAMES}/${String(i + 1).padStart(2, '0')}-${beat.id}-${moment.name}.png`
      await chrome.shot(file)
      shots.push({ file, beat: beat.id, moment: moment.name, why: moment.why, snap, text: beat.text })
      console.log(
        `  ${beat.id} ${String(moment.name).padEnd(14)} word ${String(snap.word).padStart(2)}/${snap.words}` +
        ` "${snap.saying ?? ''}"  art=${snap.art ?? '-'}  mor=${snap.mor}  lit=${snap.lit}`,
      )
      if (moment.name === 'beat') seen.push(snap)
    }
  }

  // The end: the tour lets go, the map shimmers, the button comes back.
  const ended = await until(async () => {
    const s = await chrome.eval(SNAPSHOT)
    return s.beat === '' ? s : null
  }, { every: 100, limit: 40000, what: 'the end of the tour' })
  await chrome.shot(`${FRAMES}/15-ending.png`)
  shots.push({ file: `${FRAMES}/15-ending.png`, beat: 'the end', moment: 'ending', snap: ended, why: 'the map shimmers and the button comes back', text: '' })
  console.log(`  the end          button="${ended.playButton}"  lit=${ended.lit}  view=${ended.view}`)

  const calm = await until(async () => {
    const s = await chrome.eval(SNAPSHOT)
    return s.lit === 0 ? s : null
  }, { every: 200, limit: 12000, what: 'the shimmer to pass' })
  console.log(`  and calm again   lit=${calm.lit}`)

  const log = await chrome.eval(`window.__watch`)
  return { shots, log, ended, calm }
}

/** Every authored cue, against the word it actually landed on. */
function checkCues(log) {
  const rows = []
  const art = log.filter((e) => e.what === 'art')
  const used = new Set()
  for (const beat of BEATS) {
    for (const cue of beat.cues ?? []) {
      const key = cue.do + (cue.arg ? `:${cue.arg}` : '')
      if (cue.do === 'playSfx') {
        rows.push({ beat: beat.id, cue: key, authored: cue.word, landed: null, note: 'sound only — nothing to see' })
        continue
      }
      if (cue.do === 'highlightAllStates' || cue.do === 'highlightUnionTerritories') {
        const hit = log.find((e) => e.what === 'lit' && e.beat === beat.id && !used.has(e))
        if (hit) used.add(hit)
        rows.push({ beat: beat.id, cue: key, authored: cue.word, landed: hit ? hit.word : null })
        continue
      }
      if (cue.do === 'zoomTo') {
        const hit = log.find((e) => e.what === 'camera' && e.beat === beat.id && !used.has(e))
        if (hit) used.add(hit)
        rows.push({ beat: beat.id, cue: key, authored: cue.word, landed: hit ? hit.word : null })
        continue
      }
      const hit = art.find((e) => e.beat === beat.id && e.detail === key && !used.has(e))
      if (hit) used.add(hit)
      rows.push({ beat: beat.id, cue: key, authored: cue.word, landed: hit ? hit.word : null })
    }
  }
  return rows
}

// -------------------------------------------------------------- the layouts

/**
 * What counts as wrong. One definition, so a full run and a `--only=layout`
 * run cannot disagree about whether the screen is all right.
 */
const collides = (l) =>
  l.idle.barOverflow > 0 || !l.idle.buttons.every((b) => b.onScreen && b.bigEnough)
  || !l.idle.creditVisible || l.idle.morInkOverPlay || l.idle.morInkOverBar
  || l.idle.creditOverPlay || l.idle.creditOverMor
  || l.talking.sayOverBar || l.talking.sayOverMor || l.talking.sayOverPlay
  || l.talking.creditOverSay || l.talking.pageScrolls
  // Only the button may swallow a tap. Everything else on the stage is
  // scenery and the map has to be reachable through it.
  || /tour-front|say|mor/.test(String(l.talking.tapReaches.middleOfTheMap))
  || /tour-front|say|mor/.test(String(l.talking.tapReaches.throughMor))
  || /tour-front|say|mor/.test(String(l.talking.tapReaches.throughTheWords))
  || !/play-big/.test(String(l.idle.tapReaches.onThePlayButton))

const DEVICES = [
  ['phone', 390, 844],
  ['small phone', 375, 812],
  ['iPad portrait', 768, 1024],
  ['iPad landscape', 1024, 768],
]

async function measureLayouts() {
  const out = []
  const shots = []
  for (const [name, w, h] of DEVICES) {
    await chrome.viewport(w, h)
    await toTheMap()
    await sleep(400)

    const idle = await chrome.eval(LAYOUT)
    const idleShot = `${FRAMES}/layout-${w}x${h}-idle.png`
    await chrome.shot(idleShot)

    await press('show me India', `b.classList.contains('play-big')`)
    // Far enough into beat 2 that the read-along is at its longest and the
    // first symbol has been and gone.
    await until(async () => (await chrome.eval(SNAPSHOT)).beat === 'tour.02', { what: 'beat 2', limit: 30000 })
    await sleep(3500)
    const talking = await chrome.eval(LAYOUT)
    const talkShot = `${FRAMES}/layout-${w}x${h}-talking.png`
    await chrome.shot(talkShot)

    out.push({ device: name, idle, talking })
    shots.push({ file: idleShot, caption: `${name} ${w}x${h} — idle` }, { file: talkShot, caption: `${name} ${w}x${h} — beat 2` })
    console.log(
      `  ${name.padEnd(14)} ${w}x${h}  bar ${idle.barHeight}px in ${idle.barRows} row(s), overflow ${idle.barOverflow}px` +
      `  all five on screen: ${idle.buttons.every((b) => b.onScreen && b.bigEnough) ? 'yes' : 'NO'}` +
      `  credit visible: ${idle.creditVisible ? 'yes' : 'NO'}` +
      `  Mor over play: ${idle.morInkOverPlay ? `${idle.morInkOverPlay.w}x${idle.morInkOverPlay.h}` : 'no'}` +
      `  button over credit: ${idle.creditOverPlay ? `${idle.creditOverPlay.w}x${idle.creditOverPlay.h}` : 'no'}` +
      `  words over credit: ${talking.creditOverSay ? `${talking.creditOverSay.w}x${talking.creditOverSay.h}` : 'no'}` +
      `  words over Mor: ${talking.sayOverMor ? `${talking.sayOverMor.w}x${talking.sayOverMor.h}` : 'no'}\n` +
      `  ${' '.repeat(14)} a tap lands on: map ${talking.tapReaches.middleOfTheMap}` +
      `, through Mor ${talking.tapReaches.throughMor}` +
      `, through the words ${talking.tapReaches.throughTheWords}` +
      `, on the button ${idle.tapReaches.onThePlayButton}`,
    )
  }
  return { out, shots }
}

// ---------------------------------------------------------------- the sheets

/** One page of pictures, shot with a second Chrome. Data URIs rather than
 *  file:// images, so no cross-file access flag is needed. */
function sheet(name, title, note, cells, cols, cellW) {
  const html = `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { margin: 0; padding: 20px 22px 26px; background: #efe9dc;
         font: 14px/1.45 system-ui, sans-serif; color: #3d4a41; }
  h1 { margin: 0 0 4px; font-size: 24px; color: #12241c; }
  p.note { margin: 0 0 16px; max-width: 120ch; }
  .grid { display: grid; grid-template-columns: repeat(${cols}, ${cellW}px); gap: 18px; align-items: start; }
  figure { margin: 0; }
  img { display: block; width: ${cellW}px; border: 1px solid rgba(18,36,28,.35); background: #fdf8ef; }
  figcaption { padding-top: 6px; }
  b { color: #12241c; }
  .said { color: #6a5c44; font-style: italic; }
</style>
<h1>${title}</h1>
<p class="note">${note}</p>
<div class="grid">
${cells.map((c) => `  <figure>
    <img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}">
    <figcaption>${c.caption}</figcaption>
  </figure>`).join('\n')}
</div>
`
  const page = `${OUT}/${name}.html`
  writeFileSync(page, html)
  const rows = Math.ceil(cells.length / cols)
  const width = cols * cellW + (cols - 1) * 18 + 46
  const height = rows * (cellW * 0.82 + 96) + 120
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--virtual-time-budget=4000',
    `--window-size=${Math.round(width)},${Math.round(height)}`,
    `--screenshot=${process.cwd()}/${OUT}/${name}.png`,
    `file://${process.cwd()}/${page}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'] })
  console.log(`wrote ${OUT}/${name}.png`)
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

// -------------------------------------------------------------------- run it

const ONLY = arg('only', 'all')

await open()

if (ONLY === 'layout') {
  const only = await measureLayouts()
  writeFileSync(`${OUT}/tour-layout.json`, `${JSON.stringify(only.out, null, 2)}\n`)
  const wrong = only.out.filter(collides)
  console.log(wrong.length === 0
    ? 'no collisions at any of the four viewports.'
    : `collisions at: ${wrong.map((b) => b.device).join(', ')} — see build/tour-layout.json.`)
  sheet('tour-layout', 'Namaste India — the three collisions, measured',
    'Layout only (--only=layout): the same app at four viewports, idle and mid-beat.',
    only.shots.map((s) => ({ file: s.file, caption: `<b>${esc(s.caption)}</b>` })), 4, 380)
  stop()
  // `process.exit(code)`, not `process.exitCode = 1` followed by an exit(0)
  // that silently overrides it. This branch is a CHECK, and a check that
  // reports a collision on stdout and then exits 0 is not one — which is
  // exactly what it did the first time somebody reintroduced the phone
  // overflow to see whether the gate would catch it.
  process.exit(wrong.length ? 1 : 0)
}

const watched = await watchTheTour()
const cues = checkCues(watched.log)

console.log('\ncue by cue — the word it was authored on, and the word it landed on:')
let drift = 0
for (const row of cues) {
  if (row.landed === null && row.note) {
    console.log(`  ${row.beat} ${row.cue.padEnd(28)} word ${row.authored}  (${row.note})`)
    continue
  }
  const off = row.landed === null ? null : row.landed - row.authored
  if (off === null || Math.abs(off) > 2) drift++
  console.log(
    `  ${row.beat} ${row.cue.padEnd(28)} authored ${String(row.authored).padStart(2)}` +
    `  landed ${row.landed === null ? 'NEVER' : String(row.landed).padStart(2)}` +
    `${off === null ? '' : `  (${off >= 0 ? '+' : ''}${off})`}`,
  )
}

const layouts = await measureLayouts()

writeFileSync(`${OUT}/tour-watch.json`, `${JSON.stringify({
  beats: watched.shots.map((s) => ({ beat: s.beat, moment: s.moment, ...s.snap })),
  cues,
  log: watched.log,
}, null, 2)}\n`)
writeFileSync(`${OUT}/tour-layout.json`, `${JSON.stringify(layouts.out, null, 2)}\n`)
console.log(`\nwrote ${OUT}/tour-watch.json and ${OUT}/tour-layout.json`)

sheet(
  'tour-strip',
  'Namaste India — the whole tour, beat by beat',
  'The real app, built and served the way an iPad will see it, driven in headless Chrome and photographed at the moment each beat\'s art is on stage. '
  + 'The caption under each frame is the word being spoken when the shutter went, and what was on the map.',
  watched.shots.map((s) => ({
    file: s.file,
    caption: `<b>${esc(s.beat)}</b>${s.moment === 'beat' ? '' : ` — ${esc(s.why)}`}<br>`
      + `word ${s.snap.word}/${s.snap.words} <span class="said">${esc(s.snap.saying ?? '')}</span><br>`
      + `art: ${esc(s.snap.art ?? 'none')} · Mor: ${esc(s.snap.mor)} · lit: ${s.snap.lit}`,
  })),
  4,
  460,
)

sheet(
  'tour-layout',
  'Namaste India — the three collisions, measured',
  'The same app at four viewports, idle and mid-beat. The numbers are in build/tour-layout.json: '
  + 'whether all five controls are on screen at full size, whether the licence credit clears the bar, '
  + 'whether Mor clears the play button, and whether the read-along clears both.',
  layouts.shots.map((s) => ({ file: s.file, caption: `<b>${esc(s.caption)}</b>` })),
  4,
  380,
)

const bad = layouts.out.filter(collides)

console.log(`\n${drift === 0 ? 'every visible cue landed within two words of its own word.' : `${drift} cue(s) drifted or never landed — look at build/tour-watch.json.`}`)
console.log(bad.length === 0
  ? 'no collisions at any of the four viewports.'
  : `collisions at: ${bad.map((b) => b.device).join(', ')} — see build/tour-layout.json.`)

// A check, not a report. There are no layout tests in the vitest suite —
// jsdom has no boxes to measure — so this is the only thing that can fail
// when the bar stops fitting a phone or the credit goes back behind it.
if (drift || bad.length) process.exitCode = 1

stop()
