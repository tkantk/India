#!/usr/bin/env node
/**
 * The Task 5a contact sheet: one page, the four animal photographs, each
 * with its species, which place(s) it illustrates, its source tier and its
 * licence — exactly what Task 5's own brief asks a human to check ("is that
 * actually the thing in the picture"), in one image a father can look at in
 * a minute rather than four separate files.
 *
 * Deliberately its own script, not a filtered view of `contact-sheet.mjs`
 * (the 20-landmark review sheet): the species list is derived from
 * `content/places/*.json` — the same source `fetch-photos.mjs`'s own
 * `animals()` reads — never from guessing which of `photo-credits.json`'s
 * keys "look like" a species. Landmark ids always carry a place prefix and a
 * dot ("delhi.india-gate"); species ids never do — see `content/schema.ts`'s
 * `SPECIES_RE` — but that is a fact worth stating, not a pattern worth
 * matching against by hand.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CREDITS = 'src/data/photo-credits.json'
const PLACES_DIR = 'content/places'

function loadCredits() {
  try {
    return JSON.parse(readFileSync(CREDITS, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`${CREDITS} does not exist yet. Run "npm run fetch:photos" first.`)
      process.exit(1)
    }
    throw err
  }
}

/** Every distinct species named by a place's `card.animal`, and which
 *  place(s) name it — the reverse of `fetch-photos.mjs`'s own `animals()`,
 *  built the same way (derived from content, never hand-listed) so a 33rd
 *  place with a new species appears here with no second edit. */
function speciesToPlaces() {
  const map = new Map()
  for (const f of readdirSync(PLACES_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const place = JSON.parse(readFileSync(join(PLACES_DIR, f), 'utf8'))
    const species = place.card.animal.species
    if (!map.has(species)) map.set(species, [])
    map.get(species).push(place.name)
  }
  return map
}

/**
 * ONE HONEST SENTENCE PER PHOTOGRAPH, hand-written after actually looking at
 * the downloaded file — the check `isZooPhoto` cannot do and Task 5's own
 * brief says only a human can ("is that actually the thing in the
 * picture"). Not derived from anything; if a photograph is ever replaced
 * (an override, a re-fetch), this note goes stale and must be rewritten by
 * hand at the same time — there is no way to make "does this picture still
 * show what I said it shows" a machine check.
 */
const REVIEWED = {
  'dromedary': 'A saddled, decorated dromedary sitting in open sand, geotagged and categorised "Camels in Rajasthan" / "Thar Desert (Rajasthan)" — the right species (one-humped Camelus dromedarius, not the two-humped Bactrian a bare "camel" search returns) AND the right state: this is a working desert camel of the exact Thar the card\'s own line names, not merely "somewhere in India".',
  'asian-elephant': 'A herd of Asian elephants, adults and calves, walking out of forest cover at Manas National Park, Assam — genuinely wild (no restraint, no fence), the right genus (Elephas maximus, not the bigger-eared African Loxodonta) and confirmed India by its own Commons categories ("Elephants in Assam"). A first pick here was a real bug: a "Sri Lankan elephant" file, geotagged in Sri Lanka, slipped past an early, too-generous coordinate box before the fix below caught it — see wiki.mjs\'s own SRI_LANKA_BBOX comment.',
  'indian-roller': 'An Indian roller perched on a branch, geotagged in Madhya Pradesh — its real blue-and-cinnamon plumage plainly visible, exactly the bird the card\'s own line names, and confirmed India by real coordinates, not merely a title guess.',
  'house-sparrow': 'A house sparrow (duller, streak-brown plumage — a female or juvenile, not the grey-capped black-bibbed male) on a stone, geotagged in Saswad, Maharashtra — the right species (Passer domesticus is the same bird in Delhi and Maharashtra alike) and, unlike the very first candidate fetched (a real sparrow, but in Brooklyn, New York), genuinely photographed in India.',
}

const credits = loadCredits()
const bySpecies = speciesToPlaces()
mkdirSync('review', { recursive: true })

/** Badge text and class for the `locality` field `fetch-photos.mjs` writes
 *  onto every animal credit — never silent, per Task 5a's own review
 *  comment ("say so per photograph in the contact sheet rather than passing
 *  it silently"). A photograph with no `locality` field at all (impossible
 *  for a real animal entry today, but not for a stale/hand-edited one) reads
 *  as unconfirmed rather than throwing. */
const LOCALITY_LABEL = {
  'confirmed': ['locality-ok', 'location confirmed India (coordinates or category)'],
  'confirmed-elsewhere': ['locality-bad', 'LOCATION CONFIRMED OUTSIDE INDIA — human review needed'],
  'unconfirmed': ['locality-unknown', 'location NOT established — could not confirm India or elsewhere'],
}

const cards = [...bySpecies.entries()].map(([species, places]) => {
  const c = credits[species]
  if (!c) return `<figure class="missing"><figcaption><b>${species}</b><br>NOT FETCHED — run npm run fetch:photos</figcaption></figure>`
  const [cls, label] = LOCALITY_LABEL[c.locality] ?? LOCALITY_LABEL.unconfirmed
  return `
  <figure>
    <img src="../public/${c.file}" loading="lazy" alt="">
    <figcaption>
      <b>${species}</b> — ${places.join(', ')}<br>
      <span class="lic">${c.licenceShort}</span> &middot; ${c.source} &middot; ${c.artist}<br>
      <a href="${c.descriptionUrl}" target="_blank" rel="noopener">on Commons</a>
      <p class="locality ${cls}">${label}</p>
      <p class="note">${REVIEWED[species] ?? '(not yet reviewed by a human)'}</p>
    </figcaption>
  </figure>`
}).join('')

writeFileSync('review/animals.html', `<!doctype html>
<meta charset="utf-8"><title>Animal photo review — Task 5a</title>
<style>
  body { font: 15px system-ui; margin: 2rem; background: #faf8f4; max-width: 1100px }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.4rem }
  figure { margin: 0; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px #0002 }
  figure.missing { padding: 1rem; color: #a00 }
  img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: #eee }
  figcaption { padding: .7rem .8rem; line-height: 1.5 }
  .lic { color: #666 }
  .locality { margin: .5rem 0 0; font-weight: 600; font-size: 13px }
  .locality-ok { color: #1a7a3c }
  .locality-bad { color: #b3261e }
  .locality-unknown { color: #9a6b00 }
  .note { margin: .5rem 0 0; font-style: italic; color: #333 }
</style>
<h1>Animal photo review — Task 5a</h1>
<p>${bySpecies.size} species, queried precisely (never the card's own common
word — "camel" returns a two-humped Bactrian) and checked against the same
licence allowlist as every other photograph, plus two extra checks unique to
an animal: the title and Commons categories must not name a zoo, enclosure
or other captive setting, and — added after this task's own first pass
fetched a real dromedary in Egypt and a real house sparrow in Brooklyn —
Commons' own coordinates or categories are checked to PREFER a candidate
genuinely located in India over one that is not, or one that cannot be
placed at all. Neither check can see the picture itself — only a human can
say whether a photograph is honestly what it claims. The italicised line
under each one is that human check, done once, by hand; the coloured line
above it is what the machine could establish about WHERE it was taken,
never left silent.</p>
<div class="grid">${cards}</div>`)

console.log('open review/animals.html')
