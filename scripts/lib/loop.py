#!/usr/bin/env python3
"""Turn a field recording into a seamless loop of a given length.

ffmpeg and sox are not installed and pydub cannot be used (Python 3.13
removed the audioop module it depends on). numpy plus the wave module does
the whole job.

    python3 scripts/lib/loop.py in.wav out.wav <seconds> <crossfade-seconds>

Input must be 16-bit mono PCM; run it through afconvert first.
"""
import sys, wave
import numpy as np

TARGET_RMS_DBFS = -26.0
PEAK_CEILING_DBFS = -3.0


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


def normalise(a):
    """Match a common loudness, then pull the peak back under the ceiling.
    Raw ambience arrives anywhere from -50 to -12 dBFS; without this the mix
    is unusable."""
    rms = float(np.sqrt(np.mean(a ** 2))) + 1e-12
    a = a * (10 ** (TARGET_RMS_DBFS / 20) / rms)
    peak = float(np.max(np.abs(a))) + 1e-12
    ceiling = 10 ** (PEAK_CEILING_DBFS / 20)
    if peak > ceiling:
        a = a * (ceiling / peak)
    return a


def seamless(a, sr, seconds, fade):
    """Equal-power crossfade of the tail over the head.

    Gains are sqrt(t) and sqrt(1-t) so that fade_in^2 + fade_out^2 == 1. A
    linear fade dips about 3 dB in the middle on uncorrelated material, which
    is audible as a dip at the loop point.
    """
    want = int(round(seconds * sr))
    n = int(round(fade * sr))
    need = want + n
    if len(a) < need:
        sys.exit(f"source is {len(a)/sr:.1f}s, need at least {need/sr:.1f}s "
                 f"for a {seconds}s loop with a {fade}s crossfade")
    seg = a[:need]
    body, tail = seg[:-n], seg[-n:]
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    out = body.copy()
    out[:n] = body[:n] * np.sqrt(t) + tail * np.sqrt(1.0 - t)
    return out


def main():
    src, dst, seconds, fade = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
    a, sr = read(src)
    out = normalise(seamless(a, sr, seconds, fade))
    write(dst, out, sr)
    rms = 20 * np.log10(float(np.sqrt(np.mean(out ** 2))) + 1e-12)
    print(f"{dst}: {len(out)/sr:.2f}s, rms {rms:.1f} dBFS")


if __name__ == "__main__":
    main()
