#!/usr/bin/env python3
"""Cut a field recording down to a short one-shot.

A one-shot fires on a single narrated word, so it must be short — raw
Commons sources run to 96 seconds and would still be playing several
sentences later, over the top of the narration. Mirrors loop.py: ffmpeg and
sox are not installed and pydub cannot be used (Python 3.13 removed the
audioop module it depends on), so numpy plus the wave module does the whole
job.

    python3 scripts/lib/trim.py in.wav out.wav <maxSeconds>

Input must be 16-bit mono PCM; run it through afconvert first.
"""
import sys, wave
import numpy as np

PEAK_CEILING_DBFS = -1.0
FADE_SECONDS = 0.15


def read(path):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            sys.exit(f"{path}: expected 16-bit mono PCM; convert with afconvert first")
        sr = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768.0
    return a, sr


def write(path, a, sr):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(a, -1.0, 1.0) * 32767).astype("<i2").tobytes())


def normalise_peak(a):
    """One-shots get a peak target only, not the RMS target ambience beds
    get — a growl and a chime have wildly different loudness shapes, so
    matching peaks keeps them from clipping without pretending they should
    all sound equally loud."""
    peak = float(np.max(np.abs(a))) + 1e-12
    ceiling = 10 ** (PEAK_CEILING_DBFS / 20)
    return a * (ceiling / peak)


def fade_out(a, sr, fade_seconds):
    """Linear fade over the last fade_seconds so a trimmed clip doesn't end
    on a hard cut and click. Short enough (150ms) that a plain linear ramp
    is inaudible as a fade shape; only the equal-power crossfade in loop.py
    needs the sqrt curve, because that one blends two live signals instead
    of fading to silence."""
    n = min(int(round(fade_seconds * sr)), len(a))
    if n <= 0:
        return a
    out = a.copy()
    ramp = np.linspace(1.0, 0.0, n, dtype=np.float32)
    out[-n:] = out[-n:] * ramp
    return out


def main():
    src, dst, max_seconds = sys.argv[1], sys.argv[2], float(sys.argv[3])
    a, sr = read(src)
    want = int(round(max_seconds * sr))
    if len(a) > want:
        a = a[:want]
    out = fade_out(normalise_peak(a), sr, FADE_SECONDS)
    write(dst, out, sr)
    peak = 20 * np.log10(float(np.max(np.abs(out))) + 1e-12)
    print(f"{dst}: {len(out)/sr:.2f}s, peak {peak:.1f} dBFS")


if __name__ == "__main__":
    main()
