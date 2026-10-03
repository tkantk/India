"""Measure a field recording, and draw its spectrogram, for someone who
cannot listen to it.

The sound pipeline is chosen by people who are not in the room with the
audio: an agent reading numbers and a picture, then the owner listening only
to a shortlist. So every candidate gets the objective facts that predict a
usable recording, and a spectrogram that shows what kind of sound it is.

    python3 scripts/lib/audio_metrics.py in.wav out.png [windowSeconds]

Prints one JSON object. Input must be 16-bit mono PCM (afconvert first, as
trim.py and loop.py require). numpy and the wave module only — ffmpeg and sox
are not installed, and pydub cannot be used (see trim.py).

What the numbers mean:
  seconds     length of the recording
  peak_dbfs   loudest single sample (0 is the ceiling)
  loud_dbfs   loudest `windowSeconds` stretch, by RMS — the part worth keeping
  floor_dbfs  the background: the 10th-percentile 50 ms frame. Wind, traffic,
              tape hiss, a fridge.
  snr_db      loud minus floor. THE number: a call 30 dB above its background
              is clean; under ~12 dB the animal is fighting the noise.
  clipped     share of samples at full scale — distortion, unfixable
  best_start  where the loudest window starts, in seconds: where to cut a
              one-shot from
  spread_db   for a background bed: loud moments minus quiet ones. Low is
              steady; high means something jumps out of it

Reading the spectrogram (time left to right, 0-11 kHz bottom to top):
  a bird call      thin bright lines or chirps, often well above 2 kHz
  a roar or growl  dense low energy under ~1 kHz, with a rough texture
  human speech     stacked, evenly spaced horizontal bands below ~4 kHz that
                   wobble together, in syllable-length bursts — reject it
  wind or traffic  a smooth wash across the bottom, no structure
"""
import json
import struct
import sys
import wave
import zlib

import numpy as np


def read_mono(path):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise SystemExit(f"{path}: need 16-bit mono PCM, run afconvert first")
        rate = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    return x, rate


def db(v):
    return float(20 * np.log10(max(v, 1e-9)))


def frame_rms(x, n):
    if len(x) < n:
        return np.array([np.sqrt(np.mean(x ** 2))]) if len(x) else np.array([0.0])
    k = len(x) // n
    return np.sqrt(np.mean(x[: k * n].reshape(k, n) ** 2, axis=1))


def measure(x, rate, window):
    f50 = frame_rms(x, int(rate * 0.05))
    win = max(1, int(window / 0.05))
    if len(f50) >= win:
        # RMS of each `window`-long run of 50 ms frames, via a cumulative sum
        e = np.concatenate([[0.0], np.cumsum(f50 ** 2)])
        runs = np.sqrt((e[win:] - e[:-win]) / win)
        best = int(np.argmax(runs))
        loud = float(runs[best])
    else:
        best, loud = 0, float(np.sqrt(np.mean(f50 ** 2)))
    floor = float(np.percentile(f50, 10))
    return {
        "seconds": round(len(x) / rate, 2),
        "peak_dbfs": round(db(np.max(np.abs(x)) if len(x) else 0), 1),
        "loud_dbfs": round(db(loud), 1),
        "floor_dbfs": round(db(floor), 1),
        "snr_db": round(db(loud) - db(floor), 1),
        "clipped": round(float(np.mean(np.abs(x) >= 0.999)), 4),
        "best_start": round(best * 0.05, 2),
        # For BACKGROUND BEDS, the opposite of snr: how far the loud moments
        # stand above the quiet ones (90th minus 10th percentile, 50 ms
        # frames). A steady bed scores low; a car horn or a shout in the
        # middle of a "desert wind" scores high and would jolt every visit.
        "spread_db": round(float(np.percentile(20 * np.log10(f50 + 1e-9), 90) - np.percentile(20 * np.log10(f50 + 1e-9), 10)), 1),
    }


def png(path, rgb):
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def spectrogram(x, rate, out, width=640, height=200, top_hz=11000):
    n = 1024
    hop = max(1, (len(x) - n) // width) if len(x) > n else 1
    win = np.hanning(n)
    cols = []
    for i in range(width):
        s = i * hop
        seg = x[s : s + n]
        if len(seg) < n:
            seg = np.pad(seg, (0, n - len(seg)))
        cols.append(np.abs(np.fft.rfft(seg * win)))
    spec = np.array(cols).T  # freq x time
    bins = int(top_hz / (rate / 2) * spec.shape[0])
    spec = spec[: max(bins, 1)]
    level = 20 * np.log10(spec + 1e-9)
    level = np.clip((level - (level.max() - 80)) / 80, 0, 1)  # 80 dB of range
    # resample the frequency axis to `height` rows, low frequencies at the bottom
    rows = np.linspace(0, level.shape[0] - 1, height).astype(int)
    img = level[rows][::-1]
    # dark blue -> magenta -> yellow: quiet, mid, loud
    r = np.clip(img * 2.2, 0, 1)
    g = np.clip((img - 0.45) * 1.8, 0, 1)
    b = np.clip(0.35 + img * 0.9 - g * 0.9, 0, 1)
    rgb = (np.stack([r, g, b], axis=-1) * 255).astype(np.uint8)
    # a faint line every 2 kHz so frequencies can be read off the picture
    for khz in range(2, int(top_hz / 1000) + 1, 2):
        y = height - 1 - int(khz * 1000 / top_hz * (height - 1))
        rgb[y, ::4] = [90, 90, 90]
    png(out, rgb)


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    window = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
    x, rate = read_mono(src)
    m = measure(x, rate, window)
    spectrogram(x, rate, out)
    print(json.dumps(m))
