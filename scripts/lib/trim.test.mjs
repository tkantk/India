import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probe } from './encode.mjs'

const dir = mkdtempSync(join(tmpdir(), 'trim-'))
const long = join(dir, 'long.wav')
const short = join(dir, 'short.wav')
const quiet = join(dir, 'quiet.wav')

// python3 + numpy are not on the ubuntu-latest CI runner, and `probe()`
// shells out to macOS-only afinfo. Without this guard the first push to main
// fails the build job and the site never deploys. The fixture hook lives
// inside the guarded describe so a skipped suite spawns no python either.
const MACOS = process.platform === 'darwin'

describe.skipIf(!MACOS)('trim.py', () => {
  beforeAll(() => {
    // A 5-second constant-amplitude tone: long enough to need trimming down
    // to a one-shot length, with no built-in envelope of its own so any fade
    // we see at the tail is provably ours, not the source's.
    execFileSync('python3', ['-c', `
import numpy as np, wave
sr, n = 44100, 44100*5
t = np.arange(n)/sr
x = (0.5*np.sin(2*np.pi*440*t)*32767).astype('<i2')
w = wave.open(${JSON.stringify(long)}, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(x.tobytes()); w.close()
`])

    // A 1-second tone, shorter than any maxSeconds we will ask for.
    execFileSync('python3', ['-c', `
import numpy as np, wave
sr, n = 44100, 44100*1
t = np.arange(n)/sr
x = (0.3*np.sin(2*np.pi*440*t)*32767).astype('<i2')
w = wave.open(${JSON.stringify(short)}, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(x.tobytes()); w.close()
`])

    // A quiet 5-second tone, to prove peak normalisation actually raises it.
    execFileSync('python3', ['-c', `
import numpy as np, wave
sr, n = 44100, 44100*5
t = np.arange(n)/sr
x = (0.01*np.sin(2*np.pi*440*t)*32767).astype('<i2')
w = wave.open(${JSON.stringify(quiet)}, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(x.tobytes()); w.close()
`])
  })

  it('cuts a long source to exactly the requested length', () => {
    const out = join(dir, 'cut.wav')
    execFileSync('python3', ['scripts/lib/trim.py', long, out, '2'])
    expect(existsSync(out)).toBe(true)
    expect(probe(out).duration).toBeCloseTo(2, 1)
  })

  it('passes a short source through at its original length rather than padding it', () => {
    const out = join(dir, 'passthrough.wav')
    execFileSync('python3', ['scripts/lib/trim.py', short, out, '3'])
    expect(existsSync(out)).toBe(true)
    // 1 second in, asked for up to 3 — must stay ~1s, never padded to 3.
    expect(probe(out).duration).toBeCloseTo(1, 1)
  })

  it('fades the last 150ms out instead of ending on a hard cut', () => {
    const out = join(dir, 'fade.wav')
    execFileSync('python3', ['scripts/lib/trim.py', long, out, '2'])
    // Report the RMS envelope of the last 150ms as 5 successive 30ms windows,
    // in dB, so JS can assert monotonic non-increase without re-implementing
    // the windowing math on both sides of the process boundary.
    const dbs = JSON.parse(execFileSync('python3', ['-c', `
import numpy as np, wave, json
w = wave.open(${JSON.stringify(out)}); a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32)
sr = w.getframerate()
tail = a[-int(round(0.15*sr)):]
windows = np.array_split(tail, 5)
rms = lambda v: float(np.sqrt(np.mean(v**2)) + 1e-9)
print(json.dumps([20*np.log10(rms(win)/32768) for win in windows]))
`], { encoding: 'utf8' }))
    for (let i = 1; i < dbs.length; i++) {
      // Small tolerance for floating-point noise near silence, not a licence
      // for the envelope to actually climb back up.
      expect(dbs[i]).toBeLessThanOrEqual(dbs[i - 1] + 0.5)
    }
    // The last window must be meaningfully quieter than the first — proof a
    // fade happened at all, not just that it didn't get louder.
    expect(dbs[dbs.length - 1]).toBeLessThan(dbs[0] - 6)
  })

  it('normalises a one-shot up to the -1 dBFS peak ceiling', () => {
    const out = join(dir, 'loud.wav')
    execFileSync('python3', ['scripts/lib/trim.py', quiet, out, '5'])
    const peakDb = Number(execFileSync('python3', ['-c', `
import numpy as np, wave
w = wave.open(${JSON.stringify(out)}); a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32)/32768
print(20*np.log10(float(np.max(np.abs(a)))+1e-12))
`], { encoding: 'utf8' }))
    expect(peakDb).toBeGreaterThan(-1.5)
    expect(peakDb).toBeLessThan(-0.5)
  })
})
