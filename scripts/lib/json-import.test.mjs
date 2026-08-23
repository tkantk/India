import { describe, it, expect, vi } from 'vitest'
import { resolve } from './json-import.mjs'

describe('json-import resolve hook', () => {
  it('adds type: json to a .json url that arrived with no attribute', async () => {
    const next = vi.fn(async () => ({ url: 'file:///x/data.json', shortCircuit: true }))
    const out = await resolve('./data.json', { importAttributes: {} }, next)
    expect(out.importAttributes).toEqual({ type: 'json' })
    // Everything else `nextResolve` returned passes through untouched.
    expect(out.url).toBe('file:///x/data.json')
    expect(out.shortCircuit).toBe(true)
  })

  it('leaves a non-json url alone', async () => {
    const next = vi.fn(async () => ({ url: 'file:///x/foo.ts' }))
    const out = await resolve('./foo.ts', { importAttributes: {} }, next)
    expect(out.importAttributes).toBeUndefined()
  })

  it('leaves the result alone when the import already carried the attribute', async () => {
    const nextResult = { url: 'file:///x/data.json' }
    const next = vi.fn(async () => nextResult)
    const out = await resolve('./data.json', { importAttributes: { type: 'json' } }, next)
    // Nothing to add — the attribute the load step needs is already on the
    // resolution the caller supplied, so this is `nextResolve`'s own object
    // untouched rather than a copy with a redundant field bolted on.
    expect(out).toBe(nextResult)
  })

  it('passes the specifier and context straight through to nextResolve', async () => {
    const next = vi.fn(async () => ({ url: 'file:///x/data.json' }))
    const ctx = { importAttributes: {} }
    await resolve('./data.json', ctx, next)
    expect(next).toHaveBeenCalledWith('./data.json', ctx)
  })
})
