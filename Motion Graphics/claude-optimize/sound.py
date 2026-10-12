"""Synthesizes the SFX + music bed for claude-optimize-top.mp4.
Event times mirror the timeline in index.html (seek()).
Usage: python3 sound.py  -> writes sfx.wav (effects only) and mix.wav (effects + music)
"""
import wave
import numpy as np

SR = 48000
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def t_(d):
    return np.arange(int(SR * d)) / SR


def env(d, a=0.005, decay=8.0):
    t = t_(d)
    return np.minimum(1, t / a) * np.exp(-t * decay)


def lowpass(x, cut):
    """One-pole lowpass; cut may be scalar or per-sample array (Hz)."""
    cut = np.broadcast_to(np.asarray(cut, float), x.shape)
    k = 1 - np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    return y


def sweep(f0, f1, d, shape=np.sin):
    f = np.geomspace(f0, f1, int(SR * d))
    return shape(2 * np.pi * np.cumsum(f) / SR)


def add(buf, sig, at, gain=1.0):
    i = int(at * SR)
    j = min(len(buf), i + len(sig))
    if j <= i:
        return
    buf[i:j] += sig[: j - i] * gain


# ---------- SFX primitives ----------
def whoosh(d=0.55, up=True):
    n = int(SR * d)
    x = rng.standard_normal(n)
    p = np.linspace(0, 1, n)
    cut = (300 + 5000 * (p if up else 1 - p) ** 1.5)
    bell = np.sin(np.pi * p) ** 2
    y = lowpass(x, cut) - lowpass(x, 150)
    return y * bell * 0.9


def click():
    n = int(SR * 0.04)
    noise = rng.standard_normal(n) * env(0.04, 0.0005, 180)
    tone = np.sin(2 * np.pi * 2400 * t_(0.04)) * env(0.04, 0.0005, 90)
    return (noise - lowpass(noise, 2000)) * 0.6 + tone * 0.35


def key():
    f = rng.uniform(1800, 3200)
    n = int(SR * 0.03)
    noise = rng.standard_normal(n) * env(0.03, 0.0003, 260)
    return (noise - lowpass(noise, 1500)) * 0.35 + np.sin(2 * np.pi * f * t_(0.03)) * env(0.03, 0.0003, 200) * 0.12


def pop(f0=900, f1=280, d=0.12):
    return sweep(f0, f1, d) * env(d, 0.002, 30)


def bubble():
    return sweep(380, 1100, 0.14) * env(0.14, 0.002, 22)


def note(f, d=1.0, decay=4.0, harm=(1, 0.35, 0.12)):
    t = t_(d)
    s = sum(a * np.sin(2 * np.pi * f * (h + 1) * t) for h, a in enumerate(harm))
    return s * env(d, 0.004, decay)


def chime(freqs, gap=0.09):
    out = np.zeros(int(SR * (1.4 + gap * len(freqs))))
    for i, f in enumerate(freqs):
        add(out, note(f, 1.3, 3.5), i * gap, 0.5)
    return out


def boom():
    d = 0.7
    return sweep(110, 38, d) * env(d, 0.003, 5) * 1.2


def alarm():
    """Two short distorted buzz pulses (warning)."""
    out = np.zeros(int(SR * 0.6))
    for i in range(2):
        t = t_(0.18)
        sq = np.tanh(4 * np.sin(2 * np.pi * 330 * t)) + 0.5 * np.tanh(4 * np.sin(2 * np.pi * 333 * t))
        add(out, sq * env(0.18, 0.004, 9) * 0.35, i * 0.24)
    return out


def power_down(d=1.25):
    t = t_(d)
    trem = 0.6 + 0.4 * np.sin(2 * np.pi * 14 * t)
    return sweep(700, 160, d, lambda ph: np.sign(np.sin(ph)) * 0.3 + np.sin(ph) * 0.7) * trem * np.linspace(1, 0.4, len(t)) * 0.25


def riser(d=1.3):
    n = int(SR * d)
    p = np.linspace(0, 1, n)
    tone = sweep(250, 1400, d) * p ** 1.5 * 0.35
    noise = rng.standard_normal(n)
    noise = (lowpass(noise, 600 + 6000 * p) - lowpass(noise, 300)) * p ** 2 * 0.5
    return tone + noise


def sparkle():
    out = np.zeros(int(SR * 0.9))
    for i in range(7):
        f = rng.uniform(2200, 4200)
        add(out, np.sin(2 * np.pi * f * t_(0.25)) * env(0.25, 0.002, 18) * 0.25, i * 0.07)
    return out


def drop(d=0.9):
    return sweep(900, 260, d) * env(d, 0.01, 2.5) * 0.3


# ---------- SFX timeline (matches index.html) ----------
sfx = np.zeros(N)
add(sfx, whoosh(0.5), 0.0, 0.5)
add(sfx, pop(), 0.12, 0.35)                  # label
add(sfx, power_down(), 0.6)                  # battery drain 100 -> 50
add(sfx, boom(), 1.8, 0.45)                   # "از دست میدی!"
add(sfx, alarm(), 1.82, 0.8)
add(sfx, whoosh(0.4, up=False), 2.9, 0.35)
add(sfx, pop(700, 250), 3.2, 0.45)           # condition line + toggle

add(sfx, whoosh(0.6), 5.0, 0.7)              # scene: app window
add(sfx, whoosh(0.35), 5.3, 0.3)             # header 1
for c in (6.3, 7.55, 9.7, 11.2, 15.95):      # cursor clicks
    add(sfx, click(), c, 0.8)
add(sfx, pop(1200, 600, 0.08), 6.75, 0.3)    # menu opens
add(sfx, whoosh(0.4), 7.8, 0.45)             # view -> settings
add(sfx, whoosh(0.35), 8.1, 0.3)             # header 2
add(sfx, whoosh(0.3), 9.95, 0.25)            # panel slide
add(sfx, whoosh(0.35), 10.5, 0.3)            # header 3
tk = 11.5
while tk < 14.4:                             # prompt typing
    add(sfx, key(), tk, 0.9)
    tk += rng.uniform(0.045, 0.085)
add(sfx, pop(600, 900, 0.1), 14.7, 0.4)      # lock badge
add(sfx, chime([1046.5, 1568.0]), 16.0, 0.45)  # Saved

add(sfx, whoosh(0.6), 16.7, 0.7)             # scene: result
add(sfx, chime([784.0, 1046.5, 1318.5], 0.08), 17.0, 0.6)  # "و تمام!"
add(sfx, pop(), 18.0, 0.4)                   # power card
add(sfx, riser(), 18.6, 0.8)                 # gauge 50 -> 100
add(sfx, boom(), 19.9, 0.35)                  # 2x
add(sfx, pop(500, 1200, 0.15), 19.9, 0.5)
add(sfx, sparkle(), 19.95, 0.8)
add(sfx, pop(), 20.4, 0.4)                   # token card
add(sfx, drop(), 21.3, 0.8)                  # usage bar shrinks
add(sfx, chime([1318.5, 1760.0], 0.07), 22.1, 0.35)

add(sfx, whoosh(0.6), 23.1, 0.7)             # scene: CTA
add(sfx, pop(), 23.4, 0.35)
add(sfx, pop(700, 300), 23.8, 0.4)
for i in range(5):                           # typing "بهینه"
    add(sfx, key(), 24.75 + i * 0.2, 1.2)
add(sfx, whoosh(0.3), 25.95, 0.5)            # send
add(sfx, click(), 25.95, 0.6)
add(sfx, bubble(), 26.2, 0.5)                # comment posted
add(sfx, bubble(), 26.7, 0.6)                # heart
add(sfx, sparkle(), 26.75, 0.5)
add(sfx, pop(800, 350), 26.9, 0.45)          # CTA text
add(sfx, whoosh(0.4, up=False), 27.35, 0.35)  # arrow

# ---------- music bed: Am - F - C - G, 100 bpm ----------
BPM = 100
beat = 60 / BPM
bar = beat * 4
music = np.zeros(N)
chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (130.81, 196.0, 261.63), (196.0, 246.94, 293.66)]


def pad(freqs, d):
    t = t_(d)
    s = sum(np.sin(2 * np.pi * f * t) + np.sin(2 * np.pi * f * 1.004 * t) for f in freqs)
    a = np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.6)
    return s * a * 0.05


def kick():
    return sweep(150, 45, 0.25) * env(0.25, 0.002, 14)


def hat():
    n = int(SR * 0.05)
    x = rng.standard_normal(n)
    return (x - lowpass(x, 6000)) * env(0.05, 0.0005, 70) * 0.2


tb, ci = 0.0, 0
while tb < DUR:
    ch = chords[ci % 4]
    add(music, pad(ch, bar + 0.3), tb)
    arp = [ch[0] * 2, ch[1] * 2, ch[2] * 2, ch[1] * 2]
    for k in range(8):                         # eighth-note pluck arpeggio
        add(music, note(arp[k % 4], 0.5, 9, (1, 0.2)), tb + k * beat / 2, 0.07)
    if tb >= 4.0:                              # light beat after the hook
        for k in range(4):
            add(music, kick(), tb + k * beat, 0.35 if k % 2 == 0 else 0.0)
            add(music, hat(), tb + k * beat + beat / 2, 0.6)
    tb += bar
    ci += 1
fade = np.ones(N)
fade[-int(SR * 1.5):] = np.linspace(1, 0, int(SR * 1.5))
fade[: int(SR * 0.3)] = np.linspace(0, 1, int(SR * 0.3))
music *= fade
# duck music slightly under the busiest SFX moments
duck = np.ones(N)
for a, b in ((1.7, 2.6), (19.8, 20.6)):
    duck[int(a * SR):int(b * SR)] = 0.55
music *= lowpass(duck, 8)


def save(name, x):
    x = np.tanh(2.0 * x / max(1e-9, np.abs(x).max()))  # soft compression
    x = x / np.abs(x).max() * 0.89                     # -1 dBFS peak
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    st = np.repeat(pcm[:, None], 2, axis=1)
    with wave.open(name, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(st.tobytes())


m_peak = np.abs(music).max()
save("sfx.wav", sfx)
save("mix.wav", sfx / np.abs(sfx).max() + music / m_peak * 0.32)
print("ok")
