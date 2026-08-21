import { describe, it, expect } from 'vitest'
import { assetUrl } from './assetUrl'

// Vite normalises base:'./' to '/' when serving, and vitest runs in serve
// mode, so BASE_URL is '/' here and './' in a production build. Assert the
// behaviour against BASE_URL rather than hardcoding either one.
const BASE = import.meta.env.BASE_URL

describe('assetUrl', () => {
  it('joins a relative path onto the Vite base', () => {
    expect(assetUrl('audio/en/tour-01.m4a')).toBe(BASE.replace(/\/$/, '') + '/audio/en/tour-01.m4a')
  })

  it('strips a leading slash, because absolute paths 404 on a GitHub project page', () => {
    expect(assetUrl('/audio/en/tour-01.m4a')).toBe(assetUrl('audio/en/tour-01.m4a'))
  })

  it('never emits a double slash', () => {
    expect(assetUrl('photos/taj.jpg')).not.toMatch(/([^:])\/\//)
  })
})
