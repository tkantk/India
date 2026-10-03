#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  api, vet, vetAnimal, attribution, realWidth, stripQuery, sleep,
  EN, WD, COMMONS, EM_FILTER, UA, indiaLocalityRegex, localityVerdict,
} from './lib/wiki.mjs'
import { attributionFor, licenceOk } from './lib/media-sources.mjs'

const OUT = 'public/photos'
const CREDITS = 'src/data/photo-credits.json'
mkdirSync(OUT, { recursive: true })
mkdirSync('src/data', { recursive: true })

/** Every state/UT name this app itself draws — read off the real, generated
 *  geo.json rather than hand-listed a second time — fed to
 *  `indiaLocalityRegex` (wiki.mjs) as the text-fallback signal for "was this
 *  photo taken in India". See that function's own note on why this is a
 *  fallback and not the primary signal. */
const STATE_NAMES = Object.values(JSON.parse(readFileSync('src/data/geo.json', 'utf8')).places).map((p) => p.name)
const INDIA_RE = indiaLocalityRegex(STATE_NAMES)

/**
 * Landmarks where all three automatic tiers fail or return the wrong thing.
 * Expect five to ten percent of a 180-name list to end up here. Add entries
 * as the contact sheet review surfaces them; never let the script guess.
 */
const OVERRIDES = {
  // 'Mysore Palace': 'File:Mysore Palace WLM 2022 India 14.jpg',
  // The article's lead image and every Commons-search hit for this one are
  // GFDL 1.2, which the licence allowlist deliberately rejects.
  "Humayun's Tomb": "File:Humayun's tomb, Delhi in 2019.jpg",
  // The Munnar article's lead image is the town, not the tea. The narration
  // is entirely about the tea bushes, so the picture has to show them.
  'Munnar': 'File:Munnar Tea Plantations-WUS07352.jpg',
  // Task 4c: the article's lead image is a wide shot of the temple that
  // never shows a wheel, while the line is entirely about the twenty-four
  // carved wheels and the shadow that crosses one of them to tell the time.
  'Konark Sun Temple': 'File:Wheel engraved in the 13th century built Konark Sun Temple in Orissa, India.jpg',
  // The lead image is an empty landscape — neither a tiger nor the fort the
  // line names, and the father's first device-test complaint was literally
  // "the tiger and others are fake". The line's three sentences are about
  // the tiger; Rajasthan's own animal card is a dromedary, not a tiger (see
  // `animals()` below), so this landmark override is still, and permanently,
  // the only real tiger photograph anywhere in the app.
  'Ranthambore National Park': 'File:Bengal tiger in Ranthambore National Park.jpg',
  // ---- The 32-state pass, 2026-09-03 -------------------------------------
  // 24 landmarks and 3 animals the automatic tiers could not place. Every
  // one was picked from `scripts/override-candidates.mjs`, which vets the
  // WHOLE Commons result pool against the real `vet()`/`vetAnimal()` rather
  // than only the top hit the way this script's landmark path does — that
  // asymmetry is why all 24 reported "NO USABLE IMAGE" while passing
  // candidates sat directly behind the one that failed.
  //
  // The picks below are NOT "the first thing that passed". The top-ranked
  // hit was wrong outright in six of them, and the reason is recorded next
  // to each: a search engine ranks on words, and the words are frequently
  // attached to the wrong object.

  // The top hits were satellite frames (SentinelHub, NASA) and an 1885
  // survey plate; the line is about an island volcano still erupting.
  'Barren Island volcano Andaman': "File:Barren Island Active Volcano.jpg",
  // Top hit was "Manasa Teertham Waterfalls NEAR Talakona" — a different
  // waterfall, named as such.
  'Talakona Waterfall Andhra Pradesh': "File:Talakona waterfall view 01.jpg",
  'Ziro Valley Arunachal Pradesh': "File:Ziro valley of Aruncahl in summer season.jpg",
  // The only dolphin in the pool; the runner-up was a duck (a red-crested
  // pochard photographed in the same sanctuary).
  'Ganges river dolphin Bihar': "File:Gangetic Dolphin.jpg",
  'Sukhna Lake Chandigarh': "File:Sukhna Lake Chandigarh Evening.jpg",
  'Diu Fort cannons': "File:Diu Fort Fixed Cannons.JPG",
  // The line is about stone steps built "in a great curve... like the seats
  // in a theatre", so the masonry of the kund itself, not the modern
  // Surajkund Fair the top two hits show.
  'Surajkund Faridabad reservoir': "File:Suraj Kund Masonary 032.jpg",
  // The line is about an extinct volcano standing alone out of flat fields;
  // the crater is the part that says "volcano", not the hilltop hall the
  // top hit shows.
  'Dhosi Hill Haryana': "File:A view of Dhosi Hill Crater.JPG",
  // The line counts "nearly a thousand bridges" and describes one built in
  // five layers of stone arches, so a bridge — the top hit was the station
  // building at Shimla.
  'Kalka Shimla Railway arch gallery bridge': "File:Kalka–Shimla railway bridge 2019-10-18 10.09.13.jpg",
  'Great Himalayan National Park Kullu': "File:Great Himalayan National Park, Kullu, Himachal.jpg",
  'Indira Gandhi Memorial Tulip Garden Srinagar': "File:Indira Gandhi Memorial Tulip Garden, Srinagar.jpg",
  // The line is entirely about the hangul DEER ("These deer are called
  // hangul... a stag can carry antlers with sixteen points"). Searching the
  // park's name returned six landscapes, a poppy and a captive black bear
  // and not one hangul; searching the animal found this. Same lesson as
  // Konark's missing wheel — the picture has to show what the words say.
  'hangul Kashmir stag Dachigam National Park': "File:The Last Surviving Population of Hangul.jpg",
  // The line is entirely about the palace lit up at night — "a hundred
  // thousand little bulbs... every arch, every dome". The first pick was a
  // daylight photo with not one bulb lit: Konark's failure exactly.
  'Mysore Palace': "File:Mysuru Palace - Night View.jpg",
  // The first pool ranked a British, a Nepali, a Balinese and a Malawian
  // dancer above any Ladakhi one. The Lamayuru photo picked from it was the
  // right dance but showed the dancers small and from BEHIND — and the line
  // is about "enormous painted masks... great staring eyes". Replaced in the
  // 2026-10 review with a close-up of one mask, at Diskit, in Ladakh.
  'Hemis masked cham dance Ladakh': "File:A monk during the Chaam dance at the Diskit Monastery in the Nubra Valley.jpg",
  // Every located candidate was Hawaii, Moorea or an albino in captivity.
  // This one makes no false location claim and matches the line exactly:
  // the turtle "goes down into the shallow water to eat the grass growing
  // on the bottom".
  'green sea turtle Lakshadweep': "File:Green Sea Turtle grazing seagrass.jpg",
  // Top hits were the DZUKOU lily — a different species, in Nagaland.
  'Lilium mackliniae Shirui lily': "File:Siroy Lily at Siroy National Park, Manipur.jpg",
  // The rest of the pool was six birds photographed in the park.
  'Phawngpui Blue Mountain Mizoram': "File:Phawngpui national park.jpg",
  'Langar Golden Temple Amritsar': "File:Langar , participatory community kitchen , Golden Temple ,Amritsar 01.jpg",
  // Names Sikkim, which the line does; the pool also held one explicitly
  // captioned "Captured at the Himalayan Zoological Park, Sikkim".
  'Red panda Sikkim forest': "File:Red panda sikkim.jpg",
  "Krishna's Butterball Mahabalipuram": "File:Krishna's Butterball at Mahabalipuram heritage complex 03.jpg",
  // The 2024 pick had a waving man and a garland filling a third of the
  // frame; the line is about rails running "two kilometres over open sea".
  'New Pamban Bridge': "File:Pamban Bridge Train Passing.jpg",
  'Kuntala Waterfall Telangana': "File:Kuntala waterfall 4.jpg",
  'Dumboor Lake Tripura': "File:In the middle of the Deep Dumboor Lake.jpg",
  // Top hit was the Imambara inside the RESIDENCY — a different building in
  // the same city.
  'Bara Imambara Lucknow': "File:View of Bara Imambara, Lucknow.jpg",

  // ---- Animals ----------------------------------------------------------
  // These three replace photographs that were already fetched and were
  // WRONG, not merely missing — see `docs/handover.md` for the full account.
  // The automatic pick was a blackbuck photographed in Bardiya, NEPAL,
  // waved through because its geotag falls inside `INDIA_BBOX`'s rectangle
  // while its only Commons category said "Antilope cervicapra in Nepal".
  // `localityVerdict` now refutes on that text; this is the photograph the
  // fixed check prefers, from Tal Chhapar Sanctuary in Rajasthan.
  'Blackbuck': "File:Blackbuck in Tal Chhapar Sanctuary November 2025 by Tisha Mukherjee 11.jpg",
  // Nagaland's gayal (mithun) and Goa's gaur were first given the IDENTICAL
  // file, captioned as a gaur. The replacement chosen for it — by title —
  // turned out, once looked at, to be a patched black-and-orange animal in a
  // village yard, while the line says "a huge black cattle beast with white
  // legs, like socks". This one is exactly that, at a forest edge, in India.
  'Gayal': "File:Mithun, Glao Lake.jpg",
  // The automatic pick was "Idu Mishmi MAN on track from Anini" — a
  // photograph of a person, matched on the word "Mishmi".
  'Mishmi takin': "File:Budorcas taxicolor taxicolor 354708274.jpg",

  // TWO WRONG PICTURES IN A ROW, and the second was this project's own.
  // The automatic pick was a TAXIDERMIED sangai in a New York museum (vet()
  // now rejects mounted specimens). The override that replaced it, a Loktak
  // Lake photo chosen from its title, turned out — once someone actually
  // looked at it — to show open water and a solid wooded hill: no floating
  // mat at all, which is the whole of the line. This one is the park's own,
  // and shows the phumdis floating on the water.
  'Keibul Lamjao National Park': "File:THE FLOATING NATIONAL PARK- The Keibul Lamjao National Park, Manipur.jpg",

  // Not a failure but a COLLISION: this tile and `lakshadweep.from-space`
  // were handed the identical NASA MODIS satellite frame, so one place
  // showed the same picture on two of its own shelf tiles. The satellite
  // image genuinely belongs to "An Atoll from Space"; this tile's line is
  // about standing at the reef and watching the waves break in a white
  // line, which is a photograph taken from the island, not from orbit.
  'Minicoy Island lagoon Lakshadweep': "File:Minicoy Island, Lakshadweep.jpg",

  // ---- The second review, 2026-10-02 -------------------------------------
  // Every one of the 210 photographs was looked at beside the exact words
  // spoken over it — the check no metadata gate can make. 138 matched, 55
  // were weak and 17 showed something other than what the child hears
  // (two of them signboards, one a man holding a clouded leopard's PELT).
  // Each replacement below was then chosen by eye from thumbnails, not
  // from a title. The old photo's failure is recorded so nobody puts it
  // back.
  // arunachal-pradesh.sela-pass: was a dry road and a truck; the line is snow and a wall of mountains.
  'Sela Pass Arunachal Pradesh': "File:The lake at Sela pass.jpg",
  // chandigarh.rock-garden: was a stone SIGNBOARD; the line is figures made of broken bangles.
  'Rock Garden of Chandigarh sculptures': "File:Rock Garden Chandigarh India (6).JPG",
  // chhattisgarh.kotumsar-cave: was a concrete gate and two men; the line is stone icicles inside.
  'Kotumsar Cave': "File:Kanger valley8.JPG",
  // gujarat.wild-asses: was a roadside SIGNBOARD with painted donkeys on it.
  'Indian wild ass Little Rann of Kutch': "File:Asiatic Wild Ass herd.jpg",
  // karnataka.bandipur: was a tiger; the line is wild elephants walking across the road.
  'Bandipur National Park': "File:Lokesh L (5 of 25).jpg",
  // ladakh.thiksey: was an indoor statue; the line is white buildings climbing a hill.
  'Thiksey Monastery Ladakh': "File:Beautiful Thiksey Monestry-Ladakh-DSC 0353.jpg",
  // maharashtra.kaas-plateau: was a yellow meadow; the line (since corrected) named purple and pink.
  'Kaas Plateau flowers': "File:Kaas world Heritage.jpg",
  // manipur.kangla: was a garden of trees; the line is the two dragon-lion Kanglasha.
  'Kangla Fort Imphal': "File:Kanglasha at Kangla.jpg",
  // gujarat.modhera-temple: was the hall; the line is the stepped tank in front of it.
  'Sun Temple Modhera': "File:Surya Kund, Modhera Sun Temple.jpg",
  // manipur.loktak: showed a solid hill; the line is floating islands and fishing rings.
  'Loktak Lake Manipur': "File:The Phumdis on Loktak Lake.jpg",
  // nagaland.doyang: was ONE falcon; the line is a million of them filling the sky.
  'Amur falcon Doyang Nagaland': "File:Amur Falcon Roost (30699712390).jpg",
  // madhya-pradesh.marble-rocks: showed low rocks; the line is marble cliffs on both sides of a boat.
  'Marble Rocks Bhedaghat': "File:Marble rocks alongside Narmada River.jpg",
  // jammu-kashmir.dal-lake: was one empty boat; the line opens on houseboats tied in rows.
  'Dal Lake houseboats Srinagar': "File:Dal Lake in the heart of Srinagar.jpg",
  // jammu-kashmir.gulmarg-gondola: showed wires and a pylon; the line is a little cabin on a wire.
  'Gulmarg Gondola cable car': "File:Gulmarg Gondola Kashmir 2.jpg",
  // tripura.neermahal: was a minaret close-up; the line is a palace with water on every side.
  'Neermahal Rudrasagar Tripura': "File:Neermahal, Tripura Agartala, India.jpg",
  // tripura.ujjayanta: cropped the tower off; the line is three big domes.
  'Ujjayanta Palace Agartala': "File:Ujjayanta Palace as seen from the midpoint of the avenue 02.JPG",
  // telangana.golconda-fort: was a wall detail; the line is the fort climbing its hill.
  'Golconda Fort Hyderabad': "File:Golconda Fort 005.jpg",
  // andhra-pradesh.gandikota: was hazy and grey, with a burned-in date stamp; the line is red rock.
  'Gandikota gorge Andhra Pradesh': "File:Gandikota- The Grand Canyon of India.jpg",
  // asian-koel: was the all-black MALE, which looks like the crow the line is about.
  'Asian koel': "File:Asian Koel Female AMSM9066AKOE.jpg",
  // indian-roller: had its wings shut; the line builds to the blue flash of them opening.
  'Indian roller': "File:Coracias benghalensis -India -flying-8.jpg",
  // haryana.sultanpur-nilgai: was a brown hornless female; the line is the blue-grey male.
  'nilgai Sultanpur National Park Haryana': "File:Blue Bull (Nilgai) (4570527773).jpg",
  // karnataka.bird-islands: was one pelican; the line is trees loaded with nesting birds.
  'Ranganathittu Bird Sanctuary': "File:Asian Openbill Stork Community (13517651813).jpg",
  // west-bengal.great-banyan: was a distant canopy; the line is roots coming down like trunks.
  'The Great Banyan Howrah': "File:India - Kolkata - 09 - Great Banyan Tree (2799531046).jpg",
  // uttar-pradesh.chambal-gharials: showed no ghara, the pot-shaped lump the animal is named after.
  'gharial National Chambal Sanctuary': "File:Gharial (Gavialis gangeticus) male.jpg",
  // goa.fort-aguada: showed no lighthouse; the line ends on the fort having one of its own.
  'Fort Aguada': "File:Fort-Aguada-Lighthouse.jpg",
  // gujarat.white-rann: read as grey cracked mud; the line is a white salt floor.
  'Great Rann of Kutch': "File:White salt desert at Rann of Kutch.jpg",
  // punjab.mustard-fields: was mostly green; the line is whole fields turning bright yellow.
  'mustard field Punjab India': "File:Golden mustard fields.jpg",
  // meghalaya.dawki: was side-on; the line is a boat seeming to hang in the air over its stones.
  'Umngot River Dawki': "File:The Clear water of Dawki (Unsplash).jpg",
  // manipur.ima-keithel: was two shrine deities; the line is a market of 5,000 stalls run by women.
  'Ima Keithel Imphal': "File:Ima Market, imphal.jpeg",
  // sikkim.rumtek: was a SIGNBOARD reading the monastery's name.
  'Rumtek Monastery Sikkim': "File:Rumtek Monastery 04.jpg",
  // west-bengal.toy-train: was a diesel engine; the line opens "a steam engine still pulls".
  'Darjeeling Himalayan Railway': "File:Toy Train Darjeeling West Bengal India.jpg",
  // bihar.mahabodhi: was a small votive stupa; the line is the tall tower of niches.
  'Mahabodhi Temple Bodh Gaya': "File:Mahabodhi temple complex, Bodhgaya 24.jpg",
  // dadra-and-nagar-haveli-and-daman-and-diu.panikotha: was a mosaic kiosk on the shore; the line is a fort alone in the water.
  'Panikotha Fortim do Mar Diu': "File:Pani Kotha.JPG",
  // flying-fish: was a DEAD fish hung on a string in a market, in front of
  // painted phone numbers. This one is alive, gliding, with its splash trail.
  'Flying fish': "File:Pink-wing flying fish.jpg",
}

/**
 * Species this project SEARCHED FOR AND COULD NOT HONESTLY ILLUSTRATE.
 *
 * Not the same thing as a missing override, and that is the whole reason
 * this table exists separately: a name in `OVERRIDES` says "the automatic
 * tiers picked wrong, here is the right file", while a name here says "every
 * candidate Commons has is wrong, and the correct answer is NO PHOTOGRAPH."
 * Without this, each run re-picks the least-bad wrong file and silently
 * ships it — the sangai case below did exactly that, twice, arriving at a
 * REPLICA on the first pass and a photograph of a FESTIVAL on the second.
 *
 * `PlaceScreen.tsx`'s `photo` field is explicitly allowed to be undefined
 * and renders nothing at all in that case, deliberately, rather than a
 * stand-in shape. So an entry here is a supported, honest end state, not a
 * hole — and it is strictly better than the alternative, because this
 * project's very first device-test complaint was "the images are fake".
 *
 * Each of these was searched repeatedly, by species name, by binomial, and
 * by locality, via `scripts/override-candidates.mjs`. Re-check them if
 * Commons gains new uploads; none is a permanent ruling.
 */
const NO_PHOTOGRAPH = {
  // Every free candidate is a captive bird at the Sarahan Pheasantry (a
  // breeding centre in Himachal), a 1915 book plate, an Indian postage
  // stamp under the non-allowlisted GODL licence, or the seventeenth-century
  // Mughal painting that this project actually shipped before the
  // living-animal check existed.
  'Western tragopan': 'every free candidate is captive, a book plate, a stamp, or a painting',
  // The markhor barely survives in India at all (a small population in
  // Jammu & Kashmir), and Commons has it only from Augsburg Zoo, Berlin
  // Tierpark, Padmaja Naidu Zoological Park and 1904 hunting books.
  'Markhor': 'every free candidate is a zoo animal or a 1904 hunting-book plate',
  // The sangai lives only in Keibul Lamjao. Commons offers a replica, a
  // Meitei illustration, a 240px thumbnail, a deer at Disney's Animal
  // Kingdom, and photographs of the Sangai FESTIVAL — a cultural event that
  // shares the animal's name and outranks it in every search.
  'Sangai': 'candidates are a replica, an illustration, a zoo animal, or the Sangai Festival',
  // Meghalaya's card shipped, until the 2026-10 review, a photograph of a
  // young man holding up a clouded leopard's SKINNED PELT. Every free
  // alternative is another pelt, a stamp, an animal photographed outside
  // India, or the Sunda clouded leopard of Borneo — a different species.
  'Clouded leopard': 'every free candidate is a pelt, a stamp, outside India, or the Bornean species',
}

/**
 * PHOTOGRAPHS CHOSEN BY A PERSON FROM OUTSIDE COMMONS, keyed by photo id
 * (an animal's `species`, a landmark's `id`). The sound pipeline's
 * `scripts/sound-picks.json`, for photographs: each pick is a candidate
 * object from `scripts/lib/media-sources.mjs` (today iNaturalist, which the
 * owner's October 2026 non-commercial decision opened up), chosen by eye on
 * a review page and approved by the owner, and it wins over every Commons
 * tier and over NO_PHOTOGRAPH. NO_PHOTOGRAPH's reasons stay true of Commons;
 * a pick is simply a better source than Commons had.
 *
 * Stored byte for byte as iNaturalist served its "large" size — no resize,
 * no crop — so the credits page's "unaltered" stays true.
 */
const PHOTO_PICKS_FILE = 'scripts/photo-picks.json'
const PHOTO_PICKS = existsSync(PHOTO_PICKS_FILE) ? JSON.parse(readFileSync(PHOTO_PICKS_FILE, 'utf8')).picks ?? {} : {}

function landmarks() {
  const out = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    for (const lm of JSON.parse(readFileSync(join('content/places', f), 'utf8')).landmarks) {
      out.push({ id: lm.id, name: lm.name, query: lm.photoQuery, kind: 'landmark' })
    }
  }
  return out
}

/** Turns a `species` token ("asian-elephant") into the query a photo search
 *  actually needs ("Asian elephant") — the same sentence-case convention
 *  Wikipedia itself titles a species article with (hyphens to spaces,
 *  ONLY the first word capitalised: "Asian elephant", never "Asian
 *  Elephant"). Derived, not a hand-maintained map, so a 33rd species added
 *  by a later task gets a correct query for free rather than needing an
 *  entry here. */
function speciesQuery(species) {
  const [first, ...rest] = species.split('-')
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(' ')
}

/**
 * One entry per DISTINCT species named across every place's `card.animal`,
 * never one per place. Keyed on `species` — deliberately the same key
 * `PlaceScreen.tsx`'s `pagesFor` reads (`PHOTOS[place.card.animal.species]`)
 * — because a photograph of a dromedary is a photograph of a dromedary
 * regardless of which state is telling the story: two places that ever
 * shared a species should share the one fetch, not pay for it twice. Today
 * all four seed places name different species, so this dedupe is not yet
 * doing observable work, but it is the correct shape for the ~32-place
 * pipeline this was built to prove, where a shared species (two states both
 * naming, say, the peacock) is genuinely expected.
 */
function animals() {
  const seen = new Set()
  const out = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    const species = JSON.parse(readFileSync(join('content/places', f), 'utf8')).card.animal.species
    if (seen.has(species)) continue
    seen.add(species)
    out.push({ id: species, name: species, query: speciesQuery(species), kind: 'animal' })
  }
  return out
}

/** Tier 1: the article's curated lead image. Batches 50 titles per request. */
async function leadImages(queries) {
  const found = new Map()
  for (let i = 0; i < queries.length; i += 50) {
    const batch = queries.slice(i, i + 50)
    const j = await api(EN, {
      action: 'query', redirects: '1', titles: batch.join('|'),
      prop: 'pageimages|pageprops', piprop: 'original|name', pilimit: '50', ppprop: 'disambiguation',
    })
    const q = j.query ?? {}
    const hop = new Map([...(q.normalized ?? []), ...(q.redirects ?? [])].map(r => [r.from, r.to]))
    const resolve = t => { const seen = new Set(); while (hop.has(t) && !seen.has(t)) { seen.add(t); t = hop.get(t) } return t }
    const byTitle = new Map((q.pages ?? []).map(p => [p.title, p]))
    for (const name of batch) {
      const p = byTitle.get(resolve(name))
      if (p?.pageimage && !(p.pageprops && 'disambiguation' in p.pageprops)) {
        found.set(name, { file: 'File:' + p.pageimage, source: 'pageimages' })
      }
    }
    await sleep(300)
  }
  return found
}

/** Tier 2: Wikidata P18, "image of this thing". */
async function wikidataP18(name) {
  const j = await api(WD, { action: 'wbgetentities', sites: 'enwiki', titles: name, props: 'claims', languages: 'en' })
  for (const e of Object.values(j.entities ?? {})) {
    const f = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    if (f) return { file: 'File:' + f, source: 'wikidata-P18' }
  }
  return null
}

/** Tier 3: Commons search. Noisy. Results arrive unordered; index is the
 *  rank. Returns up to `limit` results, not only the best guess — an animal
 *  candidate needs a POOL to prefer an India-located one from; a landmark
 *  (via `commonsSearch` below) has only ever needed the single best guess. */
async function commonsSearchMany(name, limit = 10) {
  const j = await api(COMMONS, {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
    gsrsearch: `filetype:bitmap ${name}`, prop: 'imageinfo', iiprop: 'url|size|mime',
  })
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index)
  return pages.map((p) => ({ file: p.title, source: 'commons-search' }))
}

async function commonsSearch(name) {
  return (await commonsSearchMany(name, 10))[0] ?? null
}

/** Licence and thumbnail, asked of en.wikipedia because it transparently
 *  resolves Commons files and returns full extmetadata from one host.
 *  Also asks for `categories`, but that turns out to be close to useless:
 *  MEASURED directly (Task 5a), en.wikipedia's own `categories` prop on a
 *  Commons-hosted file returns EN.WIKIPEDIA'S OWN wrapper categories
 *  ("Featured pictures", "Wikipedia Picture of the day files"), never
 *  Commons' real ones ("Elephas maximus in the Bandipur National Park").
 *  Kept anyway because `isZooPhoto` still checks whatever is here and an
 *  empty array is harmless, not wrong — `attachLocality` below is what
 *  fetches the categories (and coordinates) that actually carry signal, by
 *  asking Commons directly instead of en.wikipedia's mirror of it. */
async function fileInfo(titles, width = 900) {
  const out = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const j = await api(EN, {
      action: 'query', titles: titles.slice(i, i + 50).join('|'),
      prop: 'imageinfo|categories', iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(width), iiextmetadatafilter: EM_FILTER,
      cllimit: 'max', clshow: '!hidden',
    })
    for (const p of j.query?.pages ?? []) {
      // en.wikipedia sets missing:true for Commons files with no local
      // description page, yet still returns full imageinfo. Filtering on
      // p.missing silently discards perfectly good files.
      if (!p.imageinfo?.[0]) continue
      out.set(p.title, {
        ...p.imageinfo[0], imagerepository: p.imagerepository, fileTitle: p.title,
        categories: (p.categories ?? []).map(c => c.title),
      })
    }
    await sleep(300)
  }
  return out
}

/**
 * Overwrites each candidate's `categories` with Commons' own real ones (see
 * `fileInfo`'s note on why en.wikipedia's copy is not usable) and adds
 * `coordinates` when Commons has a geotag. Mutates the `infos` map in place
 * rather than returning a new one: the caller already has a reference to
 * every entry it cares about.
 *
 * WAS animal-only, and is not any more. The locality verdict this feeds is
 * still animal-only — a fort has no "wrong continent" failure — but
 * `vet()`'s own taxidermy check reads `categories` too, and for a LANDMARK
 * those were previously en.wikipedia's useless wrapper categories, so the
 * check could not fire. That gap shipped a stuffed sangai from the American
 * Museum of Natural History as Manipur's national park: the signal that
 * would have caught it (`Category:Taxidermied Rucervus eldii`) exists only
 * on Commons, and nothing was asking Commons for a landmark.
 */
async function attachCommonsMeta(infos, titles) {
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const j = await api(COMMONS, {
      action: 'query', titles: batch.join('|'),
      prop: 'categories|coordinates', cllimit: 'max', clshow: '!hidden',
    })
    for (const p of j.query?.pages ?? []) {
      const ii = infos.get(p.title)
      if (!ii) continue
      ii.categories = (p.categories ?? []).map((c) => c.title)
      ii.coordinates = p.coordinates?.[0]
    }
    await sleep(300)
  }
}

// Landmarks and animals share every step below — the query tiers, the
// licence gate, the download, the credit shape — and differ only in which
// vet() an animal's own extra "not a zoo" check runs under. See `animals()`
// for why this is species-keyed rather than place-keyed.
const list = [...landmarks(), ...animals()]
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const todo = list.filter(l => !credits[l.id] || !existsSync(join(OUT, `${l.id}.jpg`)))
console.log(`${list.length} photographs wanted (${list.filter(l => l.kind === 'animal').length} animals), ${todo.length} still to fetch`)

const leads = await leadImages(todo.map(l => l.query))
const failures = []

for (const lm of todo) {
  const pick = PHOTO_PICKS[lm.id]
  if (pick) {
    const lic = licenceOk(pick)
    if (!lic.ok) { failures.push(lm); console.log(`  ${lm.id}: PICK REJECTED — licence ${pick.licence}`); continue }
    const res = await fetch(pick.download, { headers: { 'User-Agent': UA } })
    if (!res.ok) { failures.push(lm); console.log(`  ${lm.id}: pick download HTTP ${res.status}`); continue }
    const bytes = Buffer.from(await res.arrayBuffer())
    writeFileSync(join(OUT, `${lm.id}.jpg`), bytes)
    credits[lm.id] = {
      file: `photos/${lm.id}.jpg`,
      width: pick.width ?? null,
      fileTitle: pick.title,
      ...attributionFor(pick),
      ...(lm.kind === 'animal' ? { locality: 'confirmed' } : {}),
    }
    console.log(`  ${lm.id}: ${credits[lm.id].licenceShort} — ${pick.source}:${pick.ref} (picked)`)
    await sleep(1000)
    continue
  }
  if (NO_PHOTOGRAPH[lm.query]) {
    // Deliberately absent, not failed — see NO_PHOTOGRAPH's own note. This
    // is NOT pushed onto `failures`, because failures are things a human
    // still has to resolve, and this one already was resolved: the answer
    // is no photograph.
    console.log(`  ${lm.id}: no photograph on purpose — ${NO_PHOTOGRAPH[lm.query]}`)
    continue
  }
  const isAnimal = lm.kind === 'animal'
  const candidates = []
  if (OVERRIDES[lm.query]) candidates.push({ file: OVERRIDES[lm.query], source: 'override' })
  // Animal-only, extra tier: an India-biased Commons search, tried ahead of
  // the country-agnostic tiers below. This is what actually gives the
  // locality preference below a real POOL to choose from — the plain lead
  // image and Wikidata P18 tiers each return exactly one photograph (the
  // article's own, usually the same one both ways), so without this there
  // is nothing to prefer AMONG.
  if (isAnimal) candidates.push(...await commonsSearchMany(`${lm.query} India`, 8))
  const lead = leads.get(lm.query); if (lead) candidates.push(lead)
  const wd = await wikidataP18(lm.query); if (wd) candidates.push(wd)
  const cs = await commonsSearch(lm.query); if (cs) candidates.push(cs)

  const infos = await fileInfo([...new Set(candidates.map(c => c.file))])
  // Every candidate, not only an animal's — see `attachCommonsMeta`'s note.
  await attachCommonsMeta(infos, [...new Set(candidates.map(c => c.file))])

  const vetFn = isAnimal ? vetAnimal : vet
  const passing = []
  for (const c of candidates) {
    const ii = infos.get(c.file.replace(/_/g, ' '))
    if (!ii) continue
    const v = vetFn(ii)
    if (!v.ok) { console.log(`    reject ${c.file} (${c.source}): ${v.why}`); continue }
    passing.push({ ii, source: c.source })
  }

  // An override always wins outright when it passes — a human already made
  // this call, and a locality heuristic (below) must never second-guess it.
  let chosen = passing.find((p) => p.source === 'override') ?? null
  // "confirmed" | "unconfirmed" | null (not an animal, no locality question
  // to ask at all). Tri-state per `localityVerdict`'s own reasoning: "not
  // established" is real information, not a rounding-down to "no".
  let locality = null
  if (!chosen && isAnimal) {
    chosen = passing.find((p) => localityVerdict(p.ii, INDIA_RE) === true) ?? null
    if (chosen) locality = 'confirmed'
  }
  if (!chosen) {
    chosen = passing[0] ?? null
    if (chosen && isAnimal) {
      const v = localityVerdict(chosen.ii, INDIA_RE)
      locality = v === false ? 'confirmed-elsewhere' : 'unconfirmed'
    }
  }

  if (!chosen) {
    failures.push(lm)
    console.log(`  ${lm.id}: NO USABLE IMAGE, add to OVERRIDES`)
    await sleep(1000)
    continue
  }

  const url = stripQuery(chosen.ii.thumburl ?? chosen.ii.url)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) { failures.push(lm); console.log(`  ${lm.id}: download HTTP ${res.status}`); continue }
  writeFileSync(join(OUT, `${lm.id}.jpg`), Buffer.from(await res.arrayBuffer()))

  credits[lm.id] = {
    file: `photos/${lm.id}.jpg`,
    width: realWidth(url) ?? chosen.ii.width,
    source: chosen.source,
    fileTitle: chosen.ii.fileTitle,
    ...attribution(chosen.ii),
    // Only ever set for an animal — see `locality`'s own note above. Read
    // by `scripts/contact-sheet-animals.mjs` so a photograph whose location
    // could not be confirmed is flagged to the human reviewer instead of
    // passing silently, per Task 5a's own review comment.
    ...(locality ? { locality } : {}),
  }
  const localityNote = locality ? ` — locality ${locality}` : ''
  console.log(`  ${lm.id}: ${chosen.source}, ${credits[lm.id].licenceShort}${localityNote}`)
  await sleep(1000)
}

writeFileSync(CREDITS, JSON.stringify(credits, null, 2))
console.log(`\n${Object.keys(credits).length} photographs with credits`)
if (failures.length) {
  console.log(`${failures.length} need a hand-picked override:`)
  for (const f of failures) console.log(`  '${f.query}': 'File:...',`)
  process.exitCode = 1
}
