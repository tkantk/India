import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envHelp } from './env-guard.mjs'

const HELP = { npmScript: 'voices', directCommand: 'scripts/voices.mjs' }

describe('envHelp', () => {
  it('tells a user with no .env at all to create one from .env.example', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'env-guard-'))
    const msg = envHelp('ELEVENLABS_API_KEY', { ...HELP, cwd })
    expect(msg).toMatch(/is not set/)
    expect(msg).toMatch(/\.env\.example/)
    expect(msg).toMatch(/repo root/)
  })

  // The bug this whole file exists to fix: a real .env with the right key
  // in it, and process.env still empty because nothing loaded the file.
  // Telling this person to "set ELEVENLABS_API_KEY" again is the failure —
  // they must be told loading, not authoring, is the problem.
  it('tells a user whose .env already has the key that loading is the problem', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'env-guard-'))
    writeFileSync(join(cwd, '.env'), 'ELEVENLABS_API_KEY=sk-super-secret-value\n')
    const msg = envHelp('ELEVENLABS_API_KEY', { ...HELP, cwd })
    expect(msg).toMatch(/is set in \.env/)
    expect(msg).toMatch(/nothing loaded/)
    expect(msg).not.toMatch(/is not set/)
  })

  it('never echoes the actual secret value out of .env', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'env-guard-'))
    writeFileSync(join(cwd, '.env'), 'ELEVENLABS_API_KEY=sk-super-secret-value\n')
    const msg = envHelp('ELEVENLABS_API_KEY', { ...HELP, cwd })
    expect(msg).not.toContain('sk-super-secret-value')
  })

  it('treats a key with no value assigned as not set', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'env-guard-'))
    writeFileSync(join(cwd, '.env'), 'ELEVENLABS_API_KEY=\n')
    const msg = envHelp('ELEVENLABS_API_KEY', { ...HELP, cwd })
    expect(msg).toMatch(/is not set/)
  })

  it('does not match a different variable name that merely shares a prefix', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'env-guard-'))
    writeFileSync(join(cwd, '.env'), 'ELEVENLABS_VOICE_ID=abc123\n')
    const msg = envHelp('ELEVENLABS_API_KEY', { ...HELP, cwd })
    expect(msg).toMatch(/is not set/)
  })

  it('names the npm alias and the direct --env-file-if-exists invocation', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'env-guard-'))
    const msg = envHelp('ELEVENLABS_API_KEY', { ...HELP, cwd })
    expect(msg).toMatch(/npm run voices/)
    expect(msg).toContain('node --env-file-if-exists=.env scripts/voices.mjs')
    // The throwing variant must never be suggested.
    expect(msg).not.toMatch(/--env-file=/)
  })
})
