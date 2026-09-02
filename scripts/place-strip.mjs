#!/usr/bin/env node
/**
 * A layout gate for a state's own page — `/place/:slug` — the screen that
 * will exist 36 times and today has zero layout gating.
 *
 *   npm run place:strip
 *
 *     build/place-strip/<slug>-<w>x<h>.png   one screenshot per place per device
 *     build/place-strip.png                  a contact sheet of all of them
 *     build/place-layout.json                every measurement, machine-readable
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT PART OF `tour-strip.mjs`. That gate
 * measures twelve real iPad viewports and sixteen collisions on the tour —
 * the bar, the credit, Mor, the read-along — and none of it ever looks at
 * `/place/:slug`. The place screen shipped with the exact defect Plan 5's
 * Task 3 fixed on the tour (a licence credit the surrounding furniture can
 * cover), and it shipped INVISIBLY, because nothing was watching this route
 * at all. `docs/handover.md`'s own "gate list" is explicit that `tour:strip`
 * "does NOT check size" — the drawn map's zoom, an art element's rendered
 * size — and that omission is how a 2.5x shrink of the tour's own flight
 * sailed through a fully green run once already. This gate is written not
 * to repeat either mistake: every place, at every device, is checked for
 * both COLLISION (does the credit clear the bar, does a tile clear the bar,
 * is a label clipped) and SIZE (is a touch target really 104px, is the
 * state's own shape drawn at a sensible size and not clipped).
 *
 * THE DEVICE LIST is `scripts/lib/devices.mjs` — the exact one `tour:strip`
 * measures against, imported rather than retyped, because two independent
 * copies of a viewport list is how they drift apart unnoticed.
 *
 * THE PLACES are read off `content/places/*.json` at run time, not hand-
 * listed — the same reason `src/content/places.ts` is a glob and not an
 * index (see that file's own comment): a fifth place landing tomorrow makes
 * this gate check it with no second edit here.
 *
 * WHY A REAL BROWSER, AGAIN. jsdom does no layout and no hit testing. Every
 * question here — is a credit legible, is a touch target really 104px, is a
 * label's text visibly cut off, is a drawn border a sensible size — is a
 * question about real boxes on a real screen, which the test suite cannot
 * ask at all.
 *
 * HOW IT REACHES THE SCREEN. Not through the gate and a real tap on the map
 * — that is what `scripts/shot.mjs place.SLUG` is for, and it exercises the
 * hit layer deliberately. This gate goes straight to `#/place/SLUG`, the
 * SAME deep link `App.tsx`'s own routing comment describes as first-class
 * ("a grown-up reloading the iPad mid-visit must land here directly"): it
 * is a real, supported way to reach this screen, and it is enormously
 * cheaper across a 4-place x 12-device matrix than driving the gate and a
 * synthetic tap 48 times over. Nothing this gate measures — a rect, a
 * label's own box, a state's drawn size — depends on which door was used to
 * get here; `probe:map` already owns whether a real fingertip can reach the
 * hit layer.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { DEVICES } from './lib/devices.mjs'

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

// A DIFFERENT port from tour-strip.mjs's 4188 and shot.mjs's default 4189-
// 4191, deliberately: the task brief that authored this gate is explicit
// that if it ever runs alongside tour:strip, the two must not fight over one
// port. Nothing here ever runs both at once, but nothing should have to know
// that to be safe.
const PORT = 4198
const DEBUG_PORT = 9343
const OUT = 'build'
const FRAMES = `${OUT}/place-strip`

// Derived from the directory, not hand-listed — see this file's own header.
const PLACES = readdirSync('content/places')
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort()

// THIS USED TO BE IPAD_DEVICES, FILTERING THE TWO PHONE ROWS OUT. That
// exemption is gone with the ruling it depended on: docs/handover.md no
// longer says this app is iPad-only, and the reason the old ruling does not
// hold any more is recorded there in full (it was made by looking at the map
// screen, before this one existed). `place.css` now carries a real phone
// breakpoint — a stacked layout with a scrolling shelf, not a shrunk copy of
// the iPad one — and this gate measures it exactly as strictly as every
// other device: every check below (a real 104px target, a credit that clears
// the bar, a state drawn at a sane size, no clipped label) applies uniformly.
// Measured directly with the iPad row layout still in force (`node
// scripts/shot.mjs place.rajasthan --w=390 --h=844`): every card tile came
// out 76x104 and every landmark 59x120 — both short of the 103.5px floor on
// their narrow side, on the one dimension the four/five-across row layout
// could never fix by itself — which is exactly why place.css no longer lays
// phone tiles out in the iPad's fixed four/five-across rows.

if (PLACES.length === 0) {
  console.error('No files in content/places — nothing to gate.')
  process.exit(1)
}

mkdirSync(FRAMES, { recursive: true })

// ------------------------------------------------------------ the protocol
//
// The thinnest possible DevTools client, vendored rather than imported: both
// tour-strip.mjs and shot.mjs already carry their own identical copy of
// exactly this, because it is thirty lines of protocol boilerplate with
// nothing project-specific in it — the actual duplication risk the task
// brief calls out by name is the DEVICE LIST (a table of real numbers that
// can silently drift), not this client, so that is the one piece pulled
// into `lib/`.

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

  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    })
  }
}

async function until(check, { every = 100, limit = 30000, what = 'something' } = {}) {
  const deadline = Date.now() + limit
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(every)
  }
}

// -------------------------------------------------------------- the harness

let preview
let browser
let chrome
const profile = `${OUT}/.chrome-place`

/** Same reasons as tour-strip.mjs's own `stop()`: a spawned Chrome keeps a
 *  handle on this process's event loop, and SIGTERM first because Chrome
 *  flushes its (throwaway, under build/) profile on it. */
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
  preview = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort',
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
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
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
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
}

/** Straight to the place's own page — see the file header for why this,
 *  and not the gate plus a real tap, is the right door for THIS gate. */
async function gotoPlace(slug) {
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/place/${slug}` })
  await until(() => chrome.eval(`!!document.querySelector('.place')`), { what: `${slug}'s page` })
  // The arrival flight (PlaceScreen.tsx's own ARRIVE_MS) is 900ms; settle
  // past it before measuring anything the camera moves, or the state's own
  // drawn shape is caught mid-flight and both its position and its size are
  // meaningless numbers.
  await sleep(1300)
}

/**
 * Everything this gate measures, in the page. Mirrors the shape of
 * tour-strip.mjs's own LAYOUT script (same `box()`/`over()` primitives, same
 * "the rectangle a thing is allowed to occupy" idea) but aimed at what THIS
 * screen actually has: a shelf of nine tiles instead of five controls, one
 * state's own drawn shape instead of the whole country, no Mor.
 */
const LAYOUT = `(() => {
  const el = (s) => document.querySelector(s)
  const all = (s) => [...document.querySelectorAll(s)]
  const round = (n) => Math.round(n * 10) / 10
  const box = (b) => b && { left: round(b.left), top: round(b.top), right: round(b.right), bottom: round(b.bottom), w: round(b.width), h: round(b.height) }
  const r = (s) => { const e = el(s); return e ? box(e.getBoundingClientRect()) : null }
  const over = (a, b) => {
    if (!a || !b) return null
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0 && h > 0 ? { w: round(w), h: round(h) } : null
  }
  /** Is \`inner\` fully inside \`outer\`? Used both for "is this label clipped
   *  by its tile's overflow:hidden" and "is the state's own shape clipped by
   *  the map's own overflow:hidden" — the same question at two scales. */
  const contains = (outer, inner, tol = 0.5) =>
    !!outer && !!inner &&
    inner.left >= outer.left - tol && inner.right <= outer.right + tol &&
    inner.top >= outer.top - tol && inner.bottom <= outer.bottom + tol

  const bar = r('.controls')
  const credit = r('.map + .credit')
  // '.say-lane', NOT '.say' itself. Below 600px (place.css's own phone
  // rule) '.say-lane' clips/scrolls '.say' rather than reserving room for
  // its full worst-case height (see that file's own note on why: the same
  // text that wraps to seven lines on an iPad wraps to sixteen here, and
  // reserving that would cost the map more than it is being given). A
  // scrolled-and-clipped box is invisible past its own edge, but
  // getBoundingClientRect on '.say' itself still reports its full,
  // UNCLIPPED content height regardless — measured directly, this fired a
  // "credit under the caption" failure on every phone row even though
  // nothing was visibly overlapping in the real screenshot next to it.
  // '.say-lane' is the element overflow actually clips, so it is the one
  // that answers "what does a child actually see" — exactly what every
  // other check in this file is trying to measure.
  const say = r('.say-lane') ?? r('.say')
  const placeName = r('.place-name')
  const mapBox = r('.map')
  const shelf = r('.place-shelf')

  // THE STATE'S OWN SHAPE. Not '.map .base g' (tour-strip's mapInk, the
  // WHOLE visible country) — this screen highlights exactly one path, the
  // place the child is on (PlaceScreen.tsx's own highlight effect, cleared
  // and re-set on every page change), so that single lit path IS the
  // picture this screen is about. getBoundingClientRect on an SVG geometry
  // element already accounts for the camera's committed viewBox and the
  // .stage transform, so no manual viewBox->screen mapping is needed the
  // way tour-strip.mjs's Mor measurement (a different element, drawn in its
  // own local viewBox) requires.
  const litPaths = all('.map .base path.lit')
  const ink = litPaths.length === 1 ? box(litPaths[0].getBoundingClientRect()) : null

  // EVERY TILE ON THE SHELF: nine of them, four cards then five landmarks,
  // DOM order — see PlaceScreen.tsx. Each carries its own word, and '.tile'
  // is 'overflow: hidden' (place.css), so a label whose own box pokes out of
  // its tile's box is not a rendering detail, it is invisible text — exactly
  // the "Festival" -> "tival" failure the task brief names.
  //
  // BELOW 600PX (place.css's own phone rule) '.place-shelf' scrolls on
  // purpose — four/five tiles across at 104px each do not fit a phone's
  // width, so the shelf runs taller instead and a thumb moves to reach the
  // rest. A tile that starts out only partly visible, peeking above the
  // fold as an invitation to scroll, is the DESIGN, not a defect, and
  // measuring it in that unscrolled position would fail it for being
  // exactly what it is asking the child to do.
  //
  // NOT 'scrollIntoView'. It was tried, and it does nothing here: a peeking
  // row sitting behind the fixed bar is, as far as the DOM is concerned,
  // ALREADY fully inside '.place-shelf''s own scrollport (0 to its
  // clientHeight) — 'scrollIntoView' has no idea a 'position: fixed'
  // sibling is visually painted over the bottom of that scrollport, so it
  // considers the row already visible and scrolls nothing. The fix scrolls
  // the shelf directly, by exactly the row's own overlap with the bar's
  // real rect, which is the same nudge a real swipe gives it — then
  // re-measures. If even the shelf's OWN maximum scroll cannot clear a row
  // (checked below by clamping to scrollHeight - clientHeight), that is a
  // real defect and the check still fails it.
  //
  // RESET FIRST. This gate never reloads the page between devices for the
  // same place — 'gotoPlace' re-navigates to the SAME hash, which a
  // same-page SPA route treats as a no-op, so the DOM (and any scrollTop a
  // PREVIOUS device's own adjustment left behind) simply carries over.
  // Measured directly: without this line, "phone" pushing the shelf down to
  // clear a landmark left "small phone" — the very next device for the same
  // place — measuring "Animal" and "Food" at scrollTop's leftover offset,
  // both reported off-screen at the top. Every row has to start from the
  // same, real, scrolled-to-the-top state a child actually lands on.
  const shelfEl = el('.place-shelf')
  if (shelfEl) shelfEl.scrollTop = 0
  const tiles = all('.place-shelf .tile').map((t) => {
    let tileBox = box(t.getBoundingClientRect())
    if (shelfEl && bar && tileBox.bottom > bar.top + 0.5) {
      const need = tileBox.bottom - bar.top + 2
      shelfEl.scrollTop = Math.min(shelfEl.scrollHeight - shelfEl.clientHeight, shelfEl.scrollTop + need)
      tileBox = box(t.getBoundingClientRect())
    }
    const wordEl = t.querySelector('.tile__word')
    const wordBox = wordEl ? box(wordEl.getBoundingClientRect()) : null
    return {
      label: (wordEl?.textContent ?? '').trim(),
      box: tileBox,
      bigEnough: tileBox.w >= 103.5 && tileBox.h >= 103.5,
      onScreen: tileBox.left >= -0.5 && tileBox.right <= innerWidth + 0.5
        && tileBox.top >= -0.5 && tileBox.bottom <= innerHeight + 0.5,
      clearOfBar: !bar || !over(tileBox, bar),
      labelClipped: !contains(tileBox, wordBox),
    }
  })

  return {
    viewport: [innerWidth, innerHeight],
    bar: bar && { top: bar.top, overflow: (() => {
      const c = el('.controls')
      return c ? round(c.scrollWidth - c.clientWidth) : null
    })() },
    credit: credit && {
      box: credit,
      visible: bar ? credit.bottom <= bar.top + 0.5 : credit.bottom <= innerHeight + 0.5,
      onScreen: credit.left >= -0.5 && credit.top >= -0.5 && credit.right <= innerWidth + 0.5,
      overBar: over(credit, bar),
      overSay: over(credit, say),
      overShelf: over(credit, shelf),
    },
    say: say && { box: say, overBar: over(say, bar) },
    placeName: placeName && { box: placeName, overBar: over(placeName, bar) },
    mapBox,
    // THE PICTURE MUST NOT LEAK UNDER THE BAR. .map itself never can — it is
    // sized by --map-floor, which every place.css breakpoint keeps clear of
    // the bar by construction — but this is the same "measure the thing
    // itself, not the box it is framed in" lesson tour-strip.mjs's own
    // mapInk comment states: a wrongly-computed --map-floor would shrink or
    // misplace .map's OWN box, and THAT is what a bar overlap on .map would
    // catch, whether or not the ink inside it is also wrong.
    mapOverBar: over(mapBox, bar),
    ink: ink && {
      box: ink,
      litCount: litPaths.length,
      clippedByMap: !contains(mapBox, ink),
      // How much of the map's own picture the state's shape actually fills,
      // on whichever axis it fills more of — the SIZE question tour-strip
      // never asked and the Delhi flight regression exploited. A state
      // rendered at a sane zoom fills a real fraction of the box it was
      // flown into; one rendered as a speck does not, however correctly
      // POSITIONED that speck is.
      // Three decimals, not the pixel rounding \`round\` uses everywhere else
      // above: this is a ratio near 0.19 for the tightest real place
      // (Delhi), and rounding it to one decimal place would land every
      // single Delhi measurement on the same "0.2" and make a real
      // threshold impossible to set without either false-failing Delhi or
      // going blind to an actual shrink. See MIN_FILL_FRACTION below.
      fillFraction: mapBox && mapBox.w > 0 && mapBox.h > 0
        ? Math.round(Math.max(ink.w / mapBox.w, ink.h / mapBox.h) * 1000) / 1000
        : null,
    },
    tiles,
    // NOT shelfOverBar. \`.place-shelf\`'s own OUTER box deliberately reaches
    // into the bar's territory — place.css's own comment on \`.place-shelf\`
    // says so by name: "THE BAR'S CLEARANCE LIVES HERE", a
    // \`padding-bottom: calc(var(--bar-over) + 8px)\` that is empty space BY
    // DESIGN, not content. Comparing the shelf's own rect against the bar
    // measures that reserved padding, not anything a child can see — it
    // fired on effectively every device in this gate's first real run with
    // an overlap height of EXACTLY the padding amount, which is the tell.
    // Per-tile \`clearOfBar\` above (checked by name in \`problems()\`) is the
    // real question ("is a TILE behind the bar, even at its own best
    // reachable scroll position"), and unlike this one it did not fire once
    // in that same run.
    pageScrolls: document.documentElement.scrollWidth > innerWidth + 0.5
      || document.documentElement.scrollHeight > innerHeight + 0.5,
  }
})()`

async function measure(slug, deviceName, w, h) {
  await chrome.viewport(w, h)
  await gotoPlace(slug)
  const data = await chrome.eval(LAYOUT)
  const file = `${FRAMES}/${slug}-${w}x${h}.png`
  await chrome.shot(file)
  return { slug, device: deviceName, w, h, file, ...data }
}

// -------------------------------------------------------------- the checks
//
/**
 * What counts as wrong, in one place, so this list and the human-readable
 * log below cannot disagree about whether a row failed.
 *
 * THE SIZE THRESHOLD. Measured across all four written places at every real
 * iPad device (`build/place-layout.json`, printed by every run, at full
 * precision — see `fillFraction`'s own comment above on why three decimals
 * and not one): Delhi, the smallest and tightest by geography rather than by
 * any bug, sits at 0.188-0.190 on EVERY iPad viewport, unusually flat because
 * `PlaceScreen.tsx`'s `ARRIVAL_MARGIN` frames every place by the same
 * proportion of its own size. 0.10 is the floor: real headroom under Delhi's
 * own true number (not the false margin a one-decimal rounding would have
 * shown — that rounded Delhi to exactly 0.2 and would have made a 0.20 floor
 * a permanent false failure on the smallest of the four places), while
 * still catching anything on the order of the tour's own Delhi-flight
 * regression (a measured 2.5x shrink) rather than a state that is simply
 * small by geography.
 */
const MIN_FILL_FRACTION = 0.10

function problems(row) {
  const out = []
  if (!row.credit) out.push('no credit rendered at all')
  else {
    if (!row.credit.visible) out.push('credit not clear of the bar')
    if (!row.credit.onScreen) out.push('credit off-screen')
    if (row.credit.overBar) out.push(`credit over the bar ${JSON.stringify(row.credit.overBar)}`)
    if (row.credit.overSay) out.push(`credit under the caption ${JSON.stringify(row.credit.overSay)}`)
    if (row.credit.overShelf) out.push(`credit under the shelf ${JSON.stringify(row.credit.overShelf)}`)
  }
  if (row.say?.overBar) out.push(`caption over the bar ${JSON.stringify(row.say.overBar)}`)
  if (row.placeName?.overBar) out.push(`name plate over the bar ${JSON.stringify(row.placeName.overBar)}`)
  if (row.mapOverBar) out.push(`the map itself over the bar ${JSON.stringify(row.mapOverBar)}`)
  if (row.pageScrolls) out.push('the page scrolls')

  for (const t of row.tiles) {
    if (!t.bigEnough) out.push(`tile "${t.label}" is only ${t.box.w}x${t.box.h} (needs 103.5x103.5)`)
    if (!t.onScreen) out.push(`tile "${t.label}" is off-screen`)
    // Checked at the tile's own best reachable scroll position (see the
    // LAYOUT script's own note) — this only fires if even the shelf's
    // maximum scroll cannot clear it of the fixed bar.
    if (!t.clearOfBar) out.push(`tile "${t.label}" cannot be scrolled clear of the bar`)
    if (t.labelClipped) out.push(`tile "${t.label}"'s own label is clipped`)
  }

  if (!row.ink) out.push("the state's own shape is not drawn (no single lit path found)")
  else {
    if (row.ink.litCount !== 1) out.push(`${row.ink.litCount} states lit, expected exactly 1`)
    if (row.ink.clippedByMap) out.push("the drawn state pokes outside the map's own box")
    if (row.ink.fillFraction !== null && row.ink.fillFraction < MIN_FILL_FRACTION) {
      out.push(`the drawn state fills only ${row.ink.fillFraction} of the map box (floor ${MIN_FILL_FRACTION})`)
    }
  }
  return out
}

// -------------------------------------------------------------------- run it

await open()

const rows = []
for (const slug of PLACES) {
  console.log(`\n${slug}`)
  for (const [name, w, h] of DEVICES) {
    const row = await measure(slug, name, w, h)
    rows.push(row)
    const bad = problems(row)
    console.log(
      `  ${name.padEnd(28)} ${String(w).padStart(4)}x${h}` +
      `  credit ${row.credit ? (row.credit.visible ? 'ok' : 'BAD') : 'MISSING'}` +
      `  tiles ${row.tiles.filter((t) => t.bigEnough && t.onScreen && t.clearOfBar && !t.labelClipped).length}/${row.tiles.length} ok` +
      `  ink ${row.ink ? `${row.ink.box.w}x${row.ink.box.h} (${Math.round((row.ink.fillFraction ?? 0) * 100)}% of map)` : 'MISSING'}` +
      (bad.length ? `\n      ${bad.join('\n      ')}` : ''),
    )
  }
}

writeFileSync(`${OUT}/place-layout.json`, `${JSON.stringify(rows, null, 2)}\n`)
console.log(`\nwrote ${OUT}/place-layout.json`)

const bad = rows.filter((row) => problems(row).length > 0)

console.log(bad.length === 0
  ? `\nno problems at any of ${PLACES.length} places x ${DEVICES.length} devices.`
  : `\n${bad.length} problem row(s) of ${rows.length}: ${bad.map((r) => `${r.slug}/${r.device}`).join(', ')} — see build/place-layout.json.`)

// ---------------------------------------------------------------- the sheet

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
  const rowsN = Math.ceil(cells.length / cols)
  const width = cols * cellW + (cols - 1) * 18 + 46
  const height = rowsN * (cellW * 0.82 + 96) + 120
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

sheet(
  'place-strip',
  'Namaste India — every place, every device',
  `${PLACES.length} places (${PLACES.join(', ')}) at all ${DEVICES.length} real devices from lib/devices.mjs, iPads and phones alike. `
  + 'Each caption is the device name and what this gate measured on it.',
  rows.map((r) => ({
    file: r.file,
    caption: `<b>${esc(r.slug)}</b> — ${esc(r.device)} ${r.w}x${r.h}<br>`
      + `credit ${r.credit?.visible ? 'ok' : 'BAD'} · `
      + `tiles ${r.tiles.filter((t) => t.bigEnough && t.onScreen && t.clearOfBar && !t.labelClipped).length}/${r.tiles.length} ok · `
      + `ink ${r.ink ? `${Math.round((r.ink.fillFraction ?? 0) * 100)}%` : 'MISSING'}`,
  })),
  4,
  300,
)

stop()

// A check, not a report. See tour-strip.mjs's own comment on this line: a
// collision reported on stdout and then exited 0 is not a gate, which is
// exactly how this project already got bitten once.
process.exitCode = bad.length ? 1 : 0
