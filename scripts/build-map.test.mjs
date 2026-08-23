import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { baseMarkup } from '../src/map/hitLayer.ts'
import { mapPage } from './lib/mapPage.mjs'

const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))

describe('generated geo.json', () => {
  it('has all 28 states and 8 union territories', () => {
    const places = Object.values(geo.places)
    expect(places).toHaveLength(36)
    expect(places.filter(p => p.type === 'state')).toHaveLength(28)
    expect(places.filter(p => p.type === 'ut')).toHaveLength(8)
  })

  it('includes Ladakh as a separate union territory (post-2019)', () => {
    expect(geo.places.ladakh?.type).toBe('ut')
  })

  it('has merged Dadra & Nagar Haveli with Daman & Diu (post-2020)', () => {
    expect(geo.places['dadra-and-nagar-haveli-and-daman-and-diu']).toBeDefined()
    expect(geo.places['daman-diu']).toBeUndefined()
  })

  it('gives every place a non-trivial path', () => {
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.d.length, `${slug} has no path data`).toBeGreaterThan(50)
    }
  })

  it('knows Rajasthan touches five states', () => {
    expect(geo.places.rajasthan.neighbours.sort())
      .toEqual(['gujarat', 'haryana', 'madhya-pradesh', 'punjab', 'uttar-pradesh'])
  })

  // Plan 4 / Task 1: content/places/delhi.json's intro used to say only
  // "Haryana wraps around it", implying a single, enclosing neighbour. This
  // is the ground truth the fix (both neighbours named) rests on.
  it('knows Delhi has two neighbours, not one', () => {
    expect(geo.places.delhi.neighbours.sort()).toEqual(['haryana', 'uttar-pradesh'])
  })

  it('makes neighbour relationships symmetric', () => {
    for (const [slug, p] of Object.entries(geo.places)) {
      for (const n of p.neighbours) {
        expect(geo.places[n].neighbours, `${n} should list ${slug}`).toContain(slug)
      }
    }
  })

  it('gives island territories no land neighbours', () => {
    expect(geo.places.lakshadweep.neighbours).toEqual([])
    expect(geo.places['andaman-nicobar'].neighbours).toEqual([])
  })

  it('keeps every state inside a sane fraction of the viewBox', () => {
    // This is the automated half of the blob check. If the rings are not
    // rewound clockwise, d3 renders each polygon as its own complement and
    // every bbox balloons to span the whole viewBox — measured: Rajasthan
    // goes from [74.7, 254.3, 286.9, 261.7] to [0, 288.8, 1000, 522.3].
    // Without this assertion all the other tests still pass on a broken map.
    const [, , vw, vh] = geo.viewBox
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.bbox[2], `${slug} spans the full viewBox width — rings not rewound?`)
        .toBeLessThan(vw * 0.75)
      expect(p.bbox[3], `${slug} spans the full viewBox height — rings not rewound?`)
        .toBeLessThan(vh * 0.75)
    }
  })

  it('places every state inside the viewBox', () => {
    const [, , vw, vh] = geo.viewBox
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.bbox[0], `${slug} starts left of the viewBox`).toBeGreaterThanOrEqual(-1)
      expect(p.bbox[1], `${slug} starts above the viewBox`).toBeGreaterThanOrEqual(-1)
      expect(p.bbox[0] + p.bbox[2], `${slug} runs off the right`).toBeLessThanOrEqual(vw + 1)
      expect(p.bbox[1] + p.bbox[3], `${slug} runs off the bottom`).toBeLessThanOrEqual(vh + 1)
    }
  })

  // The depiction gate in build-map.mjs only fires when someone regenerates
  // this file, and it was silently inert at one point during the build. This
  // asserts the property of the map that is actually committed and shipped.
  //
  // Rendering the official Survey of India depiction is a legal requirement
  // for a map published in India. The official rendering reaches 37.07N at
  // the tip of Gilgit-Baltistan; the de-facto rendering stops at 35.5N.
  it('ships the official Survey of India depiction, which reaches ~37.07N', () => {
    expect(geo.northernBound, 'geo.json records no northernBound — regenerate it')
      .toBeTypeOf('number')
    expect(geo.northernBound,
      `northern bound is ${geo.northernBound}N; a value near 35.5 means the de-facto depiction`)
      .toBeGreaterThanOrEqual(36.5)
  })

  it('credits DataMeet, as CC BY 4.0 requires', () => {
    expect(geo.attribution).toContain('DataMeet')
    expect(geo.attribution).toContain('CC BY 4.0')
  })
})

// Task 5: the map should be beautiful where it's not showing the Andamans or
// Lakshadweep. Two layers of defect, two fixes.
//
// Layer 1 was the build: one global `-simplify visvalingam percentage=2%
// keep-shapes` ran over all 36 features in lon/lat space. `keep-shapes`
// protects a FEATURE from vanishing, not its rings, so the single area
// threshold sized to look right on Rajasthan treated an atoll's entire
// coastline as noise. Measured before this fix: Lakshadweep shipped 4 rings /
// 12 points of a real 35 islands / ~1,720 points; Andaman & Nicobar shipped
// 52 rings / 727 points of a real 220 islands / ~109,500 points.
const BASELINE = {
  lakshadweep: { rings: 4, points: 12 },
  'andaman-nicobar': { rings: 52, points: 727 },
}

const ringsOf = (d) => d.split('M').filter((s) => s.trim())
const pointsOf = (d) => (d.match(/,/g) ?? []).length
const numbersOf = (chunk) => chunk.match(/-?\d+(?:\.\d+)?/g).map(Number)
const bboxOfRing = (chunk) => {
  const n = numbersOf(chunk)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (n[i] < x0) x0 = n[i]
    if (n[i] > x1) x1 = n[i]
    if (n[i + 1] < y0) y0 = n[i + 1]
    if (n[i + 1] > y1) y1 = n[i + 1]
  }
  return [x1 - x0, y1 - y0]
}

describe('5a: the island territories survive simplification', () => {
  for (const [slug, before] of Object.entries(BASELINE)) {
    it(`keeps dramatically more of ${slug} than the old global threshold did`, () => {
      const rings = ringsOf(geo.places[slug].d)
      expect(rings.length, `${slug} ring count`).toBeGreaterThan(before.rings)
      expect(pointsOf(geo.places[slug].d), `${slug} point count`).toBeGreaterThan(before.points)
    })
  }

  // A screen-space error tolerance can still collapse a ring that is smaller
  // than the tolerance itself down to two colinear anchor points — a
  // zero-area line, worse than the "three-point triangle" this task exists to
  // fix. This is what a point-count floor per ring guards against, and it is
  // also the geometric precondition the width-4 minimum-dimension stroke
  // (5b) depends on: a stroke can widen a real shape, but it cannot paint one
  // that has been simplified out of existence.
  it('never simplifies a ring down to a degenerate line — every kept ring has real area', () => {
    for (const slug of Object.keys(BASELINE)) {
      for (const chunk of ringsOf(geo.places[slug].d)) {
        const [w, h] = bboxOfRing(chunk)
        expect(w, `${slug} has a zero-width ring`).toBeGreaterThan(0)
        expect(h, `${slug} has a zero-height ring`).toBeGreaterThan(0)
      }
    }
  })
})

describe('5b: data-islands is derived from the data, not a hand-copied list', () => {
  const markup = baseMarkup(geo.places)
  const tags = markup.match(/<path[^>]*\/>/g) ?? []
  const withIslands = tags
    .filter((t) => / data-islands(?:[= ]|\/>)/.test(t))
    .map((t) => t.match(/data-slug="([^"]+)"/)[1])
    .sort()

  it('is present on exactly the places with no neighbours', () => {
    const expected = Object.entries(geo.places)
      .filter(([, p]) => p.neighbours.length === 0)
      .map(([slug]) => slug)
      .sort()
    // Sanity check on today's data: if this ever changes, the test below is
    // still correct (it re-derives `expected` from the data every run), but
    // a silent change here is worth knowing about.
    expect(expected).toEqual(['andaman-nicobar', 'lakshadweep'])
    expect(withIslands).toEqual(expected)
  })
})

describe('5b: the minimum-dimension stroke for island territories', () => {
  const css = readFileSync('src/map/map.css', 'utf8')

  it('strokes [data-islands] paths in --land (not --land-edge) at width 4', () => {
    const rule = css.match(/\.map \.base path\[data-islands\]\s*\{([^}]*)\}/)
    expect(rule, 'no CSS rule for .map .base path[data-islands]').not.toBeNull()
    expect(rule[1]).toMatch(/stroke:\s*var\(--land\)\s*;/)
    expect(rule[1]).not.toMatch(/--land-edge/)
    expect(rule[1]).toMatch(/stroke-width:\s*4\s*;/)
  })

  it('has .lit variants so a lit island territory changes colour, not just its interior', () => {
    // Without this, a lit Andaman would show a saffron fill inside a beige
    // (--land) 4px ring — the opposite of "changes colour".
    expect(css).toMatch(/\.map \.base path\[data-islands\]\.lit\s*\{[^}]*stroke:\s*var\(--lit-state\)/)
    expect(css)
      .toMatch(/\.map \.base path\[data-islands\]\.lit\[data-type=['"]ut['"]\]\s*\{[^}]*stroke:\s*var\(--lit-ut\)/)
  })
})

// jsdom does no layout and no hit testing — it cannot rasterise an SVG at
// all — so this is the one test in the suite that drives a real browser. It
// replaces the measurement in the brief: deleting Lakshadweep from the data
// used to change exactly 13 pixels at 1024x768, none reaching even half the
// land colour. After 5a+5b it must be a real, visible landmass.
describe('a real render, not a jsdom assertion: with vs. without Lakshadweep', () => {
  const CHROME = process.env.CHROME ?? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => { try { readFileSync(p); return true } catch { return false } })

  // "Half the land colour" only means something once you know how far apart
  // land and paper actually are. Both are light, low-contrast pastels — land
  // #d9cfae vs. paper #fdf8ef is at most 65 apart on any channel (blue), not
  // 255 — so the threshold is derived from the real values in the stylesheets
  // rather than guessed.
  const hex = (css, varName) => {
    const m = new RegExp(`${varName}:\\s*#([0-9a-f]{6})`, 'i').exec(css)
    if (!m) throw new Error(`${varName} not found`)
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const baseCss = readFileSync('src/styles/base.css', 'utf8')
  const mapCss = readFileSync('src/map/map.css', 'utf8')
  const land = hex(mapCss, '--land')
  const paper = hex(baseCss, '--paper')
  const maxChannelDelta = Math.max(...land.map((c, i) => Math.abs(c - paper[i])))
  const HALF_LAND_COLOUR = maxChannelDelta / 2

  // Three Chrome spawns in sequence (two screenshots, one diff), each with
  // its own process start-up cost — comfortably past vitest's 5s default.
  //
  // 120s, not 20s. 20s passed on a developer machine and TIMED OUT IN CI at
  // 21,788ms, failing the Pages deploy for a build whose map was correct.
  // A shared runner is slower and contended, and this test pays three cold
  // Chrome start-ups before it measures anything. The number has to clear
  // the worst runner we ever get, not the laptop it was written on: a false
  // red here blocks a deploy, and a build gate that cries wolf is one people
  // learn to re-run rather than read.
  it.skipIf(!CHROME)('differ by far more than the old 13-pixel baseline', () => {
    const hit = JSON.parse(readFileSync('src/data/hit.json', 'utf8'))
    const fill = '\n  html, body { width: 100%; height: 100%; }' // mirrors probe-camera.mjs

    const withHits = { ...hit.places }
    const withoutGeo = { ...geo, places: { ...geo.places } }
    delete withoutGeo.places.lakshadweep
    const withoutHits = { ...hit.places }
    delete withoutHits.lakshadweep

    mkdirSync('build', { recursive: true })
    writeFileSync('build/pixel-test-with.html',
      mapPage({ geo, hits: withHits, script: '', style: fill }))
    writeFileSync('build/pixel-test-without.html',
      mapPage({ geo: withoutGeo, hits: withoutHits, script: '', style: fill }))

    const shoot = (name) => execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=1024,768', '--virtual-time-budget=10000',
      `--screenshot=${process.cwd()}/build/pixel-test-${name}.png`,
      `file://${process.cwd()}/build/pixel-test-${name}.html`,
    ], { stdio: 'ignore' })
    shoot('with')
    shoot('without')

    // The diff itself also runs in the browser: comparing decoded PNG pixel
    // data needs a decoder, and Chrome already has one via <img> + canvas.
    writeFileSync('build/pixel-test-diff.html', `<!doctype html><body>
<canvas id="a" width="1024" height="768"></canvas>
<canvas id="b" width="1024" height="768"></canvas>
<pre id="out"></pre>
<script>
const HALF_LAND_COLOUR = ${HALF_LAND_COLOUR}
const load = (src) => new Promise((res, rej) => {
  const img = new Image()
  img.onload = () => res(img)
  img.onerror = rej
  img.src = src
})
Promise.all([load('pixel-test-with.png'), load('pixel-test-without.png')]).then(([a, b]) => {
  const ca = document.getElementById('a').getContext('2d')
  const cb = document.getElementById('b').getContext('2d')
  ca.drawImage(a, 0, 0)
  cb.drawImage(b, 0, 0)
  const da = ca.getImageData(0, 0, 1024, 768).data
  const db = cb.getImageData(0, 0, 1024, 768).data
  let anyDiff = 0, fullyPainted = 0
  for (let i = 0; i < da.length; i += 4) {
    const max = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
    if (max > 0) anyDiff++
    if (max >= HALF_LAND_COLOUR) fullyPainted++
  }
  document.getElementById('out').textContent = JSON.stringify({ anyDiff, fullyPainted })
}).catch((e) => { document.getElementById('out').textContent = JSON.stringify({ error: String(e) }) })
</script></body>`)

    const dump = execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
      '--virtual-time-budget=10000', '--dump-dom',
      `file://${process.cwd()}/build/pixel-test-diff.html`,
    ], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString()

    const raw = /<pre id="out">(.*?)<\/pre>/s.exec(dump)
    expect(raw, 'the diff page produced no output — open build/pixel-test-diff.html to see why').not.toBeNull()
    const unescaped = raw[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const result = JSON.parse(unescaped)
    expect(result.error, `diff page threw: ${result.error}`).toBeUndefined()

    // eslint-disable-next-line no-console
    console.log(`Lakshadweep pixel diff at 1024x768: ${result.anyDiff} pixels differ at all, ` +
      `${result.fullyPainted} reach at least half the land colour (>=${HALF_LAND_COLOUR} on a channel). ` +
      `Old baseline: 13 pixels differing at all, max 1/255, 0 reaching half the land colour.`)
    expect(result.fullyPainted).toBeGreaterThan(200)
  }, 120000)
})
