"""Persian voiceover via Gemini TTS, time-fitted to the reel's captions.
Captions are grouped per scene (one API request per scene) to stay under free-tier rate limits.
Usage: GEMINI_API_KEY=... python voice.py  -> writes voice.wav (24 kHz mono, full video length)
Re-running reuses clips already saved in vo/ (delete vo/ to regenerate everything).
"""
import base64, json, os, re, subprocess, sys, time, urllib.error, urllib.request, wave

KEY = os.environ['GEMINI_API_KEY']
MODEL = os.environ.get('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts')
VOICE = os.environ.get('GEMINI_VOICE', 'Charon')
SR = 24000
MAX_TEMPO = 1.3
here = os.path.dirname(os.path.abspath(__file__))
TL = json.loads(subprocess.check_output(['node', '-e', f"console.log(JSON.stringify(require('{here.replace(os.sep, '/')}/timeline.js')))"]))
CAPS = TL['caps']
# caption indexes spoken together as one request (one scene each)
GROUPS = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9, 10], [11, 12, 13], [14, 15], [16, 17, 18], [19, 20], [21, 22, 23]]
STYLE = ("Read the following Persian (Farsi) text aloud as an energetic, friendly Instagram Reels narrator, "
         "at a fast, natural pace with no long pauses. Only speak the Persian text, nothing else:\n")

def tts(text):
    body = {"contents": [{"parts": [{"text": STYLE + text}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}}}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    for attempt in range(8):
        req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=180))
            return base64.b64decode(r["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])  # s16le 24k mono
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')
            if e.code not in (429, 500, 503):
                sys.exit(f"API error {e.code}: {msg[:600]}")
            if 'PerDay' in msg or 'per day' in msg.lower():
                sys.exit("Daily free quota is used up. Run again tomorrow (finished clips are kept in vo/) "
                         "or enable billing on the API key.")
            m = re.search(r'"retryDelay":\s*"(\d+)', msg)
            wait = int(m.group(1)) + 2 if m else min(90, 15 * (attempt + 1))
            print(f"   rate limited ({e.code}), waiting {wait}s ...", flush=True)
            time.sleep(wait)
    sys.exit("Gave up after repeated rate-limit errors; run again later (finished clips are kept in vo/).")

def run(*a):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *a], check=True)

def duration(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]))

os.makedirs('vo', exist_ok=True)
total = bytearray(int(TL['duration'] * SR) * 2)
prev_end = 0.0
for g, idx in enumerate(GROUPS):
    t0, t1 = CAPS[idx[0]][0], CAPS[idx[-1]][1]
    text = ' '.join(re.sub(r'\*', '', CAPS[i][2]).replace('…', '،') for i in idx).replace('n8n', 'اِن‌اِیت‌اِن')
    raw, trimmed = f'vo/{g:02d}.raw.wav', f'vo/{g:02d}.trim.wav'
    if not os.path.exists(trimmed):
        pcm = tts(text)
        open(f'vo/{g:02d}.pcm', 'wb').write(pcm)
        run('-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', f'vo/{g:02d}.pcm', raw)
        trim = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                "silenceremove=start_periods=1:start_threshold=-45dB,areverse")
        run('-i', raw, '-af', trim, trimmed)
    start = max(t0, prev_end + 0.05)
    slot = max(0.5, t1 - start - 0.1)
    d = duration(trimmed)
    tempo = min(MAX_TEMPO, max(1.0, d / slot))
    fitted = f'vo/{g:02d}.wav'
    run('-i', trimmed, '-af', f'atempo={tempo:.3f}', '-ar', str(SR), '-ac', '1', fitted)
    with wave.open(fitted) as w:
        data = w.readframes(w.getnframes())
    off = int(start * SR) * 2
    total[off:off + len(data)] = data[: max(0, len(total) - off)]
    prev_end = start + len(data) / 2 / SR
    warn = '  <-- runs past its scene' if prev_end > t1 + 0.3 else ''
    print(f'{g:02d} {t0:5.1f}-{t1:5.1f}  voice {d:.2f}s x{tempo:.2f} -> {start:5.1f}-{prev_end:5.1f}{warn}  {text}', flush=True)
    time.sleep(1)
with wave.open('voice.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(total))
print('wrote voice.wav')
