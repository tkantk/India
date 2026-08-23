import { describe, it, expect, vi, afterEach } from 'vitest'
import { setTracing, isTracing, subscribeTracing } from './tracing'

// Module-scoped state, so every test must leave it exactly as it found it —
// the same discipline tourPosition.test.ts already has to observe for the
// same reason (a module-scoped store outlives any one test in this file).
afterEach(() => setTracing(false))

describe('tracing', () => {
  it('starts false', () => {
    expect(isTracing()).toBe(false)
  })

  it('reflects the most recent write', () => {
    setTracing(true)
    expect(isTracing()).toBe(true)
    setTracing(false)
    expect(isTracing()).toBe(false)
  })

  it('notifies a subscriber when the value actually changes', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeTracing(fn)
    setTracing(true)
    expect(fn).toHaveBeenCalledOnce()
    setTracing(false)
    expect(fn).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('does not notify on a same-value write — nothing changed, so nothing needs waking', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeTracing(fn)
    setTracing(false) // already false
    expect(fn).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('stops notifying once unsubscribed', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeTracing(fn)
    unsubscribe()
    setTracing(true)
    expect(fn).not.toHaveBeenCalled()
  })

  it('supports more than one subscriber at once', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribeTracing(a)
    const unsubB = subscribeTracing(b)
    setTracing(true)
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
    unsubA()
    unsubB()
  })
})
