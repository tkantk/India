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

/**
 * Resolve authored word-index cues into playback times.
 *
 * This is the join that lets the site be built against a free draft voice and
 * then re-rendered with the paid one: the content only ever says "at word 14",
 * and the times are recomputed from whatever timings the current voice produced.
 */
export function cueTimes(cues, timings) {
  return (cues ?? [])
    .map(c => {
      if (c.word >= timings.starts.length) {
        throw new Error(`cue word index ${c.word} is out of range (${timings.starts.length} words)`)
      }
      return { ...c, t: timings.starts[c.word] }
    })
    .sort((a, b) => a.t - b.t)
}

const round = n => Math.round(n * 1000) / 1000
