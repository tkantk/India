import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probe } from './encode.mjs'

const dir = mkdtempSync(join(tmpdir(), 'loop-'))
const source = join(dir, 'src.wav')

beforeAll(() => {
  // A 20-second tone that fades in and out: the worst case for a naive
  // hard-cut loop, because the head and tail levels differ enormously.
  execFileSync('python3', ['-c', `
import numpy as np, wave
sr, n = 44100, 44100*20
t = np.arange(n)/sr
env = np.minimum(t/3, np.minimum(1, (20-t)/3))
x = (0.4*np.sin(2*np.pi*220*t)*env*32767).astype('<i2')
w = wave.open(${JSON.stringify(source)}, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(x.tobytes()); w.close()
`])
})

describe('loop.py', () => {
  it('produces a file of exactly the requested length', () => {
    const out = join(dir, 'loop.wav')
    execFileSync('python3', ['scripts/lib/loop.py', source, out, '12', '3'])
    expect(existsSync(out)).toBe(true)
    expect(probe(out).duration).toBeCloseTo(12, 1)
  })

  it('matches the head and tail level, which is what stops the loop clicking', () => {
    const out = join(dir, 'loop2.wav')
    execFileSync('python3', ['scripts/lib/loop.py', source, out, '12', '3'])
    const mismatchDb = Number(execFileSync('python3', ['-c', `
import numpy as np, wave, sys
w = wave.open(${JSON.stringify(out)}); a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32)
n = 4410
rms = lambda v: float(np.sqrt(np.mean(v**2)) + 1e-9)
print(abs(20*np.log10(rms(a[:n])/rms(a[-n:]))))
`], { encoding: 'utf8' }))
    // The naive hard cut on this fixture measures about 16.7 dB of mismatch.
    expect(mismatchDb).toBeLessThan(1.5)
  })

  it('normalises a quiet source up to the target RMS', () => {
    const quiet = join(dir, 'quiet.wav')
    execFileSync('python3', ['-c', `
import numpy as np, wave
sr, n = 44100, 44100*20
t = np.arange(n)/sr
x = (0.0005*np.sin(2*np.pi*300*t)*32767).astype('<i2')
w = wave.open(${JSON.stringify(quiet)}, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(x.tobytes()); w.close()
`])
    const out = join(dir, 'loud.wav')
    execFileSync('python3', ['scripts/lib/loop.py', quiet, out, '10', '2'])
    const rmsDb = Number(execFileSync('python3', ['-c', `
import numpy as np, wave
w = wave.open(${JSON.stringify(out)}); a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32)/32768
print(20*np.log10(float(np.sqrt(np.mean(a**2)))+1e-12))
`], { encoding: 'utf8' }))
    expect(rmsDb).toBeGreaterThan(-30)
    expect(rmsDb).toBeLessThan(-22)
  })

  it('refuses a source shorter than the requested loop rather than padding silence', () => {
    expect(() => execFileSync('python3', ['scripts/lib/loop.py', source, join(dir, 'x.wav'), '60', '3'],
      { stdio: 'pipe' })).toThrow()
  })
})
