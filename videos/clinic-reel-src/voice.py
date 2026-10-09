"""Persian voiceover via Gemini TTS: one clip per caption, time-fitted into its slot.
Usage: GEMINI_API_KEY=... python3 voice.py  -> writes voice.wav (24 kHz mono, full video length)
"""
import base64, json, os, re, subprocess, sys, urllib.request, wave

KEY = os.environ['GEMINI_API_KEY']
MODEL = os.environ.get('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts')
VOICE = os.environ.get('GEMINI_VOICE', 'Charon')
SR = 24000
here = os.path.dirname(os.path.abspath(__file__))
TL = json.loads(subprocess.check_output(['node', '-e', f"console.log(JSON.stringify(require('{here}/timeline.js')))"]))

def tts(text):
    body = {"contents": [{"parts": [{"text": "با لحن صمیمی، پرانرژی و طبیعی مثل گوینده‌ی ریلز اینستاگرام، به فارسی بگو: " + text}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    return base64.b64decode(r["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])  # s16le 24k mono

def fit(pcm, slot, path):
    """trim silence, speed up only if longer than slot (max 1.35x)."""
    raw = path + '.raw'; open(raw, 'wb').write(pcm)
    trim = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', raw, '-af', trim, path + '.t.wav'], check=True)
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path + '.t.wav']))
    tempo = min(1.35, max(1.0, dur / (slot - 0.12)))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path + '.t.wav', '-af', f'atempo={tempo:.3f}', '-ar', str(SR), path], check=True)
    return dur / tempo, tempo

os.makedirs('vo', exist_ok=True)
total = bytearray(int(TL['duration'] * SR) * 2)
for i, (t0, t1, text) in enumerate(TL['caps']):
    clean = re.sub(r'\*', '', text).replace('n8n', 'اِن‌اِیت‌اِن')
    path = f'vo/{i:02d}.wav'
    d, tempo = fit(tts(clean), t1 - t0, path)
    print(f'{i:02d} {t0:5.1f}-{t1:5.1f} slot {t1-t0:.2f}s  voice {d:.2f}s  x{tempo:.2f}  {clean}')
    with wave.open(path) as w: data = w.readframes(w.getnframes())
    off = int(t0 * SR) * 2
    total[off:off + len(data)] = data[: len(total) - off]
with wave.open('voice.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(total))
print('wrote voice.wav')
