import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LOOP, TRIM, modificationsFor } from './soundEdits.mjs'

/**
 * Two jobs.
 *
 * 1. The mirrored constants. `soundEdits.mjs` restates numbers that live in
 *    two Python files Node cannot import, and those numbers end up in a
 *    LEGAL NOTICE — "peak-normalised to -1 dBFS" is a statement about the
 *    file we are redistributing. A silent drift would make the notice false,
 *    so the .py files are read here and compared.
 *
 * 2. The notice itself, including the one case that is easy to get wrong:
 *    trim.py leaves a source shorter than its cap alone, so that file was
 *    never trimmed.
 */
const trimPy = readFileSync('scripts/lib/trim.py', 'utf8')
const loopPy = readFileSync('scripts/lib/loop.py', 'utf8')

const constant = (source, name) => {
  const found = source.match(new RegExp(`^${name}\\s*=\\s*(-?[\\d.]+)`, 'm'))
  expect(found, `${name} is not declared where this test expects it`).not.toBeNull()
  return Number(found[1])
}

describe('the mirrored DSP constants', () => {
  it('matches trim.py', () => {
    expect(TRIM.peakCeilingDbfs).toBe(constant(trimPy, 'PEAK_CEILING_DBFS'))
    expect(TRIM.fadeSeconds).toBe(constant(trimPy, 'FADE_SECONDS'))
  })

  it('matches loop.py', () => {
    expect(LOOP.targetRmsDbfs).toBe(constant(loopPy, 'TARGET_RMS_DBFS'))
    expect(LOOP.peakCeilingDbfs).toBe(constant(loopPy, 'PEAK_CEILING_DBFS'))
  })
})

describe('modificationsFor', () => {
  it('describes a one-shot that was cut down', () => {
    // peacock-call: 3s of a much longer farmyard recording.
    expect(modificationsFor('sfx', {}, 3))
      .toBe('trimmed to 3s, peak-normalised to -1 dBFS, 150ms fade-out')
  })

  it('honours a per-sound cap', () => {
    expect(modificationsFor('sfx', { maxSeconds: 6 }, 6))
      .toBe('trimmed to 6s, peak-normalised to -1 dBFS, 150ms fade-out')
  })

  it('does not claim to have trimmed a source that was already short enough', () => {
    // The elephant is 1.44s and was allowed 3: trim.py passed it through.
    // Normalising and fading still happened, and still have to be declared.
    expect(modificationsFor('sfx', {}, 1.44))
      .toBe('peak-normalised to -1 dBFS, 150ms fade-out')
  })

  it('assumes the trim happened when there is no measurement to go on', () => {
    // Over-stating a modification is the safe direction to be wrong in.
    expect(modificationsFor('sfx', {}, undefined)).toContain('trimmed to 3s')
  })

  it('describes an ambient bed', () => {
    expect(modificationsFor('ambience', { seconds: 20 }, 20)).toBe(
      'trimmed to 20s, loudness-normalised to -26 dBFS RMS with a -3 dBFS peak ceiling, '
      + '3s equal-power crossfade loop',
    )
  })

  it('names every edit the two scripts actually make', () => {
    // A cheap backstop against an edit being added to trim.py or loop.py and
    // never reaching the notice: each script's operations are enumerated here.
    const oneShot = modificationsFor('sfx', {}, 3)
    for (const edit of ['trimmed', 'peak-normalised', 'fade-out']) {
      expect(oneShot, `a one-shot notice must mention ${edit}`).toContain(edit)
    }
    const bed = modificationsFor('ambience', {}, 20)
    for (const edit of ['trimmed', 'normalised', 'crossfade']) {
      expect(bed, `a bed notice must mention ${edit}`).toContain(edit)
    }
  })
})
