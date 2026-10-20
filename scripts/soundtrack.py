"""Score the film: a soundtrack generated on the beat grid of assets/film/cut.json.

A pad, a bass line, plucked arpeggios and soft drums follow the cut's chords and parts; hits, risers,
whooshes, counter runs and accents land on its cues, so the music lifts what the film shows at the
moment it shows it. Everything is synthesised here with numpy: no samples, nothing to license.
Usage: python scripts/soundtrack.py out.wav
"""
import json, os, sys, wave
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SR = 48000
TAU = 2 * np.pi
rng = np.random.default_rng(2025)

# chord name: (bass note, pad voicing) as MIDI numbers; neighbouring voicings move by small steps
CHORDS = {
    'D5': (38, [50, 57, 62]),
    'Dm9': (38, [50, 53, 57, 60, 64]),
    'Bbmaj9': (34, [50, 53, 57, 60, 62]),
    'F9': (41, [53, 57, 60, 64, 67]),
    'C9': (36, [52, 55, 60, 62, 67]),
    'Gm9': (43, [50, 53, 58, 62, 69]),
    'A7sus': (45, [50, 55, 57, 62, 64]),
    'Fmaj9': (41, [53, 57, 60, 64, 67, 72]),
}
EASE = {
    'lin': lambda t: t,
    'in': lambda t: t ** 3,
    'out': lambda t: 1 - (1 - t) ** 3,
    'io': lambda t: 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2,
}


def keyed(keys, b):
    """Value of [[beat, value, easing], ...] at beat b, as in js/cut.js."""
    if b <= keys[0][0]:
        return keys[0][1]
    for (b0, v0, *_), (b1, v1, *e) in zip(keys, keys[1:]):
        if b <= b1:
            return v0 + (v1 - v0) * EASE[e[0] if e else 'lin']((b - b0) / (b1 - b0))
    return keys[-1][1]


def beat_of_u(keys, u):
    """First beat at which the film reaches position u (positions never decrease)."""
    lo, hi = keys[0][0], keys[-1][0]
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if keyed(keys, mid) < u else (lo, mid)
    return hi


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def ramp(n, a, r):
    """Envelope of n samples: a smooth rise over a seconds, a smooth fall over the last r seconds."""
    t = np.arange(n) / SR
    e = np.ones(n)
    if a > 0:
        e *= np.sin(0.5 * np.pi * np.clip(t / a, 0, 1)) ** 2
    if r > 0:
        e *= np.sin(0.5 * np.pi * np.clip((n / SR - t) / r, 0, 1)) ** 2
    return e


def shape(x, lo=None, hi=None, order=2):
    """Butterworth-like band limits applied in the frequency domain."""
    X = np.fft.rfft(x)
    f = np.maximum(np.fft.rfftfreq(len(x), 1 / SR), 1e-3)
    g = np.ones_like(f)
    if lo:
        g /= np.sqrt(1 + (lo / f) ** (2 * order))
    if hi:
        g /= np.sqrt(1 + (f / hi) ** (2 * order))
    return np.fft.irfft(X * g, len(x))


def band_noise(n, fc, octaves=1.0):
    """White noise through a band whose centre follows fc (Hz, one value per sample)."""
    win, hop = 2048, 512
    w = np.hanning(win)
    f = np.maximum(np.fft.rfftfreq(win, 1 / SR), 1.0)
    src = rng.standard_normal(n + 2 * win)
    out = np.zeros(n + 2 * win)
    for s in range(0, n + win, hop):
        c = fc[min(n - 1, max(0, s - win // 2))]
        mask = np.exp(-0.5 * (np.log2(f / c) / (octaves / 2)) ** 2)
        out[s:s + win] += np.fft.irfft(np.fft.rfft(src[s:s + win] * w) * mask) * w
    return out[win:win + n] / 1.5


def wavetable(f, bright, size=4096):
    """One period of a soft, saw-like tone: partials 1/k, rolled off above bright Hz, random phases."""
    x = np.arange(size) / size
    tab = np.zeros(size)
    for k in range(1, max(2, min(40, int(9000 / f))) + 1):
        tab += np.sin(TAU * k * x + rng.uniform(0, TAU)) * np.exp(-k * f / bright) / k
    return tab / np.abs(tab).max()


def osc(tab, f, n, phase0=0.0):
    ph = (phase0 + f * np.arange(n) / SR) % 1.0
    i = ph * len(tab)
    i0 = i.astype(int)
    fr = i - i0
    return tab[i0] * (1 - fr) + tab[(i0 + 1) % len(tab)] * fr


def tone(f, dur, amps, decays, ratios=None, attack=0.003, detune=0.0):
    """Additive tone whose partials fade at their own rates (plucks, bells)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, (a, d) in enumerate(zip(amps, decays)):
        fk = f * (ratios[k] if ratios else k + 1) * 2 ** (detune / 1200)
        if fk > 15000:
            break
        out += a * np.sin(TAU * fk * t + rng.uniform(0, TAU)) * np.exp(-t / d)
    return out * ramp(n, attack, 0.02)


def pluck(f, decay=0.75, dur=None, bright=1.0):
    dur = dur or min(2.5, decay * 4)
    amps = [1, 0.42 * bright, 0.2 * bright, 0.1 * bright, 0.05 * bright, 0.025 * bright]
    return tone(f, dur, amps, [decay / (1 + 1.1 * k) for k in range(6)], attack=0.004)


def bell(f, dur=3.6):
    return tone(f, dur, [1, 0.55, 0.36, 0.24, 0.12, 0.07], [2.8, 1.9, 1.3, 0.85, 0.55, 0.35],
                ratios=[1, 2.0, 2.76, 4.07, 5.43, 6.8], attack=0.002)


def kick(dur=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 44 + 80 * np.exp(-t / 0.032)
    body = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / 0.26)
    click = shape(rng.standard_normal(n), lo=1500) * np.exp(-t / 0.0025) * 0.12
    return (body + click) * ramp(n, 0.001, 0.03)


def hat(dur=0.09):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return shape(rng.standard_normal(n), lo=7000, order=3) * np.exp(-t / 0.018) * ramp(n, 0.0005, 0.01)


def impact(size, dur=4.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sub = np.sin(TAU * np.cumsum(29 + 46 * np.exp(-t / 0.2)) / SR) * np.exp(-t / 1.4)
    thump = np.sin(TAU * np.cumsum(58 + 70 * np.exp(-t / 0.04)) / SR) * np.exp(-t / 0.32)
    chans = []
    for _ in range(2):
        body = shape(rng.standard_normal(n), lo=70, hi=900) * np.exp(-t / 0.2)
        crack = shape(rng.standard_normal(n), lo=1800, hi=9000) * np.exp(-t / 0.045)
        chans.append(sub + 0.6 * thump + 0.28 * body + 0.12 * crack)
    return np.stack(chans) * size * ramp(n, 0.0015, 0.3)


def riser(dur):
    n = int(dur * SR)
    p = np.arange(n) / n
    fc = 320 * (7500 / 320) ** (p ** 1.3)
    amp = p ** 2.3
    glide = np.sin(TAU * np.cumsum(220 * 2 ** (3 * p ** 1.6)) / SR) * 0.12
    chans = [(band_noise(n, fc, 1.3) + glide) * amp for _ in range(2)]
    return np.stack(chans) * ramp(n, 0.0, 0.012)


def whoosh(dur):
    n = int(dur * SR)
    p = np.arange(n) / n
    fc = 260 * (3400 / 260) ** np.sin(np.pi * p)
    sig = band_noise(n, fc, 1.5) * np.sin(np.pi * p) ** 2
    pan = -0.8 + 1.6 * p
    return np.stack([sig * np.cos((pan + 1) * np.pi / 4), sig * np.sin((pan + 1) * np.pi / 4)])


def fire(dur=2.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    rumble = shape(rng.standard_normal(n), hi=260) * (1 - np.exp(-t / 0.04)) * np.exp(-t / 0.9) * 0.9
    flare = band_noise(n, 500 * 4 ** np.clip(t / 0.5, 0, 1), 1.4) * np.exp(-t / 0.5) * 0.7
    out = np.stack([rumble + flare, rumble + flare])
    k = 0
    while k < 160:
        tc = rng.exponential(0.5)
        if tc > dur - 0.05:
            k += 1
            continue
        m = int(0.012 * SR)
        c = shape(rng.standard_normal(m), lo=900, hi=6000) * np.exp(-np.arange(m) / SR / 0.003)
        i = int(tc * SR)
        side = rng.integers(0, 2)
        out[side, i:i + m] += c * rng.uniform(0.3, 1.0) * np.exp(-tc / 1.2)
        k += 1
    return out * ramp(n, 0.002, 0.2)


def drought(dur=3.4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    thud = np.sin(TAU * 38 * t) * np.exp(-t / 0.7) * ramp(n, 0.01, 0.1)
    heat = band_noise(n, np.full(n, 1500.0), 1.6) * ramp(n, 0.9, 1.6) * (1 + 0.25 * np.sin(TAU * 5.5 * t)) * 0.45
    return np.stack([thud + heat, thud + heat * 0.85])


class Mix:
    def __init__(self, n):
        self.n = n
        self.bus = {}

    def add(self, bus, t, sig, gain=1.0, pan=0.0):
        """Add mono or stereo sig to bus, starting at t seconds; pan moves a mono source."""
        if bus not in self.bus:
            self.bus[bus] = np.zeros((2, self.n))
        if sig.ndim == 1:
            sig = np.stack([sig * np.cos((pan + 1) * np.pi / 4), sig * np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
        i0 = int(round(t * SR))
        if i0 >= self.n:
            return
        j0 = max(0, -i0)
        m = min(sig.shape[1] - j0, self.n - max(i0, 0))
        self.bus[bus][:, max(i0, 0):max(i0, 0) + m] += sig[:, j0:j0 + m] * gain


def reverb_ir(dur=3.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    chans = []
    for _ in range(2):
        X = np.fft.rfft(rng.standard_normal(n))
        f = np.fft.rfftfreq(n, 1 / SR)
        lo, mid, hi = (np.fft.irfft(X * m, n) for m in (f < 600, (f >= 600) & (f < 4000), f >= 4000))
        ir = lo * np.exp(-t * 6.9 / 2.7) + mid * np.exp(-t * 6.9 / 2.0) + 0.5 * hi * np.exp(-t * 6.9 / 0.8)
        ir *= np.clip((t - 0.018) / 0.03, 0, 1)
        chans.append(ir)
    ir = np.stack(chans)
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


def convolve(x, h):
    n = len(x) + len(h) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(h, N), N)[:len(x)]


def score(cut):
    spb = 60 / cut['bpm']
    T = lambda b: b * spb
    total = cut['beats'] * spb
    mix = Mix(int((total + 0.5) * SR))
    music = cut['music']
    parts = music['parts']
    chords = music['chords']
    seg = [(b, chords[i + 1][0] if i + 1 < len(chords) else cut['beats'], name) for i, (b, name) in enumerate(chords)]
    inside = lambda part, b: any(a <= b < z for a, z in parts.get(part, []))
    chord_at = lambda b: next(name for b0, b1, name in seg if b0 <= b < b1)

    # pad: each chord as three detuned voices per note, brighter and fuller where the film lifts
    bright, level = music['bright'], music['level']
    for b0, b1, name in seg:
        bass, voicing = CHORDS[name]
        dur = T(b1 - b0) + 0.9
        n = int(dur * SR)
        env = ramp(n, 0.35 if b0 else 1.6, 0.9) * (1 + 0.07 * np.sin(TAU * 0.16 * (np.arange(n) / SR + T(b0))))
        g = keyed(level, b0)
        for note in voicing:
            for cents, pan in ((-7, -0.6), (0, 0.0), (7, 0.6)):
                f = hz(note) * 2 ** (cents / 1200)
                tab = wavetable(f, keyed(bright, b0))
                mix.add('pad', T(b0), osc(tab, f, n, rng.uniform()) * env, 0.055 * g / len(voicing) ** 0.5, pan)
        if inside('bass', b0) or inside('bass', b1 - 0.01):
            a = max(b0, next(a for a, z in parts['bass'] if a <= b1 and z >= b0))
            z = min(b1, next(z for a, z in parts['bass'] if a <= b1 and z >= b0))
            m = int((T(z - a) + 0.25) * SR)
            f = hz(bass)
            t = np.arange(m) / SR
            sig = (np.sin(TAU * f * t) + 0.28 * np.sin(TAU * 2 * f * t) + 0.1 * np.sin(TAU * 3 * f * t)) * ramp(m, 0.03, 0.25)
            mix.add('bass', T(a), sig, 0.065)

    # arpeggios: chord tones an octave above the pad, in eighths, sixteenths or quarters
    def arp(part, step, pattern, decay, gain, bright=1.0):
        for a, z in parts.get(part, []):
            b = a
            while b < z - 1e-6:
                tones = [n + 12 for n in CHORDS[chord_at(b)][1]]
                tones += [n + 12 for n in tones]
                k = int(round((b - a) / step))
                note = tones[pattern[k % len(pattern)] % len(tones)]
                accent = 1.0 if abs(b - round(b)) < 1e-6 else 0.72
                swell = 0.75 + 0.25 * (b - a) / max(1, z - a)
                mix.add('arp', T(b), pluck(hz(note), decay, bright=bright), gain * accent * swell, 0.35 * np.sin(k * 1.7))
                b += step
    arp('arp8', 0.5, [0, 2, 1, 3, 2, 4, 3, 1], 0.55, 0.075)
    arp('arp16', 0.25, [0, 2, 4, 2, 1, 3, 5, 3], 0.28, 0.06, bright=1.3)
    arp('arp4', 1.0, [0, 2, 4, 3], 1.2, 0.07, bright=0.8)

    # drums
    kicks = []
    for part, beats in (('kick2', (0, 2)), ('kick4', (0, 1, 2, 3))):
        for a, z in parts.get(part, []):
            for b in range(int(np.ceil(a)), int(np.ceil(z))):
                if b % 4 in beats:
                    mix.add('drums', T(b), kick(), 0.36)
                    kicks.append(T(b))
    for a, z in parts.get('hat', []):
        b = np.floor(a) + 0.5
        while b < z:
            mix.add('drums', T(b), hat(), 0.07, 0.3)
            b += 1.0

    # cues: what the film shows, when it shows it
    keys = cut['u']
    for c in cut['cues']:
        b = c['b'] if 'b' in c else beat_of_u(keys, c['u'])
        g = c.get('gain', 1.0)
        kind = c['kind']
        if kind == 'hit':
            mix.add('fx', T(b), impact(c['size']), 0.5 * g)
        elif kind == 'riser':
            mix.add('fx', T(b), riser(T(c['len'])), 0.16 * g)
        elif kind == 'whoosh':
            mix.add('fx', T(b), whoosh(T(c['len'])), 0.13 * g)
        elif kind == 'pluck':
            mix.add('arp', T(b), pluck(hz(c['note']), 0.9, bright=1.2), 0.16 * g)
        elif kind == 'bell':
            mix.add('bell', T(b), bell(hz(c['note'])), 0.13 * g, -0.2)
            mix.add('bell', T(b), bell(hz(c['note'] - 12)), 0.05 * g, 0.2)
        elif kind == 'count':
            # a run up through the chord's tones, one per sixteenth, landing on the hit
            steps = int(round(c['len'] * 4))
            for i in range(steps):
                pool = sorted({n + 12 * o for n in CHORDS[chord_at(b + i / 4)][1] for o in (1, 2, 3)} & set(range(69, 104)))
                note = pool[round(i * (len(pool) - 1) / max(1, steps - 1))]
                mix.add('arp', T(b + i / 4), pluck(hz(note), 0.22, bright=1.4), 0.05 + 0.07 * i / steps, 0.5 * np.sin(i))
        elif kind == 'fire':
            mix.add('fx', T(b), fire(), 0.32 * g)
        elif kind == 'drought':
            mix.add('fx', T(b), drought(), 0.3 * g)

    # mixdown: the kick ducks the pad and bass, a hall reverb glues the parts
    t = np.arange(mix.n) / SR
    duck = np.ones(mix.n)
    for tk in kicks:
        i = int(tk * SR)
        m = min(int(0.4 * SR), mix.n - i)
        duck[i:i + m] = np.minimum(duck[i:i + m], 1 - 0.32 * np.exp(-np.arange(m) / SR / 0.15))
    for k in ('pad', 'bass'):
        if k in mix.bus:
            mix.bus[k] *= duck
    sends = {'pad': 0.35, 'arp': 0.32, 'bell': 0.5, 'fx': 0.22, 'drums': 0.06, 'bass': 0.0}
    dry = sum(mix.bus.values())
    send = sum(mix.bus[k] * sends[k] for k in mix.bus)
    # delay on the arpeggios: dotted eighths, ping-pong
    if 'arp' in mix.bus:
        d = int(0.75 * spb * SR)
        for i, g in enumerate((0.3, 0.14, 0.06), 1):
            src = mix.bus['arp'][(i + 1) % 2]
            dry[i % 2, d * i:] += src[:mix.n - d * i] * g
    ir = reverb_ir()
    wet = np.stack([convolve(send[ch], ir[ch]) for ch in range(2)])
    out = dry + 0.85 * wet
    out = np.stack([shape(ch, lo=28) for ch in out])
    # the closing fade follows the picture
    f0, f1 = (T(b) for b in cut['fade'])
    out *= np.clip((f1 - t) / (f1 - f0), 0, 1) ** 1.5
    out /= np.abs(out).max()
    out = np.tanh(1.5 * out) / np.tanh(1.5) * 10 ** (-1 / 20)
    return out, mix.bus


def loudness(x):
    """Integrated loudness in LUFS, roughly as ITU-R BS.1770 weighs it (no gating)."""
    f = np.maximum(np.fft.rfftfreq(x.shape[-1], 1 / SR), 1e-3)
    k = (1 + (10 ** 0.2 - 1) * f ** 2 / (f ** 2 + 1500 ** 2)) / np.sqrt(1 + (38 / f) ** 4)
    ms = sum(np.mean(np.fft.irfft(np.fft.rfft(ch) * k, x.shape[-1]) ** 2) for ch in np.atleast_2d(x))
    return -0.691 + 10 * np.log10(ms + 1e-20)


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').T.copy()
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'carbonglobe-score.wav')
    cut = json.load(open(os.path.join(ROOT, 'assets', 'film', 'cut.json')))
    x, buses = score(cut)
    write_wav(out_path, x)
    print(f'{out_path}: {x.shape[1] / SR:.2f} s, {loudness(x):.1f} LUFS, peak {20 * np.log10(np.abs(x).max()):.1f} dBFS')
    print('parts (relative LUFS):', {k: round(loudness(v), 1) for k, v in buses.items()})


if __name__ == '__main__':
    main()
