import { CUE_VERBS } from '../../content/schema.ts'

/** Character offsets of each whitespace-delimited word in the ORIGINAL string.
 *  Offsets matter because the speech provider aligns by character. */
export function wordSpans(text) {
  const spans = []
  const re = /\S+/g
  let m
  while ((m = re.exec(text)) !== null) {
    spans.push({ word: m[0], start: m.index, end: m.index + m[0].length })
  }
  return spans
}

/**
 * Fold ElevenLabs' per-character alignment into per-word timings.
 * A word starts when its first character starts and ends when its last ends.
 */
export function timingsFromAlignment(text, alignment) {
  const { characters, character_start_times_seconds: cs, character_end_times_seconds: ce } = alignment
  const joined = characters.join('')
  if (joined !== text) {
    throw new Error(
      `alignment does not match the submitted text.\n  sent: ${JSON.stringify(text)}\n  ` +
      `back: ${JSON.stringify(joined)}\n  ` +
      `This usually means markup was included; content must contain none.`,
    )
  }
  const spans = wordSpans(text)
  return {
    words: spans.map(s => s.word),
    starts: spans.map(s => round(cs[s.start])),
    ends: spans.map(s => round(ce[s.end - 1])),
  }
}

/**
 * Draft-voice fallback: no alignment is available, so spread the measured
 * duration across words by character count, giving punctuation extra weight
 * so the highlight does not run ahead during a pause.
 */
export function estimateTimings(text, duration) {
  const spans = wordSpans(text)
  if (spans.length === 0) return { words: [], starts: [], ends: [] }

  const weights = spans.map(s => {
    let w = s.word.length + 1
    if (/[,;:]$/.test(s.word)) w += 2
    if (/[.!?]$/.test(s.word)) w += 5
    return w
  })
  const total = weights.reduce((a, b) => a + b, 0)

  const starts = [], ends = []
  let t = 0
  for (const w of weights) {
    const dt = (w / total) * duration
    starts.push(round(t))
    t += dt
    ends.push(round(t))
  }
  ends[ends.length - 1] = round(duration)
  return { words: spans.map(s => s.word), starts, ends }
}

/** Verbs that put a picture on stage and so need their own lifetime.
 *
 *  zoomTo belongs here even though it looks like pure camera work: it also
 *  raises the "look down" ring at the end of the flight (Here.tsx), and that
 *  ring's lifetime is exactly what this hold times.
 *
 *  Exported so a test can assert coverage against `CUE_VERBS` directly,
 *  rather than trusting this list by eye. */
export const ART_VERBS = new Set([
  'revealSymbol', 'showScript', 'countTo', 'unfurlFlag',
  'traceRiver', 'raiseMountains', 'zoomTo',
])

/** Every verb the content uses that is camera or map work, not art, and so
 *  gets no hold at all. Named explicitly, rather than "everything CUE_VERBS
 *  has that ART_VERBS does not", so the classification below can catch a
 *  verb that belongs to NEITHER set — the case an implicit complement can't
 *  detect. Exported for the same reason as `ART_VERBS`. */
export const NON_ART_VERBS = new Set([
  'playSfx', 'highlightState', 'highlightAllStates',
  'highlightUnionTerritories', 'lightNeighbour',
])

/**
 * Where `art`/`nonArt` disagree with `cueVerbs`: a verb in `cueVerbs` that
 * neither set claims (`missing`), or a verb either set claims that `cueVerbs`
 * no longer declares (`stale`). Pulled out of `checkVerbCoverage` as a pure
 * function — no throwing, no module-load side effect — purely so a test can
 * feed it a deliberately broken input and watch it report the drift, rather
 * than only ever being able to exercise it via the real files agreeing.
 */
export function verbCoverageIssues(cueVerbs, art, nonArt) {
  const known = new Set([...art, ...nonArt])
  const missing = cueVerbs.filter((v) => !known.has(v))
  const stale = [...known].filter((v) => !cueVerbs.includes(v))
  return { missing, stale }
}

/**
 * `content/schema.ts`'s `CUE_VERBS` is the one authoritative list of verbs
 * content is allowed to author. `ART_VERBS`/`NON_ART_VERBS` above are a
 * hand-maintained classification of it, and hand-maintained is exactly how
 * this drifts: add a 13th verb to the schema for the next plan's 32 state
 * screens, forget to classify it here, and `cueTimes` silently hands it no
 * `hold` — the effect falls back to its constant and the tiger bug is back,
 * with nothing in the test suite able to catch it (an untested verb passes
 * every existing assertion by simply doing nothing).
 *
 * So this throws, at import time, the moment the two disagree in either
 * direction — a verb in the schema this file has never heard of, or a verb
 * classified here that the schema no longer declares. Loud and immediate
 * beats silent and eventual: a broken build is a build someone notices.
 */
function checkVerbCoverage() {
  const { missing, stale } = verbCoverageIssues(CUE_VERBS, ART_VERBS, NON_ART_VERBS)
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      'words.mjs\'s ART_VERBS/NON_ART_VERBS have drifted from content/schema.ts\'s CUE_VERBS.' +
      (missing.length > 0 ? ` Not classified here: ${missing.join(', ')}.` : '') +
      (stale.length > 0 ? ` No longer a real verb: ${stale.join(', ')}.` : '') +
      ' Classify the new verb as art or non-art in scripts/lib/words.mjs before content can use it.',
    )
  }
}
checkVerbCoverage()

/** The three seas are one accumulating picture, the same way the three
 *  greetings are (see `groupOf` below): a second sea cue adds to the first
 *  rather than replacing it, so the first must not be truncated by it.
 *
 *  Hand-copied rather than imported from `Sea.tsx`'s `WATERS` — that file is
 *  real JSX and this one is a plain script `scripts/tts.mjs` runs under
 *  bare `node`, with no bundler to transform it. `words.test.mjs` imports
 *  `WATERS` directly and asserts the two lists agree, so a fourth sea added
 *  to the art without a matching update here fails the suite rather than
 *  silently sharing a slot while this file truncates its siblings. */
export const ACCUMULATING_SEAS = new Set(['arabian-sea', 'bay-of-bengal', 'indian-ocean'])

const MIN_HOLD_MS = 1000

/** Uncapped art is a picture of the sentence's subject, and the subject is
 *  what the sentence is about — every art verb but one is left alone.
 *  `countTo` is the exception: `GrandTour.tsx`'s whole-map highlight
 *  (`HIGHLIGHT_MS`) is built on the assumption that the counter's hold is
 *  this short, and left uncapped the derived counter holds run 13-15s,
 *  which would leave all 28 states (or all 8 union territories) lit for
 *  practically the whole beat. */
const HOLD_CAP_MS = { countTo: 5000 }

/**
 * Which accumulating picture, if any, a cue belongs to.
 *
 * Two cues in the same group must not truncate each other — the later one
 * is adding to the picture, not replacing it. Every other cue is its own
 * group of one, keyed by its position, so that even a verb that repeats
 * (tour.09's three separate `revealSymbol` cards) is still truncated by
 * whichever art cue comes after it.
 */
function groupOf(cue, index) {
  if (cue.do === 'showScript') return 'showScript'
  if (cue.do === 'revealSymbol' && ACCUMULATING_SEAS.has(cue.arg)) return 'seas'
  return `solo:${index}`
}

/**
 * Resolve authored word-index cues into playback times.
 *
 * This is the join that lets the site be built against a free draft voice and
 * then re-rendered with the paid one: the content only ever says "at word 14",
 * and the times are recomputed from whatever timings the current voice produced.
 *
 * With a third argument — the clip's own duration — every art cue also gets
 * a `hold`: how long its picture stays on screen, in milliseconds, derived
 * from when the *next independent* art cue fires (or the clip's end, if
 * none does) rather than a hardcoded per-verb guess. Omit `duration` and no
 * cue gets a `hold` at all: that is the built-time-only draft-voice pipeline
 * and the single-effect tests, where every effect falls back to its own
 * constant.
 *
 * A fourth argument — the line's own `invite` (`content/schema.ts`), if it
 * has one — extends the LAST independent art cue's hold past the clip's own
 * end by `invite.min` seconds. Without this, the picture a child is invited
 * to keep looking at while they trace disappears the instant the narration
 * does — Plan 4 Task 3's own bug, in the art rather than the sequencer: an
 * outline that vanishes under a still-tracing finger is the same "no time to
 * finish" defect wearing a different costume. Every other art cue, on every
 * other line, is unaffected: `invite` only ever reaches here from a line
 * that actually authored one.
 */
export function cueTimes(cues, timings, duration, invite) {
  const resolved = (cues ?? [])
    .map(c => {
      if (c.word >= timings.starts.length) {
        throw new Error(`cue word index ${c.word} is out of range (${timings.starts.length} words)`)
      }
      return { ...c, t: timings.starts[c.word] }
    })
    .sort((a, b) => a.t - b.t)

  if (duration === undefined) return resolved

  const art = resolved
    .map((cue, i) => ({ cue, i, group: groupOf(cue, i) }))
    .filter((e) => ART_VERBS.has(e.cue.do))

  return resolved.map((cue, i) => {
    if (!ART_VERBS.has(cue.do)) return cue
    const group = groupOf(cue, i)
    // The next art cue that is NOT part of this one's accumulating group —
    // an accumulating member is skipped over, exactly as if it were not
    // independent art at all.
    const next = art.find((e) => e.i > i && e.group !== group)
    // No next independent art cue: this picture would otherwise run only to
    // the clip's own end. A line with an authored invite gets `invite.min`
    // seconds more than that — the floor of the wait the sequencer holds the
    // beat open for (GrandTour.tsx) — so the art a child is invited to keep
    // looking at is still there for at least as long as the tour guarantees
    // to wait for them.
    const end = next ? Math.min(next.cue.t, duration) : (invite ? duration + invite.min : duration)
    const cap = HOLD_CAP_MS[cue.do] ?? Infinity
    const hold = Math.round(Math.min(Math.max((end - cue.t) * 1000, MIN_HOLD_MS), cap))
    return { ...cue, hold }
  })
}

const round = n => Math.round(n * 1000) / 1000
