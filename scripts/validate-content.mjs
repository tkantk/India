#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PlaceSchema, TourSchema, UiSchema } from '../content/schema.ts'

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

function line(l, where) {
  if (ids.has(l.id)) problems.push(`duplicate line id "${l.id}" in ${where} and ${ids.get(l.id)}`)
  ids.set(l.id, where)
  chars += l.text.length
  if (l.sfx) needSound.set(l.sfx, `${where} (${l.id}.sfx)`)
  for (const c of l.cues ?? []) {
    if (c.do === 'playSfx' && c.arg) needSound.set(c.arg, `${where} (${l.id} cue)`)
    if (PLACE_CUES.has(c.do) && c.arg) needPlace.set(c.arg, `${where} (${l.id} ${c.do} cue)`)
  }
}

function walkPlace(p, where) {
  needSound.set(p.ambience, `${where} (ambience)`)
  needPlace.set(p.id, `${where} (id)`)
  line(p.intro, where)
  for (const l of Object.values(p.card)) line(l, where)
  for (const lm of p.landmarks) line(lm.line, where)
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
