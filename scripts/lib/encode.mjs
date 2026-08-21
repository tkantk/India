import { execFileSync } from 'node:child_process'

/**
 * afconvert cannot encode MP3 and cannot mix or fade; it is purely a codec
 * front end. ffmpeg and sox are not installed and must not be required.
 * Everything therefore goes through two steps: normalise to mono PCM, then
 * encode AAC. Verified working on macOS 26.5.
 */

/** Decode anything (aiff, mp3, ogg, wav, flac) to 16-bit mono 44.1 kHz PCM. */
export function toMonoWav(input, output) {
  execFileSync('afconvert', [
    '-f', 'WAVE',
    '-d', 'LEI16@44100',
    '-c', '1',                    // mono halves both file size and decoded RAM
    '--src-complexity', 'bats',
    '-r', '127',
    input, output,
  ])
  return output
}

/** Encode mono PCM to web-ready AAC in an .m4a container. */
export function toM4a(wav, output, bitrate = 56000) {
  execFileSync('afconvert', [
    '-f', 'm4af',
    '-d', 'aac',
    '-b', String(bitrate),
    '-q', '127',
    '-s', '2',
    wav, output,
  ])
  return output
}

/** Read channel count, sample rate and duration out of afinfo. */
export function probe(path) {
  const out = execFileSync('afinfo', [path], { encoding: 'utf8' })
  return {
    channels: Number(out.match(/(\d+) ch,/)?.[1] ?? 0),
    sampleRate: Number(out.match(/([\d.]+) Hz/)?.[1] ?? 0),
    duration: Number(out.match(/estimated duration:\s*([\d.]+)/)?.[1] ?? 0),
  }
}

export function durationOf(path) {
  return probe(path).duration
}
