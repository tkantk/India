#!/usr/bin/env node
/**
 * Photograph every piece of tour art at once.
 *
 * Bundles scripts/art-sheet/sheet.tsx (which renders the real cue seam over
 * the real map), then screenshots it in headless Chrome. A test can prove a symbol
 * renders; only a person can say whether it reads as a tiger.
 *
 *   npm run contact-sheet:art   ->  build/symbols.png
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

console.log(`shooting ${cells} cells, ${rows} rows, ${W}x${H}`)
execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  // Long enough for every entry animation to finish (the outline draws for
  // 2.2 s) and shorter than the shortest hold, so nothing has dismissed
  // itself before the shutter.
  '--virtual-time-budget=3500',
  `--window-size=${W},${H}`,
  `--screenshot=${process.cwd()}/build/symbols.png`,
  `file://${process.cwd()}/build/symbols.html`,
], { stdio: ['ignore', 'ignore', 'ignore'] })

console.log('wrote build/symbols.png')
