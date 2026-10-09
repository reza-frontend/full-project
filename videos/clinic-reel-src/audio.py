import json, sys, wave
import numpy as np

SR = 44100
ev = json.load(open(sys.argv[1]))
D = ev['duration']
N = int(SR * D)
rng = np.random.default_rng(7)
out = np.zeros((N, 2))

def lowpass(x, a):  # one-pole, a in (0,1): smaller = darker
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s += a * (x[i] - s); y[i] = s
    return y

def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    out[i:i + len(sig), 0] += sig * (1 - pan) ** 0.5 * 1.0
    out[i:i + len(sig), 1] += sig * (1 + pan) ** 0.5 * 1.0

def env(n, att, rel):
    t = np.arange(n) / SR
    return np.minimum(1, t / att) * np.exp(-t / rel)

# --- music: 96 bpm, Am - F - C - G pads, soft kick + hats + pluck arp
bpm = 96; beat = 60 / bpm; bar = beat * 4
chords = [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]]
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
t_all = np.arange(N) / SR
pad = np.zeros(N)
nb = int(D / bar) + 1
for b in range(nb):
    s, e = int(b * bar * SR), min(N, int((b + 1) * bar * SR) + int(0.4 * SR))
    if s >= N: break
    tt = t_all[s:e] - b * bar
    a = np.minimum(1, tt / 0.6) * np.minimum(1, np.maximum(0, (bar + 0.4 - tt) / 0.6))
    for m in chords[b % 4]:
        f = hz(m - 12)
        pad[s:e] += a * (np.sin(2*np.pi*f*tt) + 0.5*np.sin(2*np.pi*f*1.003*tt + 1) + 0.25*np.sin(2*np.pi*2*f*tt))
    # bass
    f = hz(chords[b % 4][0] - 24)
    pad[s:e] += 1.4 * a * np.sin(2*np.pi*f*tt)
pad = lowpass(pad, 0.08)
pad /= np.abs(pad).max()
out[:, 0] += pad * 0.22; out[:, 1] += pad * 0.22

kick_n = int(0.35 * SR); kt = np.arange(kick_n) / SR
kick = np.sin(2*np.pi*(50*kt + 60*(1-np.exp(-kt*30))/30)) * np.exp(-kt*9)
hat = rng.standard_normal(int(0.05*SR)); hat = (hat - lowpass(hat, 0.5)) * env(len(hat), 0.001, 0.012)
arp_notes = lambda b: [chords[b % 4][j % 3] + 12 * (j // 3) for j in range(6)]
music_start, music_fade = 0.0, D - 2.5
k = 0; tb = 0.0
while tb < D:
    b = int(tb / bar); pos = k % 8
    if tb > 3.6 and tb < 50.4:
        if pos in (0, 4) or (pos == 6 and b % 2): add(kick, tb, 0.35)
        if pos % 2 == 1: add(hat, tb, 0.10, 0.3)
    if tb > 0.0:
        m = arp_notes(b)[pos % 6]; n = int(0.4*SR); tt = np.arange(n)/SR
        pl = (np.sin(2*np.pi*hz(m+12)*tt) + 0.3*np.sin(2*np.pi*hz(m+24)*tt)) * env(n, 0.003, 0.12)
        add(pl, tb, 0.06, -0.4 if pos % 2 else 0.4)
    tb += beat / 2; k += 1

# --- sfx
def ping(f0, f1, dur=0.25):
    n = int(dur*SR); tt = np.arange(n)/SR
    f = f0 + (f1-f0)*np.minimum(1, tt/0.04)
    return np.sin(2*np.pi*np.cumsum(f)/SR) * env(n, 0.002, 0.07)
def whoosh(dur=0.8):
    n = int(dur*SR); x = rng.standard_normal(n)
    a = np.linspace(0.02, 0.25, n) ** 1.5
    y = np.empty(n); s = 0.0
    for i in range(n):
        s += a[i]*(x[i]-s); y[i] = s
    sh = np.sin(np.pi*np.arange(n)/n) ** 2
    return y * sh / (np.abs(y).max() + 1e-9)
def tick():
    n = int(0.03*SR); x = rng.standard_normal(n)
    return (x - lowpass(x, 0.3)) * env(n, 0.0005, 0.006)

W = whoosh()
for t in ev['cam']: add(W, max(0, t - 0.1), 0.22)
for t in ev['act']: add(ping(660, 880, 0.2), t, 0.16)
for t in ev['done']: add(ping(1320, 1760, 0.3), t, 0.12, 0.2)
for t in ev['pop']: add(ping(500, 1000, 0.25), t, 0.15)
for t in ev['type']: add(tick(), t, 0.25 + 0.1*rng.random(), rng.uniform(-.3, .3))

# master: fade in/out, normalize
fade = np.ones(N)
fi = int(0.3*SR); fade[:fi] = np.linspace(0, 1, fi)
fo = int(2.0*SR); fade[-fo:] = np.linspace(1, 0, fo)
out *= fade[:, None]
out = np.tanh(out * 1.2)
out *= 0.85 / np.abs(out).max()
pcm = (out * 32767).astype('<i2')
with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', sys.argv[2], D)
