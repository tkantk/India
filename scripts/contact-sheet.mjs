#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const CREDITS = 'src/data/photo-credits.json'

/** Fail with an actionable message rather than an unhandled ENOENT/SyntaxError
 *  stack trace: this file does not exist until `npm run fetch:photos` has
 *  been run at least once, which needs seeded content in content/places. */
function loadCredits() {
  let raw
  try {
    raw = readFileSync(CREDITS, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(
        `${CREDITS} does not exist yet.\n` +
        `Run "npm run fetch:photos" first (it needs content/places/*.json to ` +
        `exist — see Task 9) to generate it, then re-run this script.`,
      )
      process.exit(1)
    }
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`${CREDITS} is not valid JSON: ${err.message}`)
    process.exit(1)
  }
}

const credits = loadCredits()
mkdirSync('review', { recursive: true })

const cards = Object.entries(credits).map(([id, c]) => `
  <figure>
    <img src="../public/${c.file}" loading="lazy" alt="">
    <figcaption>
      <b>${id}</b><br>
      <span class="lic">${c.licenceShort}</span> &middot; ${c.source}<br>
      <a href="${c.descriptionUrl}" target="_blank" rel="noopener">on Commons</a>
    </figcaption>
  </figure>`).join('')

writeFileSync('review/photos.html', `<!doctype html>
<meta charset="utf-8"><title>Photo review</title>
<style>
  body { font: 14px system-ui; margin: 2rem; background: #faf8f4 }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.2rem }
  figure { margin: 0; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px #0002 }
  img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: #eee }
  figcaption { padding: .6rem .7rem; line-height: 1.5 }
  .lic { color: #666 }
</style>
<h1>Photo review: ${Object.keys(credits).length} landmarks</h1>
<p>Check every picture actually shows the place it is labelled with. An ISS
photograph of Earth passes every automated check.</p>
<div class="grid">${cards}</div>`)

console.log('open review/photos.html')
