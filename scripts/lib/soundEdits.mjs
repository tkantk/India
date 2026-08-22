/**
 * What the sound pipeline actually DOES to a Commons recording, in one place.
 *
 * WHY THIS FILE EXISTS. Seven of the eleven bundled sounds are CC BY-SA 3.0
 * or 4.0. The pipeline does not merely re-container them: `trim.py` truncates
 * a one-shot to its cap, peak-normalises it and fades it out; `loop.py`
 * truncates a bed, loudness-normalises it and welds a seamless loop out of
 * it. Those are edits to the CONTENT, not changes of format, so what ships is
 * Adapted Material under CC BY-SA 4.0 s2(a)(4) — which means the adapted file
 * must itself be offered under the same licence, and s3(a)(1)(B) obliges us
 * to indicate that we modified the material.
 *
 * "Indicate" is a sentence somebody has to write, and a human will not
 * remember to rewrite it six months after retuning a fade. So the sentence is
 * DERIVED, here, from the very numbers `fetch-sounds.mjs` hands to the two
 * Python scripts, and recorded into `sound-credits.json` as `modifications`.
 * The credits page renders that field; nobody has to remember anything.
 *
 * THE DSP CONSTANTS ARE MIRRORED from `scripts/lib/trim.py` and
 * `scripts/lib/loop.py`, which Node cannot import. `soundEdits.test.mjs`
 * reads both `.py` files and fails if either side drifts — the same trick
 * `src/tour/effects/art/palette.ts` uses against `base.css`.
 */

/** `trim.py`, plus the cap `fetch-sounds.mjs` passes it for a one-shot. */
export const TRIM = {
  /** trim.py: PEAK_CEILING_DBFS */
  peakCeilingDbfs: -1,
  /** trim.py: FADE_SECONDS */
  fadeSeconds: 0.15,
  /** `content/sounds.json` may override per sound with `maxSeconds`. */
  defaultMaxSeconds: 3,
}

/** `loop.py`, plus the length and crossfade `fetch-sounds.mjs` passes it. */
export const LOOP = {
  /** loop.py: TARGET_RMS_DBFS */
  targetRmsDbfs: -26,
  /** loop.py: PEAK_CEILING_DBFS */
  peakCeilingDbfs: -3,
  /** An argument to loop.py, not a constant inside it — so this IS the
   *  source of truth, and fetch-sounds.mjs reads it from here. */
  crossfadeSeconds: 3,
  /** `content/sounds.json` may override per bed with `seconds`. */
  defaultSeconds: 20,
}

/** 0.15 -> "150ms". */
const ms = (seconds) => `${Math.round(seconds * 1000)}ms`

/** 3 -> "3s", 1.44 -> "1.44s". Trailing zeroes help nobody in a credit. */
const secs = (seconds) => `${Number(Number(seconds).toFixed(2))}s`

/**
 * Whether trim.py actually cut anything off this one-shot.
 *
 * It passes a source SHORTER than its cap straight through, so the 1.44s
 * elephant was never trimmed and must not claim to have been. The measured
 * duration is the evidence: a truncated file is exactly its cap, give or take
 * one AAC frame. When there is no measurement to go on, say it was trimmed —
 * over-stating a modification is the safe direction to be wrong in.
 */
const wasTruncated = (seconds, cap) =>
  typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds >= cap - 0.05

/**
 * The `modifications` sentence fragment for one sound, e.g.
 * "trimmed to 3s, peak-normalised to -1 dBFS, 150ms fade-out".
 *
 * @param kind    'sfx' or 'ambience' — which of the two scripts ran
 * @param item    the `content/sounds.json` entry, for its per-sound overrides
 * @param seconds the duration MEASURED off the encoded file, if it is known
 */
export function modificationsFor(kind, item = {}, seconds = undefined) {
  if (kind === 'ambience') {
    const want = item.seconds ?? LOOP.defaultSeconds
    return [
      `trimmed to ${secs(want)}`,
      `loudness-normalised to ${LOOP.targetRmsDbfs} dBFS RMS with a ${LOOP.peakCeilingDbfs} dBFS peak ceiling`,
      `${secs(LOOP.crossfadeSeconds)} equal-power crossfade loop`,
    ].join(', ')
  }

  const cap = item.maxSeconds ?? TRIM.defaultMaxSeconds
  const parts = []
  if (wasTruncated(seconds, cap)) parts.push(`trimmed to ${secs(cap)}`)
  parts.push(`peak-normalised to ${TRIM.peakCeilingDbfs} dBFS`)
  parts.push(`${ms(TRIM.fadeSeconds)} fade-out`)
  return parts.join(', ')
}
