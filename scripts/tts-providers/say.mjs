import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Free local draft voice. Produces no alignment, so tts.mjs falls back to
 * estimateTimings(). Purpose: build and test every animation, cue and
 * transition without spending a single paid character.
 *
 * Tara is macOS's en_IN female voice. 130 wpm against a ~175 default is
 * roughly the pace of the final render at speed 0.85, so cues authored
 * against the draft land in about the right place after the swap.
 */
export const name = 'say'
export const voice = 'Tara'
export const rate = 130

/** CPU-bound local synthesis gains nothing from parallelism, so tts.mjs
 *  renders one run at a time on this provider. */
export const concurrency = 1

/**
 * `previousRequestIds`/`nextText` are part of the provider interface every
 * caller passes (Task 6's prosodic continuity), but `say` has no server, no
 * request ids and no concept of "the next segment" — it accepts and ignores
 * both, which is also why it returns no `requestId`: there is nothing later
 * in a chain to condition on.
 */
export async function synth(text, { tmpDir, id, previousRequestIds, nextText }) {
  const out = join(tmpDir, `${id}.aiff`)
  execFileSync('say', ['-v', voice, '-r', String(rate), '-o', out, text])
  return { audioPath: out, alignment: null, requestId: null }
}

/** Part of the cache key: change the voice or rate and everything re-renders. */
export const signature = () => `say:${voice}:${rate}`
