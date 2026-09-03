#!/usr/bin/env node
/**
 * SAY THE NAME FIRST. A landmark's narration opens straight into description
 * — tap Konark and the voice says "The whole temple is carved to look like a
 * giant chariot", never "This is the Konark Sun Temple". A child who taps a
 * tile is told about a thing he was never told the name of. Measured: 125 of
 * the 180 landmark lines never name their landmark in the opening sentence,
 * while every place INTRO does ("This is Odisha, over on the east side...")
 * and every card names its own subject.
 *
 *   node scripts/name-the-landmarks.mjs            # dry run, prints proposals
 *   node scripts/name-the-landmarks.mjs --write    # edit content/places/*.json
 *
 * TWO THINGS THIS HAS TO GET RIGHT, and the second is the dangerous one:
 *
 * 1. Grammar. "This is" or "These are", and whether the name wants a "the".
 *    Neither is derivable from the name alone with confidence, so the head
 *    noun drives it and the genuinely irregular cases are listed by name
 *    below rather than guessed at.
 *
 * 2. CUES ARE WORD INDICES, NEVER TIMESTAMPS — the one thing docs/handover.md
 *    says not to break. Prepending words to a line shifts every cue in it by
 *    exactly that many words, and a cue left unshifted fires on the wrong
 *    word for the rest of the project's life. 27 landmark lines carry cues.
 *    Every one of them is shifted here, and the shift is asserted to equal
 *    the number of words actually added.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WRITE = process.argv.includes('--write')
const DIR = 'content/places'

/** Words that look plural but name one thing. "Talakona Falls" is a
 *  waterfall, not several; "the Sundarbans" is one forest. */
const SINGULAR_IN_S = new Set(['falls', 'sundarbans', 'nicobars', 'ghats', 'backwaters'])
/** Common nouns that can head a landmark name. Used ONLY to ignore them when
 *  asking "does the line already name this landmark" — never to decide an
 *  article. See `opening` for why the article rule is what it is. */
const COMMON_HEADS = new Set([
  'caves', 'cave', 'temple', 'fort', 'palace', 'bridge', 'railway', 'lake',
  'river', 'valley', 'pass', 'monastery', 'stupa', 'tomb', 'gate', 'museum',
  'sanctuary', 'park', 'garden', 'beach', 'hill', 'hills', 'island', 'islands',
  'falls', 'dam', 'reservoir', 'observatory', 'terminus', 'ghat', 'ghats',
])

const words = (s) => s.trim().split(/\s+/).filter(Boolean)

/** Does the line's first sentence already name the landmark? Same test used
 *  to decide who needs an opening at all. */
function alreadyNames(name, text) {
  const first = text.split(/(?<=\.)\s/)[0] ?? ''
  const distinctive = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !COMMON_HEADS.has(w) && w !== 'the')
  return distinctive.some((w) => first.toLowerCase().includes(w))
}

function opening(name) {
  let rest = name
  let article = ''
  // THE ARTICLE COMES FROM THE NAME ITSELF, never from the head noun. English
  // drops "the" when a proper name modifies a common one — it is "Sukhna
  // Lake", "Radhanagar Beach", "Kaziranga National Park", not "the Sukhna
  // Lake" — so inferring an article from the head noun produced exactly those
  // three errors on the first run. A name that genuinely wants the article
  // already carries it ("The Limestone Caves at Baratang"), so honouring what
  // the content author wrote is both simpler and right.
  if (/^The\s+/i.test(rest)) { rest = rest.replace(/^The\s+/i, ''); article = 'the ' }

  // The head noun is the last word before any "of"/"at" tail: "The Limestone
  // Caves at Baratang" is about CAVES, not about Baratang.
  const head = (rest.split(/\s+(?:of|at|in|on)\s+/i)[0] ?? rest).split(/\s+/).pop().toLowerCase()
  const bare = head.replace(/[^a-z]/g, '')
  // "-ss" is not a plural. "Sela Pass" came back as "These are the Sela Pass"
  // on the first run for exactly this reason.
  const plural = bare.endsWith('s') && !bare.endsWith('ss') && !SINGULAR_IN_S.has(bare)
  return `${plural ? 'These are' : 'This is'} ${article}${rest}.`
}

const proposals = []
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(DIR, file)
  const place = JSON.parse(readFileSync(path, 'utf8'))
  let touched = false
  for (const lm of place.landmarks) {
    if (alreadyNames(lm.name, lm.line.text)) continue
    const open = opening(lm.name)
    const added = words(open).length
    proposals.push({ id: lm.id, name: lm.name, open, added, cues: (lm.line.cues ?? []).length })
    if (!WRITE) continue
    lm.line.text = `${open} ${lm.line.text}`
    // THE CUE SHIFT. Every index moves by exactly the words prepended.
    for (const cue of lm.line.cues ?? []) cue.word += added
    touched = true
  }
  if (WRITE && touched) writeFileSync(path, `${JSON.stringify(place, null, 2)}\n`)
}

const chars = proposals.reduce((n, p) => n + p.open.length + 1, 0)
console.log(`${proposals.length} landmark lines need an opening (${chars} characters added)`) 
console.log(`${proposals.filter((p) => p.cues).length} of them carry cues that must shift\n`)
for (const p of proposals) console.log(`  ${p.id.padEnd(44)} ${p.open}`)
console.log(WRITE ? '\nWRITTEN. Re-run `npm run validate`.' : '\nDry run. Pass --write to apply.')
