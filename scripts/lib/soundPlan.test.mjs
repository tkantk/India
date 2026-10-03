import { describe, it, expect } from 'vitest'
import { nextStep } from './soundPlan.mjs'

const pick = { source: 'xc', ref: '1', pageUrl: 'https://xeno-canto.org/1' }

describe('nextStep — no sound is ever chosen by a script', () => {
  // The run that found this shipped a 1916 song as the desert, a police
  // siren as the city and a politician's speech as the island.
  it('leaves a sound with no credit and no pick silent, and never searches for one', () => {
    expect(nextStep({ onDisk: false })).toBe('unpicked')
    expect(nextStep({ have: undefined, onDisk: false, pick: undefined })).toBe('unpicked')
  })

  it('a credit whose file is missing is not "had", and is not re-searched either', () => {
    expect(nextStep({ have: { fileTitle: 'File:x.ogg' }, onDisk: false })).toBe('unpicked')
  })

  it('fetches a pick, and only once', () => {
    expect(nextStep({ onDisk: false, pick })).toBe('fetch-pick')
    expect(nextStep({ have: { descriptionUrl: pick.pageUrl }, onDisk: true, pick })).toBe('already-picked')
  })

  it('a new pick replaces whatever was there before', () => {
    expect(nextStep({ have: { descriptionUrl: 'https://commons.wikimedia.org/wiki/File:old.ogg' }, onDisk: true, pick })).toBe('fetch-pick')
  })

  it('keeps sounds already chosen: Commons ones are only refreshed, others left alone', () => {
    expect(nextStep({ have: { fileTitle: 'File:x.ogg' }, onDisk: true })).toBe('refresh-commons')
    expect(nextStep({ have: { source: 'commons' }, onDisk: true })).toBe('refresh-commons')
    expect(nextStep({ have: { source: 'freesound' }, onDisk: true })).toBe('keep')
  })
})
