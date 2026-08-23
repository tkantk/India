#!/usr/bin/env node
/**
 * The colour equivalent of `tour:strip` and `probe:map`: a gate, not a
 * report, that measures the app's own palette instead of trusting eight
 * screens' worth of a person looking. Three visual directions shipped and
 * not one of them added a test for its own colours; Plan 3's 32 state
 * screens are the reason that stops being survivable.
 *
 *   npm run colour:check
 *
 * FOUR THINGS, ALL FROM THE REAL SOURCE. Nothing here is a second copy of a
 * table that already exists elsewhere — `src/tour/effects/subject.ts` is
 * imported directly (through `scripts/lib/json-import.mjs`, which lets plain
 * Node resolve the one JSON import Vite already resolves without it), so a
 * row added there is checked here the moment it lands, with no second list
 * to keep in step.
 *
 *   1. every subject in SUBJECTS (and the DEFAULT_SUBJECT a keyless beat
 *      falls back to) resolves every one of page/ink/accent to a colour
 *      that is actually in PALETTE — the same "nothing outside the shared
 *      set" rule `Symbol.test.tsx` already holds the drawn art to, applied
 *      to the TABLE rather than the SVG output.
 *   2. no two consecutive beats share a page colour. Read literally that
 *      would flag `countTo` for showing up three times in the tour — which
 *      is correct, not a bug, since a counting disc always looks the same
 *      regardless of what it is counting (subject.ts's own words) — so the
 *      rule actually checked is "two DIFFERENT subjects, back to back,
 *      never share a page": a repeat of the SAME subject is a picture
 *      recurring, not a smear.
 *   3. text (`--ink`) clears a contrast floor on every one of the eight
 *      pages. 7:1 — WCAG AAA for normal text — because it is the number
 *      this app already holds itself to everywhere else (base.css,
 *      grandTour.css and startGate.css all cite "7:1 AAA" in their own
 *      comments) and the audience is six.
 *   4. the art/palette.ts literal mirror still matches its CSS source —
 *      not re-checked here: `Symbol.test.tsx` already asserts this
 *      (`paletteDrift`, in art/palette.ts), so this gate CALLS that exact
 *      function on the same two files rather than growing a second copy of
 *      the same string search. WebKit's legacy SVG engine will not resolve
 *      `var()` in a presentation attribute, which is the entire reason the
 *      mirror — and the risk of it drifting — exists at all.
 *
 * WHY NO BROWSER. Every other gate in scripts/ (`tour-strip.mjs`,
 * `probe-map-hits.mjs`) exists because jsdom does no layout and no hit
 * testing, so a real answer needs a real render. Colour is different: an
 * RGB triple and a contrast ratio are pure arithmetic, unaffected by
 * layout, and PALETTE/SUBJECTS are already resolved data by the time this
 * script sees them. Nothing here needs a screen.
 */
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./lib/json-import.mjs', import.meta.url)

const { SUBJECTS, DEFAULT_SUBJECT, subjectKeyFor } =
  await import('../src/tour/effects/subject.ts')
const { PALETTE, paletteDrift } = await import('../src/tour/effects/art/palette.ts')

const tour = JSON.parse(readFileSync('content/tour.json', 'utf8'))
const baseCss = readFileSync('src/styles/base.css', 'utf8')

let failures = 0
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`) }

console.log('namaste india — colour-check\n')

// ------------------------------------------------- 1. every colour is real

console.log('1. every subject resolves to a real colour')
const ALLOWED = new Set(Object.values(PALETTE))
const table = { ...SUBJECTS, DEFAULT_SUBJECT }
let colourCount = 0
for (const [name, subject] of Object.entries(table)) {
  for (const role of ['page', 'ink', 'accent']) {
    colourCount++
    const hex = subject[role]
    if (!ALLOWED.has(hex)) fail(`${name}.${role} = ${hex ?? '(missing)'} is not a colour in art/palette.ts`)
  }
}
console.log(`   ${Object.keys(table).length} subjects, ${colourCount} colour values, all drawn from PALETTE\n`)

// ------------------------------- 2. no two consecutive beats share a page

console.log('2. no two consecutive beats share a page colour')
// LAYER subjects (Reveal.tsx's own split: a FIGURE prints on a page, a
// LAYER paints on the map itself) never show a page on screen at all — the
// outline a child traces, the Ganga, the Himalaya, the three seas and the
// "look down" ring all carry only an `accent`. The three seas in particular
// are IDENTICAL rows on purpose (Sea.tsx accumulates them into one picture),
// so comparing their unused `page` would flag a deliberate choice as a bug.
const LAYER_ONLY = new Set([
  'outline', 'arabian-sea', 'bay-of-bengal', 'indian-ocean',
  'ganga', 'raiseMountains', 'zoomTo',
])

const events = []
for (const beat of tour.beats) {
  const cues = [...(beat.cues ?? [])].sort((a, b) => a.word - b.word)
  for (const cue of cues) {
    const key = subjectKeyFor(cue.do, cue.arg)
    if (!key || LAYER_ONLY.has(key)) continue
    events.push({ beat: beat.id, key, page: SUBJECTS[key]?.page ?? DEFAULT_SUBJECT.page })
  }
}

const pageName = (hex) => Object.entries(PALETTE).find(([, v]) => v === hex)?.[0] ?? hex
for (const [i, e] of events.entries()) {
  const prev = events[i - 1]
  const clash = prev && prev.page === e.page && prev.key !== e.key
  console.log(`   ${e.beat.padEnd(8)} ${e.key.padEnd(14)} ${pageName(e.page)}${clash ? '  <-- same page as the beat before it' : ''}`)
  if (clash) fail(`${prev.beat}/${prev.key} and ${e.beat}/${e.key} are different subjects on the same page (${pageName(e.page)})`)
}
console.log(`   ${events.length} page-bearing moments checked\n`)

// ------------------------------------------------------- 3. contrast floor

console.log('3. text clears a contrast floor on every page (--ink, 7:1 AAA — the figure this app already cites everywhere else, for an audience of six)')
const FLOOR = 7.0
function relLuminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a, b) {
  const [la, lb] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x)
  return (la + 0.05) / (lb + 0.05)
}
const PAGES = Object.entries(PALETTE).filter(([name]) => name === 'paper' || name.startsWith('mat'))
for (const [name, hex] of PAGES) {
  const ratio = contrast(PALETTE.ink, hex)
  const ok = ratio >= FLOOR
  console.log(`   ${name.padEnd(10)} ${hex}  ${ratio.toFixed(2)}:1  ${ok ? 'pass' : 'FAIL'}`)
  if (!ok) fail(`--ink on ${name} (${hex}) is ${ratio.toFixed(2)}:1, below the ${FLOOR}:1 floor`)
}
console.log()

// --------------------------------------------- 4. the palette.ts mirror

console.log('4. art/palette.ts still mirrors base.css (calling Symbol.test.tsx\'s own check, not a second copy of it)')
const drift = paletteDrift(baseCss)
if (drift.length === 0) {
  console.log(`   all ${Object.keys(PALETTE).length} PALETTE values are declared in base.css\n`)
} else {
  for (const d of drift) fail(`art/palette.ts's ${d} is not declared in base.css`)
  console.log()
}

// ------------------------------------------------------------------ verdict

if (failures === 0) {
  console.log('colour-check: clean.')
} else {
  console.log(`colour-check: ${failures} failure(s) — see FAIL lines above.`)
}
process.exitCode = failures === 0 ? 0 : 1
