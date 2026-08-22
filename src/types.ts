/**
 * The three shapes the whole app shares. Declared once here and imported
 * everywhere — the map, the engine, the cue registry and the tour all speak
 * in these.
 */

/** [x, y, width, height] in viewBox units. Matches geo.json's `bbox`. */
export type Bbox = [number, number, number, number]

/**
 * One animation cue.
 *
 * `t` is already resolved to **seconds** by the build. The app never converts
 * a word index to a time — that happened once, against the real rendered
 * audio, in `scripts/tts.mjs`. `word` is kept only so a cue can be traced
 * back to the word that triggered it.
 */
export type Cue = { t: number; word: number; do: string; arg?: string }

/** One narrated line: its audio file, its words, and when each is spoken. */
export type Clip = {
  audio: string
  duration: number
  words: string[]
  starts: number[]
  ends: number[]
  cues: Cue[]
}
