/**
 * SAYING INDIAN NAMES THE INDIAN WAY.
 *
 * The narrator is already an Indian-English voice ("Tripti", accent: indian),
 * so this is not an accent problem — it is that English orthography misleads
 * any model on specific proper nouns. Malayalam's "zh" is not the "zh" of
 * "measure"; "Chhattisgarh" is not "Chatt-is-gar"; a doubled consonant in a
 * transliterated name is a real length distinction the spelling does not
 * signal to a reader of English.
 *
 * WHAT THIS IS NOT ALLOWED TO DO, and the constraint that shapes everything
 * else: it must not change what the CHILD SEES. `timings.json`'s `words` feed
 * the read-along, one span per word, and `ReadAlong.tsx` prints them. A child
 * learning to read must see "Kozhikode", never "Ko-zhi-kode".
 *
 * So the spelling sent to the provider and the spelling shown on screen are
 * decoupled, and the join between them is the WORD INDEX. That is why every
 * replacement must be exactly one whitespace-free token: word i of the spoken
 * text has to be word i of the displayed text, or the provider's alignment
 * lands the highlight on the wrong word. `respell` enforces that rather than
 * trusting the table, because a single stray space in this file would
 * silently desynchronise a whole line's read-along.
 *
 * The spoken text also feeds the CACHE KEY (see `keysForRun`), which is what
 * makes a change here re-render the lines it affects and nothing else.
 */

/** Split on whitespace, keeping the exact separators so the text can be
 *  rebuilt byte-for-byte apart from the words themselves. */
function tokenise(text) {
  return text.split(/(\s+)/)
}

/**
 * Strip the punctuation around a word so "Kozhikode." and "Kozhikode," both
 * match the table's bare "Kozhikode", and hand back the pieces so they can
 * be put back exactly as they were.
 */
function peel(token) {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(token)
  return m ? { lead: m[1], core: m[2], tail: m[3] } : { lead: '', core: token, tail: '' }
}

/**
 * Apply the table to one line. Returns the text to SPEAK; the caller keeps
 * the original for display.
 *
 * Matching is case-insensitive but case-preserving in the sense that the
 * table's own spelling is used verbatim — these are proper nouns, and the
 * respelling is chosen for how it sounds, not how it looks.
 */
export function respell(text, table) {
  if (!table) return text
  let hits = 0
  const out = tokenise(text).map((token) => {
    if (/^\s+$/.test(token) || token === '') return token
    const { lead, core, tail } = peel(token)
    const to = table[core] ?? table[core.toLowerCase()]
    if (to === undefined) return token
    if (/\s/.test(to)) {
      throw new Error(
        `pronounce.json: "${core}" -> "${to}" contains whitespace. A replacement must be ` +
        `exactly one word: the read-along joins spoken and displayed text by WORD INDEX, ` +
        `so splitting one word into two silently shifts every later word's highlight.`,
      )
    }
    hits++
    return `${lead}${to}${tail}`
  }).join('')
  if (hits === 0) return text
  // Belt and braces: the whole design rests on this being true, and it costs
  // one split to prove it per line rather than assume it.
  const before = text.trim().split(/\s+/).length
  const after = out.trim().split(/\s+/).length
  if (before !== after) {
    throw new Error(`respell changed the word count (${before} -> ${after}) for: ${text.slice(0, 60)}...`)
  }
  return out
}
