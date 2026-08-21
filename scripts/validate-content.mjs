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

function line(l, where) {
  if (ids.has(l.id)) problems.push(`duplicate line id "${l.id}" in ${where} and ${ids.get(l.id)}`)
  ids.set(l.id, where)
  chars += l.text.length
  if (l.sfx) needSound.set(l.sfx, `${where} (${l.id}.sfx)`)
  for (const c of l.cues ?? []) {
    if (c.do === 'playSfx' && c.arg) needSound.set(c.arg, `${where} (${l.id} cue)`)
  }
}

function walkPlace(p, where) {
  needSound.set(p.ambience, `${where} (ambience)`)
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

// Every playSfx cue and every place's ambience must resolve to a real file.
// Without this a cue can name a sound that was never found, and the tiger
// simply never growls — silently, with no error anywhere.
const soundsPath = 'src/data/sound-credits.json'
if (existsSync(soundsPath)) {
  const sounds = JSON.parse(readFileSync(soundsPath, 'utf8'))
  for (const [id, where] of needSound) {
    if (!sounds[id]) problems.push(`${where}: sound "${id}" has no file in ${soundsPath}`)
  }
} else if (needSound.size) {
  problems.push(`${needSound.size} sound reference(s) but ${soundsPath} does not exist`)
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
