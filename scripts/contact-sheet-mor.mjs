#!/usr/bin/env node
/**
 * Photograph Mor, and measure him.
 *
 *   npm run contact-sheet:mor  ->  build/mor.png          the three states, settled
 *                              ->  build/mor-devices.png  three real viewports
 *                              ->  build/mor-clearance.json  the overlap numbers
 *
 * A test can prove he carries the right state. Only a person can say whether
 * he is charming, and only a browser can say whether he is standing on the
 * play button — jsdom does no layout, so every claim about where he actually
 * lands has to come from here.
 *
 * Same shape as contact-sheet-art.mjs, for the same reasons: esbuild is a
 * declared devDependency rather than whatever `npx` resolves on the day, and
 * the bundle is an IIFE because Chrome will not load a module over file://.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

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

mkdirSync('build', { recursive: true })

console.log('bundling')
execFileSync('npx', [
  'esbuild', 'scripts/art-sheet/mor.tsx',
  '--bundle', '--format=iife', '--jsx=automatic', '--loader:.json=json',
  '--define:process.env.NODE_ENV="production"',
  // Vite injects these; esbuild does not, and the narration engine and
  // assetUrl both read them the moment the control bar mounts.
  '--define:import.meta.env={"DEV":false,"MODE":"production","BASE_URL":"./"}',
  '--outfile=build/mor.js',
], { stdio: 'inherit' })

writeFileSync('build/mor-panel.html', `<!doctype html>
<meta charset="utf-8">
<title>Namaste India — Mor</title>
<link rel="stylesheet" href="mor.css">
<div id="root"></div>
<script src="mor.js"></script>
`)

/** One screenshot. The virtual time budget is longer than every entry
 *  animation and shorter than the shortest hold, so nothing has dismissed
 *  itself before the shutter. */
function shoot(page, out, w, h) {
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--virtual-time-budget=3500',
    `--window-size=${w},${h}`,
    `--screenshot=${process.cwd()}/build/${out}`,
    `file://${process.cwd()}/build/${page}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'] })
  console.log(`wrote build/${out}`)
}

// ------------------------------------------------------------- the sheet

shoot('mor-panel.html', 'mor.png', 1740, 1210)

// ----------------------------------------------------------- the devices

/**
 * The viewports that matter. The iPad is the machine this is built for;
 * the phone is in here because a bottom corner is only safe if it is safe on
 * the smallest thing anyone will hold it up to.
 */
const DEVICES = [
  // The phone twice, and the pair is the point. `showing` is the widest Mor
  // ever gets; `idle` is the state the play button is actually on screen in,
  // because a tour that is playing does not need a Play button in the middle
  // of the map.
  ['phone, idle', 390, 844, 'idle', '0'],
  ['phone, showing', 390, 844, 'showing', '1'],
  ['iPad portrait', 768, 1024, 'talking', '0'],
  ['iPad landscape', 1024, 768, 'showing', '1'],
]

const query = (state, tiger) => `panel=device&state=${state}&tiger=${tiger}`

writeFileSync('build/mor-devices.html', `<!doctype html>
<meta charset="utf-8">
<title>Namaste India — Mor, in place</title>
<style>
  body { margin: 0; padding: 18px 20px 22px; background: #efe9dc;
         font: 14px/1.4 system-ui, sans-serif; color: #3d4a41; }
  h1 { margin: 0 0 4px; font-size: 22px; color: #12241c; }
  p.note { margin: 0 0 14px; max-width: 100ch; }
  .row { display: flex; gap: 20px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { padding-top: 6px; }
  b { color: #12241c; }
  iframe { border: 1px solid rgba(18,36,28,.35); background: #fdf8ef; display: block; }
</style>
<script>
  /* Each panel measures itself and leaves the answer in its own DOM; this
     collects the three. It has to happen out here because headless Chrome
     will not open a window narrower than 500px — asking for 390 gets 500,
     and a clearance measured at the wrong width is worse than none. An
     iframe is the only way to get a viewport of exactly the size asked for.
     Reading across into one needs --allow-file-access-from-files, which the
     shooting script passes for this page and nothing else. */
  setTimeout(function () {
    var out = [].map.call(document.querySelectorAll('iframe'), function (f) {
      var pre = f.contentDocument && f.contentDocument.getElementById('measure')
      return {
        device: f.dataset.device,
        state: f.dataset.state,
        measured: pre ? JSON.parse(pre.textContent.slice('MEASURE:'.length)) : null,
      }
    })
    var pre = document.createElement('pre')
    pre.id = 'measure-all'
    pre.hidden = true
    pre.textContent = 'MEASURE-ALL:' + JSON.stringify(out)
    document.body.appendChild(pre)
  }, 1200)
</script>
<h1>Mor, in place — the real control bar, and a stand-in for the play button</h1>
<p class="note">
  Each panel is the whole screen at one viewport size: the real map, the real
  fixed control bar, and a <b>stand-in</b> for the play button Task&nbsp;10 has
  not built yet, drawn at the size the plan promises (2&nbsp;&times;&nbsp;--tap,
  208px) in the place the plan promises (centred, at the bottom). The numbers
  are in build/mor-clearance.json.
</p>
<div class="row">
${DEVICES.map(([name, w, h, state, tiger]) => `  <figure>
    <iframe src="mor-panel.html?${query(state, tiger)}" width="${w}" height="${h}"
            data-device="${name}" data-state="${state}"></iframe>
    <figcaption><b>${name}</b> — ${w}&times;${h}, ${state}</figcaption>
  </figure>`).join('\n')}
</div>
`)

const DW = DEVICES.reduce((sum, [, w]) => sum + w, 0) + DEVICES.length * 22 + 40
const DH = Math.max(...DEVICES.map(([, , h]) => h)) + 130
shoot('mor-devices.html', 'mor-devices.png', DW, DH)

// --------------------------------------------------------- the clearance

/**
 * The numbers. Same page, same iframes, same sizes as the picture above it —
 * so the measurement is of the thing that was photographed and not of a
 * second arrangement that happens to look similar.
 */
const dom = execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--virtual-time-budget=4000', '--dump-dom',
  // file:// documents are otherwise opaque origins to each other, and the
  // page cannot read its own panels. Only this page, only to read numbers.
  '--allow-file-access-from-files',
  `--window-size=${DW},${DH}`,
  `file://${process.cwd()}/build/mor-devices.html`,
], { maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString()

const found = /MEASURE-ALL:(\[[\s\S]*?\])<\/pre>/.exec(dom)
if (!found) throw new Error('the devices page never reported a measurement')
const clearance = JSON.parse(found[1])
if (clearance.some((c) => !c.measured)) {
  throw new Error(`a panel measured nothing: ${clearance.filter((c) => !c.measured).map((c) => c.device)}`)
}

writeFileSync('build/mor-clearance.json', `${JSON.stringify(clearance, null, 2)}\n`)
console.log('wrote build/mor-clearance.json')
for (const { device, measured: m } of clearance) {
  console.log(
    `  ${device.padEnd(15)} ${m.viewport.join('x')}` +
    `  ink ${m.ink.w}x${m.ink.h} at (${m.ink.left}, ${m.ink.top})` +
    `  gap to bar ${m.gapToControls}px` +
    `  over bar: ${m.inkOverlapsControls ? `${m.inkOverlapsControls.w}x${m.inkOverlapsControls.h}` : 'NO'}` +
    `  over play stand-in: ${m.inkOverlapsPlayStandIn ? `${m.inkOverlapsPlayStandIn.w}x${m.inkOverlapsPlayStandIn.h}` : 'NO'}` +
    `  tap through: ${m.tapPassesThrough.passed ? `yes (${m.tapPassesThrough.hit})` : `NO — ${m.tapPassesThrough.hit}`}`,
  )
}
