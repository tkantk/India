import { describe, it, expect } from 'vitest'
import { isCached, readCacheEntry, isFresh, providerChanged, signatureFingerprint, billingVerdict } from './cache.mjs'

/**
 * tts.mjs's cost preflight (which decides what a forced/unscoped run will
 * bill before it runs) and its render loop (which decides what to actually
 * skip) both call this predicate. Testing it directly, once, is what makes
 * it structurally impossible for the two call sites to disagree about what
 * "needs rendering" means — there is only one definition to test.
 */
const base = { cachedKey: 'abc123', currentKey: 'abc123', audioExists: true, hasPrevious: true }

describe('isCached', () => {
  it('is cached when the key matches, the audio file exists, and prior timings exist', () => {
    expect(isCached(base)).toBe(true)
  })

  it('is not cached when the text changed and the key no longer matches', () => {
    expect(isCached({ ...base, currentKey: 'xyz789' })).toBe(false)
  })

  it('is not cached when the audio file is missing from disk', () => {
    expect(isCached({ ...base, audioExists: false })).toBe(false)
  })

  it('is not cached when there is no prior timings entry to reuse', () => {
    expect(isCached({ ...base, hasPrevious: false })).toBe(false)
  })

  it('is not cached on a brand-new line, where nothing has ever been cached', () => {
    expect(isCached({ cachedKey: undefined, currentKey: 'abc123', audioExists: false, hasPrevious: undefined })).toBe(false)
  })
})

describe('readCacheEntry', () => {
  it('reads a pre-Task-6 flat string as its key, with no id and no timestamp', () => {
    expect(readCacheEntry('abc123')).toEqual({ key: 'abc123', requestId: undefined, renderedAt: undefined })
  })

  it('reads the newer object shape as-is', () => {
    expect(readCacheEntry({ key: 'abc123', requestId: 'req_1', renderedAt: 1000 }))
      .toEqual({ key: 'abc123', requestId: 'req_1', renderedAt: 1000 })
  })

  it('reads a missing entry (a brand-new line) as all-undefined', () => {
    expect(readCacheEntry(undefined)).toEqual({ key: undefined, requestId: undefined, renderedAt: undefined })
  })
})

describe('isFresh', () => {
  const TWO_HOURS = 2 * 60 * 60 * 1000
  const now = 10_000_000

  it('is fresh just under two hours old', () => {
    expect(isFresh(now - (TWO_HOURS - 1), now)).toBe(true)
  })

  it('is not fresh at exactly two hours old', () => {
    expect(isFresh(now - TWO_HOURS, now)).toBe(false)
  })

  it('is not fresh well past two hours old', () => {
    expect(isFresh(now - TWO_HOURS * 3, now)).toBe(false)
  })

  it('is not fresh when there is no timestamp at all', () => {
    expect(isFresh(undefined, now)).toBe(false)
  })
})

describe('providerChanged', () => {
  it('refuses when a recorded signature differs from the current one and clips exist', () => {
    expect(providerChanged({ previousSignature: 'say:Tara:130', currentSignature: 'elevenlabs:v1', clipsExist: true }))
      .toBe(true)
  })

  it('is unaffected when the signature is the same, however many clips exist', () => {
    expect(providerChanged({ previousSignature: 'elevenlabs:v1', currentSignature: 'elevenlabs:v1', clipsExist: true }))
      .toBe(false)
  })

  it('does not refuse a changed signature when nothing on disk could be destroyed', () => {
    expect(providerChanged({ previousSignature: 'say:Tara:130', currentSignature: 'elevenlabs:v1', clipsExist: false }))
      .toBe(false)
  })

  it('a fresh tree — no recorded signature at all — never refuses, however different the current one is', () => {
    expect(providerChanged({ previousSignature: undefined, currentSignature: 'elevenlabs:v1', clipsExist: true }))
      .toBe(false)
  })
})

// A raw signature can embed real account configuration — ElevenLabs' includes
// the voice id — and the provider-change guard's console message must be
// safe to appear in a terminal or a CI log. This is what makes it so,
// tested directly rather than trusted by eye.
describe('signatureFingerprint', () => {
  const REAL_SIGNATURE = 'elevenlabs:AENoBp8y6Xe7vGqG1oj4:eleven_multilingual_v2:mp3_44100_64:{"speed":0.85}'

  it('never contains the raw signature it was derived from', () => {
    expect(signatureFingerprint(REAL_SIGNATURE)).not.toContain(REAL_SIGNATURE)
    expect(REAL_SIGNATURE).not.toContain(signatureFingerprint(REAL_SIGNATURE))
  })

  it('is stable: the same signature always fingerprints the same', () => {
    expect(signatureFingerprint(REAL_SIGNATURE)).toBe(signatureFingerprint(REAL_SIGNATURE))
  })

  it('differs for a different signature, so a human can see it changed', () => {
    expect(signatureFingerprint(REAL_SIGNATURE)).not.toBe(signatureFingerprint('say:Tara:130'))
  })

  it('has a readable placeholder for "nothing recorded yet", not a hash of undefined', () => {
    expect(signatureFingerprint(undefined)).toBe('(none recorded)')
  })
})

// The one time this ran against a real bill, `spent` came in BELOW
// `preflightChars` — a shortfall, not an overage. An earlier version of
// this collapsed "not equal" into "next_text IS billed" regardless of
// direction, which is backwards for a shortfall: if next_text/previous_text
// billed extra on top, the total could only be >= the primary text alone.
describe('billingVerdict', () => {
  it('an exact match is read as no evidence of extra billing', () => {
    const { delta, verdict } = billingVerdict(4340, 4340)
    expect(delta).toBe(0)
    expect(verdict).toMatch(/exact match/i)
    expect(verdict).not.toMatch(/next_text is billed/i)
  })

  it('billed MORE than the primary text is read as consistent with next_text being billed on top', () => {
    const { delta, verdict } = billingVerdict(4340, 5000)
    expect(delta).toBe(660)
    expect(verdict).toMatch(/MORE/)
    expect(verdict).toMatch(/consistent with next_text/i)
  })

  // The real case: 22 lines, preflight 4,340 characters, provider billed
  // 2,386 — a 1,954-character SHORTFALL, not an overage.
  it('billed FEWER than the primary text PROVES next_text is not billed on top, not the reverse', () => {
    const { delta, verdict } = billingVerdict(4340, 2386)
    expect(delta).toBe(-1954)
    expect(verdict).toMatch(/FEWER/)
    expect(verdict).toMatch(/proves next_text is NOT billed on top/i)
    expect(verdict).not.toMatch(/next_text IS billed/)
  })
})
