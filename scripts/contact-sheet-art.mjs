#!/usr/bin/env node
/**
 * Photograph every piece of tour art at once.
 *
 * Bundles scripts/art-sheet/sheet.tsx (which renders the real cue seam over
 * the real map), then screenshots it in headless Chrome. A test can prove a symbol
 * renders; only a person can say whether it reads as a tiger.
 *
 *   npm run contact-sheet:art   ->  build/symbols.png   every cue, settled
 *                               ->  build/fixes.png     two pictures a test cannot make
 *
 * The second sheet is two documents in iframes, because the camera is a
 * module singleton: one page cannot hold a map at home and a map at Delhi.
 * See scripts/art-sheet/fixes.tsx.
 *
 * esbuild is a declared devDependency rather than whatever `npx` resolves on
 * the day — a review tool that quietly changes underneath you is not one.
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

// IIFE, not ESM: Chrome will not load a module over file://, and a review
// page is not worth a web server.
console.log('bundling')
execFileSync('npx', [
  'esbuild', 'scripts/art-sheet/sheet.tsx',
  '--bundle', '--format=iife', '--jsx=automatic', '--loader:.json=json',
  '--define:process.env.NODE_ENV="production"',
  '--outfile=build/symbols.js',
], { stdio: 'inherit' })

writeFileSync('build/symbols.html', `<!doctype html>
<meta charset="utf-8">
<title>Namaste India — tour art</title>
<link rel="stylesheet" href="symbols.css">
<div id="root"></div>
<script src="symbols.js"></script>
`)

/** Four columns, and the sheet's own arithmetic for how tall that is — a
 *  screenshot is the window, so a wrong height silently crops the last row. */
const vocab = JSON.parse(readFileSync('content/vocab.json', 'utf8'))
const cells = vocab.revealSymbol.length + vocab.showScript.length + 6 // flag, three counters, river, mountains
const rows = Math.ceil(cells / 4)
const W = 4 * 332 + 3 * 22 + 48
const H = 165 + rows * 414

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

console.log(`shooting ${cells} cells, ${rows} rows, ${W}x${H}`)
shoot('symbols.html', 'symbols.png', W, H)

// ------------------------------------------------------- the fix sheet

console.log('bundling the fix sheet')
execFileSync('npx', [
  'esbuild', 'scripts/art-sheet/fixes.tsx',
  '--bundle', '--format=iife', '--jsx=automatic', '--loader:.json=json',
  '--define:process.env.NODE_ENV="production"',
  '--outfile=build/fixes.js',
], { stdio: 'inherit' })

writeFileSync('build/fixes-panel.html', `<!doctype html>
<meta charset="utf-8">
<title>Namaste India — a panel</title>
<link rel="stylesheet" href="fixes.css">
<div id="root"></div>
<script src="fixes.js"></script>
`)

// Two documents, side by side. Each iframe is its own JS world, which is the
// only way one picture can hold a map at home and a map at Delhi: the camera
// is a module singleton, deliberately, because there is one map on screen for
// the life of the app.
const PANELS = [
  ['seas', 1620, 740],
  ['river', 800, 966],
]
writeFileSync('build/fixes.html', `<!doctype html>
<meta charset="utf-8">
<title>Namaste India — the two fixes</title>
<style>
  body { margin: 0; padding: 0; background: #efe9dc; display: flex; align-items: flex-start; }
  iframe { border: 0; }
</style>
${PANELS.map(([p, w, h]) => `<iframe src="fixes-panel.html?panel=${p}" width="${w}" height="${h}"></iframe>`).join('\n')}
`)

const FW = PANELS.reduce((sum, [, w]) => sum + w, 0)
const FH = Math.max(...PANELS.map(([, , h]) => h))
console.log(`shooting the fix sheet, ${FW}x${FH}`)
shoot('fixes.html', 'fixes.png', FW, FH)
