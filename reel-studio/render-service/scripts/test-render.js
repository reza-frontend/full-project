// Local smoke test: makes synthetic clips/audio with ffmpeg, uploads them, renders the sample spec, prints the result.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3900';
const KEY = process.env.API_KEY;
const tmp = fs.mkdtempSync('/tmp/reeltest-');
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

const upload = async (file, ext) => {
  const r = await fetch(`${BASE}/api/assets/upload?ext=${ext}`, { method: 'POST', headers: { 'x-api-key': KEY, 'content-type': 'application/octet-stream' }, body: fs.readFileSync(file) });
  return r.json();
};

(async () => {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'sample-spec.json'), 'utf8'));
  const sources = ['mandelbrot=s=1080x1920', 'life=s=1080x1920:mold=10:r=30:ratio=0.1:death_color=#C83232:life_color=#00ff00', 'cellauto=s=1080x1920:rule=110'];
  for (let i = 0; i < spec.scenes.length; i++) {
    const s = spec.scenes[i];
    const v = path.join(tmp, `v${i}.mp4`);
    const a = path.join(tmp, `a${i}.mp3`);
    ff(['-f', 'lavfi', '-i', sources[i % sources.length], '-t', '3', '-pix_fmt', 'yuv420p', v]);
    ff(['-f', 'lavfi', '-i', `sine=frequency=${300 + i * 120}:duration=${s.voice.duration}`, '-af', 'volume=0.2', a]);
    const va = await upload(v, 'mp4');
    const aa = await upload(a, 'mp3');
    s.media = { type: 'video', url: va.url, duration: va.duration };
    s.voice = { ...s.voice, url: aa.url, duration: aa.duration };
  }
  const r = await fetch(`${BASE}/api/render`, { method: 'POST', headers: { 'x-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ spec }) });
  const job = await r.json();
  console.log('queued', job.id);
  for (;;) {
    await new Promise((res) => setTimeout(res, 3000));
    const st = await (await fetch(`${BASE}/api/render/${job.id}`, { headers: { 'x-api-key': KEY } })).json();
    process.stdout.write(`\r${st.status} ${st.progress}%   `);
    if (st.status === 'done' || st.status === 'failed') { console.log('\n', st); break; }
  }
})();
