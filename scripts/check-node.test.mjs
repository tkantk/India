import { describe, it, expect } from 'vitest'
import { getNodeVersion, checkNodeVersion } from './check-node.mjs'

describe('getNodeVersion', () => {
  it('extracts the node-version pinned in workflow YAML text', () => {
    const yaml = `
      - uses: actions/setup-node@abc123 # v7.0.0
        with:
          node-version: 24
          cache: npm
`
    expect(getNodeVersion(yaml)).toBe(24)
  })

  it('ignores mentions of "node-version" inside comment prose', () => {
    const yaml = `
      - uses: actions/setup-node@abc123 # v7.0.0
        with:
          # Must be 24, not 22. Some comment mentioning node-version in prose.
          node-version: 24
          cache: npm
`
    expect(getNodeVersion(yaml)).toBe(24)
  })

  it('throws when no node-version key is present', () => {
    expect(() => getNodeVersion('cache: npm')).toThrow()
  })
})

describe('checkNodeVersion', () => {
  it('throws when node-version is below the Node 23+ global constraint', () => {
    expect(() => checkNodeVersion('node-version: 22')).toThrow(/23/)
  })

  it('passes and returns the version when node-version satisfies the constraint', () => {
    expect(checkNodeVersion('node-version: 24')).toBe(24)
  })

  it('regression guard: the real .github/workflows/deploy.yml pins node-version >= 23', () => {
    expect(() => checkNodeVersion()).not.toThrow()
  })
})
