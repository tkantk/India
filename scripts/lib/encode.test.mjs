import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toMonoWav, toM4a, durationOf, probe } from './encode.mjs'

const dir = mkdtempSync(join(tmpdir(), 'encode-'))
const spoken = join(dir, 'spoken.aiff')

// `say` and `afconvert` are macOS-only, and CI runs the whole suite on
// ubuntu-latest. Without this guard the first push to main fails the build
// job on a missing binary and the site never deploys. The hooks live inside
// the guarded describe so a skipped suite runs no `say` either.
const MACOS = process.platform === 'darwin'

describe.skipIf(!MACOS)('encode', () => {
  beforeAll(() => {
    execFileSync('say', ['-v', 'Tara', '-r', '130', '-o', spoken, 'Hello little one, this is India.'])
  })

  it('converts to 16-bit mono 44.1 kHz PCM', () => {
    const wav = join(dir, 'mono.wav')
    toMonoWav(spoken, wav)
    expect(existsSync(wav)).toBe(true)
    const p = probe(wav)
    expect(p.channels).toBe(1)
    expect(p.sampleRate).toBe(44100)
  })

  it('encodes AAC into an .m4a smaller than the PCM it came from', () => {
    const wav = join(dir, 'mono2.wav')
    const m4a = join(dir, 'out.m4a')
    toMonoWav(spoken, wav)
    toM4a(wav, m4a, 56000)
    expect(existsSync(m4a)).toBe(true)
    expect(statSync(m4a).size).toBeLessThan(statSync(wav).size)
    expect(probe(m4a).channels).toBe(1)
  })

  it('reports a duration that matches the source within 100 ms', () => {
    const wav = join(dir, 'mono3.wav')
    const m4a = join(dir, 'out3.m4a')
    toMonoWav(spoken, wav)
    toM4a(wav, m4a, 56000)
    expect(Math.abs(durationOf(m4a) - durationOf(wav))).toBeLessThan(0.1)
  })

  it('reports a plausible duration for a short sentence', () => {
    expect(durationOf(spoken)).toBeGreaterThan(1)
    expect(durationOf(spoken)).toBeLessThan(15)
  })
})
