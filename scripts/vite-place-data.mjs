/**
 * ONE PLACE, ONE CHUNK — split at build time, from files nobody has to change.
 *
 * THE PROBLEM. Everything the app knew used to arrive in one 1.5 MB script,
 * parsed before the start gate could draw: every place's authored page
 * (`content/places/*.json`), every one of the ~400 narration clips with their
 * word timings (`src/data/timings.json`, 375 KB on its own) and every
 * photograph credit (`src/data/photo-credits.json`, 189 KB). A child on the
 * map needs none of the 36 places until he taps one, and then needs exactly
 * one. The design spec names the fix for an old iPad in so many words
 * (§11, "Site too heavy for an old iPad": "lazy per-state loading"), and the
 * old header of `src/content/places.ts` said to revisit its eager glob at 36
 * files. There are 36.
 *
 * WHY A PLUGIN AND NOT A SECOND SET OF FILES. `timings.json` and
 * `photo-credits.json` are generator OUTPUT (`scripts/tts.mjs`,
 * `scripts/fetch-photos.mjs`) and a dozen scripts and tests read them whole:
 * `place-strip`, `tour-strip`, `shot`, `validate-content`, `words.test`,
 * `fetch-sounds.test`, the contact sheets. Splitting them on disk would mean
 * teaching every one of those readers a new shape, or keeping two copies in
 * step by hand — and this project has been bitten by hand-kept copies more
 * than once (`ART_VERBS`; the `SUBJECTS` coverage check exists because of
 * it). So the files stay exactly as they are, and the split happens in the
 * one place that already reads everything at once: the bundler.
 *
 * WHAT IT PROVIDES — three virtual modules, nothing written to disk:
 *
 *   virtual:place-data          the index: every written place's slug and
 *                               name (`WRITTEN`, a few hundred bytes), and
 *                               `LOADERS`, a Map from slug to a STATIC
 *                               `() => import('virtual:place-data/<slug>')`.
 *                               Static strings are what let the bundler see
 *                               36 separate dynamic imports and cut 36 chunks.
 *
 *   virtual:place-data/<slug>   one place: `{ place, clips, photos }` — its
 *                               authored page, its own clips (every
 *                               `<slug>.*` key in timings.json) and the
 *                               photo credits its page shows (its five
 *                               landmarks, keyed by landmark id, plus its
 *                               animal, keyed by SPECIES — see
 *                               `PlaceScreen.tsx`'s `pagesFor` for why a
 *                               species and not a place).
 *
 *   virtual:shared-clips        every clip NO place owns — today the tour's
 *                               beats (`tour.*`) and the interface lines
 *                               (`ui.*`). Defined as "not a place's" rather
 *                               than as "tour or ui" on purpose: a clip a
 *                               future generator adds under some third
 *                               prefix lands here, in the main bundle, and
 *                               keeps working — it can never silently fall
 *                               out of the app between the two halves.
 *
 * `src/content/places.ts` and `src/content/clips.ts` are the only readers;
 * `src/content/virtual.d.ts` is what TypeScript is told about them.
 *
 * WHY `JSON.parse` OF A STRING AND NOT AN OBJECT LITERAL. For the same old
 * iPad: a JSON string is scanned by a far simpler grammar than a JavaScript
 * object literal, and V8's and JavaScriptCore's own guidance is that
 * `JSON.parse('…')` beats the equivalent literal for anything over ~10 KB.
 * Vite's own JSON plugin makes the same choice for the same reason.
 *
 * IT WORKS THE SAME UNDER `vite build`, `vite dev` AND VITEST, because all
 * three run this file's `resolveId`/`load` — Vitest reads `plugins` from
 * `vite.config.ts` like everything else. Nothing here depends on which.
 *
 * NO NETWORK, EVER. Every byte is read from the repository at build time and
 * served from the site's own origin as an ordinary chunk; the privacy rule
 * (spec §12, "no runtime network requests" beyond our own files) is
 * untouched.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const INDEX_ID = 'virtual:place-data'
export const SHARED_ID = 'virtual:shared-clips'
const PLACE_PREFIX = `${INDEX_ID}/`
/** Rollup's convention for "a module no other plugin should try to read
 *  from disk": a leading NUL byte on the resolved id. */
const NUL = '\0'

const PLACES_DIR = 'content/places'
const TIMINGS = 'src/data/timings.json'
const PHOTOS = 'src/data/photo-credits.json'

/**
 * The split itself: pure, no files, no bundler — so the one decision that
 * matters (which clip and which photograph belongs to which place) can be
 * tested directly against the real data, without a build.
 *
 * `places` is keyed by FILENAME slug, exactly as the old eager glob was: the
 * slug is what the URL carries and what `LOADERS` is keyed on, and
 * `validate-content.mjs` already holds every file's own `id` to it.
 *
 * A clip belongs to a place when its key is `<slug>.<anything>`. Every line
 * id a place authors starts with its own slug (`kerala.intro`,
 * `kerala.card.food`, `kerala.backwaters.line`), and a slug can never itself
 * contain a dot, so the text before the FIRST dot names the owner with no
 * ambiguity — `dadra-and-nagar-haveli-and-daman-and-diu.intro` included.
 */
export function splitPlaceData({ places, timings, photos }) {
  const slugs = Object.keys(places).sort()
  const owners = new Set(slugs)
  const clipsOf = Object.fromEntries(slugs.map((s) => [s, {}]))
  const shared = {}
  for (const [id, clip] of Object.entries(timings)) {
    const dot = id.indexOf('.')
    const owner = dot < 0 ? '' : id.slice(0, dot)
    if (owners.has(owner)) clipsOf[owner][id] = clip
    else shared[id] = clip
  }

  const bySlug = {}
  for (const slug of slugs) {
    const place = places[slug]
    // Exactly the keys `PlaceScreen.tsx`'s `pagesFor` looks up, and only the
    // ones that exist: a landmark whose photograph was never fetched has no
    // entry, which that screen already treats as the honest "no picture yet".
    const wanted = [...place.landmarks.map((l) => l.id), place.card.animal.species]
    const own = {}
    for (const key of wanted) if (key in photos) own[key] = photos[key]
    bySlug[slug] = { place, clips: clipsOf[slug], photos: own }
  }

  // Alphabetical by NAME, not slug — the order the "not been here yet" page
  // offers them in, unchanged from the old `WRITTEN`.
  const index = slugs
    .map((id) => ({ id, name: places[id].name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { index, bySlug, shared }
}

/** `JSON.parse("…")` — see the header for why not a literal. */
const parsed = (value) => `JSON.parse(${JSON.stringify(JSON.stringify(value))})`

/** The source of each virtual module, given a split. Exported for the test
 *  that checks the index really does name one static import per place. */
export function moduleSource(id, split) {
  if (id === INDEX_ID) {
    const loaders = Object.keys(split.bySlug)
      .map((slug) => `  [${JSON.stringify(slug)}, () => import(${JSON.stringify(PLACE_PREFIX + slug)})],`)
      .join('\n')
    // A Map, not an object: the slug comes straight off the URL, and
    // `LOADERS['constructor']` on a plain object is a function. The old
    // `BY_SLUG[slug]` lookup had exactly that hole.
    return `export const WRITTEN = ${parsed(split.index)}\nexport const LOADERS = new Map([\n${loaders}\n])\n`
  }
  if (id === SHARED_ID) return `export default ${parsed(split.shared)}\n`
  if (id.startsWith(PLACE_PREFIX)) {
    const slug = id.slice(PLACE_PREFIX.length)
    const one = split.bySlug[slug]
    return one ? `export default ${parsed(one)}\n` : null
  }
  return null
}

/** Read the three sources off disk and split them. */
export function readPlaceData(root = process.cwd()) {
  const dir = resolve(root, PLACES_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  const places = {}
  for (const f of files) places[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  const timings = JSON.parse(readFileSync(resolve(root, TIMINGS), 'utf8'))
  const photos = JSON.parse(readFileSync(resolve(root, PHOTOS), 'utf8'))
  return {
    split: splitPlaceData({ places, timings, photos }),
    sources: [...files.map((f) => join(dir, f)), resolve(root, TIMINGS), resolve(root, PHOTOS)],
  }
}

export default function placeData() {
  let root = process.cwd()
  /**
   * Thirty-eight modules ask for the same split, so it is computed once and
   * reused for as long as none of its sources has changed. Keyed on the
   * sources' own names and modification times rather than on any bundler
   * hook, so the same rule holds in a build, in the dev server and under
   * Vitest without this file having to know which it is in.
   */
  let cached = null
  const current = () => {
    const dir = resolve(root, PLACES_DIR)
    const names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    const key = [...names.map((f) => join(dir, f)), resolve(root, TIMINGS), resolve(root, PHOTOS)]
      .map((f) => `${f}@${statSync(f).mtimeMs}`)
      .join('|')
    if (cached?.key !== key) cached = { key, ...readPlaceData(root) }
    return cached
  }

  return {
    name: 'namaste:place-data',

    configResolved(config) {
      root = config.root
    },

    resolveId(id) {
      if (id === INDEX_ID || id === SHARED_ID || id.startsWith(PLACE_PREFIX)) return NUL + id
      return null
    },

    load(id) {
      if (!id.startsWith(NUL)) return null
      const real = id.slice(NUL.length)
      if (real !== INDEX_ID && real !== SHARED_ID && !real.startsWith(PLACE_PREFIX)) return null
      const { split, sources } = current()
      // Every source is a dependency of every one of these modules: an edit
      // to timings.json changes the shared clips AND a place's clips, and a
      // new content file changes the index. Telling the bundler so is what
      // makes `vite dev` re-serve them, and `vite build --watch` rebuild them.
      for (const file of sources) this.addWatchFile(file)
      const code = moduleSource(real, split)
      if (code === null) this.error(`${real}: no file ${PLACES_DIR}/${real.slice(PLACE_PREFIX.length)}.json`)
      return code
    },

    /**
     * A place ADDED or REMOVED in dev. `addWatchFile` covers an edit to a
     * file that already existed, but a brand-new `content/places/assam.json`
     * was never anybody's dependency — and the old `import.meta.glob` did
     * pick a new file up live, so this keeps that. The index decides which
     * chunks exist at all, so the cheapest correct answer is a full reload.
     */
    configureServer(server) {
      const onListChange = (file) => {
        const rel = relative(root, file).split('\\').join('/')
        if (!rel.startsWith(`${PLACES_DIR}/`) || !rel.endsWith('.json')) return
        for (const id of [INDEX_ID, SHARED_ID]) {
          const mod = server.moduleGraph.getModuleById(NUL + id)
          if (mod) server.moduleGraph.invalidateModule(mod)
        }
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', onListChange)
      server.watcher.on('unlink', onListChange)
    },
  }
}
