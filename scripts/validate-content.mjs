#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PlaceSchema, TourSchema, UiSchema } from '../content/schema.ts'
import { findMarkup } from './lib/markup.mjs'

const CEILING = 99_100
const TARGET = 95_000
const problems = []
const ids = new Map()
let chars = 0

const needSound = new Map()
const needPlace = new Map()

/** Cue verbs whose `arg` names a place on the map rather than a sound or a
 *  symbol. Each one is a slug that has to exist in src/data/geo.json. */
const PLACE_CUES = new Set(['highlightState', 'zoomTo', 'lightNeighbour'])

// The rest of the cue vocabulary. Left unchecked, every one of these was free
// text: a mistyped symbol simply never appeared on screen and nothing said so.
// content/vocab.json is the declared list, and is also the contract Plan 2's
// illustration kit is built against, which is why it is written down rather
// than inferred from whatever the seed content happens to say today.
const VOCAB_FILE = 'content/vocab.json'
/** cue verb -> the key in vocab.json listing its permitted args. */
const VOCAB_CUES = { revealSymbol: 'revealSymbol', showScript: 'showScript', traceRiver: 'rivers' }
const VOCAB_KEYS = ['revealSymbol', 'showScript', 'rivers', 'scenes']

const vocab = {}
if (!existsSync(VOCAB_FILE)) {
  problems.push(`missing ${VOCAB_FILE} — the cue vocabulary has to be declared, not implied`)
} else {
  const raw = JSON.parse(readFileSync(VOCAB_FILE, 'utf8'))
  for (const k of VOCAB_KEYS) {
    if (!Array.isArray(raw[k]) || raw[k].length === 0) {
      problems.push(`${VOCAB_FILE}: "${k}" must be a non-empty array`)
    }
    vocab[k] = new Set(Array.isArray(raw[k]) ? raw[k] : [])
  }
}

/** Check one arg against a declared list, naming the file it must be added to. */
function fromVocab(key, arg, what, where) {
  if (!vocab[key]?.has(arg)) {
    problems.push(`${where}: ${what} "${arg}" is not in ${VOCAB_FILE} ("${key}") — typo, or add it there`)
  }
}

function line(l, where) {
  if (ids.has(l.id)) problems.push(`duplicate line id "${l.id}" in ${where} and ${ids.get(l.id)}`)
  ids.set(l.id, where)
  chars += l.text.length
  // Cheapest possible place to catch this. The ElevenLabs provider rejects
  // markup too, but only once a paid pass is already in flight — by then some
  // of the corpus has been rendered and billed and the run aborts halfway.
  const tag = findMarkup(l.text)
  if (tag) {
    problems.push(
      `${where}: line "${l.id}" contains markup ${tag} — narration must be plain ` +
      `text, or the provider's character alignment shifts and word highlighting breaks`,
    )
  }
  if (l.sfx) needSound.set(l.sfx, `${where} (${l.id}.sfx)`)
  for (const c of l.cues ?? []) {
    if (c.do === 'playSfx' && c.arg) needSound.set(c.arg, `${where} (${l.id} cue)`)
    if (PLACE_CUES.has(c.do) && c.arg) needPlace.set(c.arg, `${where} (${l.id} ${c.do} cue)`)

    const key = VOCAB_CUES[c.do]
    if (key || c.do === 'countTo') {
      if (!c.arg) {
        problems.push(`${where}: ${l.id} cue "${c.do}" has no arg — it needs one`)
      } else if (key) {
        fromVocab(key, c.arg, `${c.do} arg`, `${where} (${l.id} cue)`)
      } else if (!/^[1-9]\d*$/.test(c.arg)) {
        // countTo has no vocabulary — any positive whole number is a valid
        // thing to count to — but "twenty-eight" is still a bug.
        problems.push(`${where}: ${l.id} countTo arg "${c.arg}" is not a positive whole number`)
      }
    }
  }
}

function walkPlace(p, where) {
  needSound.set(p.ambience, `${where} (ambience)`)
  needPlace.set(p.id, `${where} (id)`)
  line(p.intro, where)
  for (const l of Object.values(p.card)) line(l, where)
  for (const lm of p.landmarks) {
    // The scene key picks the illustration drawn behind the landmark. A typo
    // here leaves a blank panel with no error anywhere.
    fromVocab('scenes', lm.scene, 'scene', `${where} (${lm.id})`)
    line(lm.line, where)
  }
}

const dir = 'content/places'
const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : []
for (const f of files) {
  const where = join(dir, f)
  const parsed = PlaceSchema.safeParse(JSON.parse(readFileSync(where, 'utf8')))
  if (!parsed.success) {
    for (const i of parsed.error.issues) problems.push(`${where}: ${i.path.join('.')} — ${i.message}`)
    continue
  }
  if (parsed.data.id !== f.replace(/\.json$/, '')) {
    problems.push(`${where}: id "${parsed.data.id}" does not match its filename`)
  }
  walkPlace(parsed.data, where)
}

for (const [file, schema, key] of [
  ['content/tour.json', TourSchema, 'beats'],
  ['content/ui.json', UiSchema, 'lines'],
]) {
  if (!existsSync(file)) { problems.push(`missing ${file}`); continue }
  const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) {
    for (const i of parsed.error.issues) problems.push(`${file}: ${i.path.join('.')} — ${i.message}`)
    continue
  }
  for (const l of parsed.data[key]) line(l, file)
}

// Every sound reference is checked against two files, and the difference
// between them matters:
//   content/sounds.json      — the WANTED list. Curated by hand.
//   src/data/sound-credits.json — what has actually been sourced.
// Referencing an id in neither is a TYPO and fails the build. Referencing
// one that is wanted but not yet sourced is a KNOWN GAP: it is reported
// loudly every build but does not fail, because several sounds could not be
// found on Commons and are waiting on a hand-picked replacement. Without
// this split, content could not be authored at all until every last sound
// existed; with it, a mistyped cue is still caught immediately.
const wanted = new Set()
if (existsSync('content/sounds.json')) {
  const w = JSON.parse(readFileSync('content/sounds.json', 'utf8'))
  for (const s of [...(w.sfx ?? []), ...(w.ambience ?? [])]) wanted.add(s.id)
}
const sourced = existsSync('src/data/sound-credits.json')
  ? new Set(Object.keys(JSON.parse(readFileSync('src/data/sound-credits.json', 'utf8'))))
  : new Set()

const gaps = []
for (const [id, where] of needSound) {
  if (sourced.has(id)) continue
  if (wanted.has(id)) gaps.push(`${id} (${where})`)
  else problems.push(`${where}: sound "${id}" is in neither content/sounds.json nor sound-credits.json — typo?`)
}
if (gaps.length) {
  console.log(`\n  ${gaps.length} sound(s) referenced but not yet sourced — these are silent for now:`)
  for (const g of gaps) console.log(`    - ${g}`)
}

// Every place id, and every cue that names a place, must resolve to a slug in
// the generated map. There is no "not yet sourced" tier here as there is for
// sounds: geo.json is generated from the official boundaries and already holds
// all 36 places, so anything that misses is a typo. Left unchecked, a mistyped
// neighbour is silent — lightNeighbour simply lights nothing, and the state it
// was meant to name never glows while the narration says its name.
const geoPath = 'src/data/geo.json'
if (existsSync(geoPath)) {
  const slugs = new Set(Object.keys(JSON.parse(readFileSync(geoPath, 'utf8')).places ?? {}))
  for (const [id, where] of needPlace) {
    if (!slugs.has(id)) problems.push(`${where}: place "${id}" is not a slug in ${geoPath}`)
  }
} else if (needPlace.size) {
  problems.push(`${needPlace.size} place reference(s) but ${geoPath} does not exist — run npm run build:map`)
}

if (chars > CEILING) {
  problems.push(`narration is ${chars} characters, over the ${CEILING} ceiling — trim before rendering`)
}

console.log(`${files.length} places · ${ids.size} lines · ${chars} characters (target ${TARGET}, ceiling ${CEILING})`)
if (chars > TARGET && chars <= CEILING) {
  console.log(`  note: over the ${TARGET} target — re-render headroom is shrinking`)
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log('content OK')
