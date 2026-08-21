import { describe, it, expect } from 'vitest'
import { isCached } from './cache.mjs'

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
