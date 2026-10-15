// Reel render service: stores media assets and renders reels with Remotion. Called only by the REEL_* n8n workflows.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { bundle } = require('@remotion/bundler');
const { selectComposition, renderMedia } = require('@remotion/renderer');

const PORT = Number(process.env.PORT || 3900);
const API_KEY = process.env.API_KEY || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const CONCURRENCY = process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null;
const BROWSER = process.env.BROWSER_EXECUTABLE || null;
const LOCAL = `http://127.0.0.1:${PORT}`;
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 1500) * 1024 * 1024;
const STT_MODEL = process.env.STT_MODEL || 'elevenlabs/scribe-v2';

if (!API_KEY) { console.error('API_KEY env is required'); process.exit(1); }
const ASSETS = path.join(DATA_DIR, 'assets');
const OUT = path.join(DATA_DIR, 'renders');
fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const app = express();
app.use('/files', express.static(ASSETS, { maxAge: '7d' }));
app.use('/renders', express.static(OUT, { maxAge: '7d' }));
// Persian font for the n8n panel page.
app.use('/static/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource', 'vazirmatn', 'files'), { maxAge: '30d' }));
app.get('/health', (req, res) => res.json({ ok: true, bundled: !!serveUrl, queue: queue.length, rendering: current }));

// Direct upload of large phone videos from the panel page. The panel gets a short-lived ticket from n8n:
// token = md5(API_KEY + ':' + exp), so the render key itself never reaches the browser.
const validTicket = (exp, token) => Number(exp) * 1000 > Date.now() && token === crypto.createHash('md5').update(`${API_KEY}:${exp}`).digest('hex');

app.post('/upload/video', (req, res) => {
  if (!validTicket(req.query.exp, req.query.token)) return res.status(401).json({ error: 'upload ticket expired or invalid' });
  const ext = String(req.query.ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!['mp4', 'mov', 'm4v', 'webm', 'mkv', '3gp'].includes(ext)) return res.status(400).json({ error: 'unsupported video type' });
  const id = `${crypto.randomUUID()}.${ext}`;
  const file = path.join(ASSETS, id);
  const out = fs.createWriteStream(file);
  let bytes = 0;
  req.on('data', (c) => {
    bytes += c.length;
    if (bytes > MAX_UPLOAD) { req.unpipe(out); out.destroy(); fs.rm(file, () => {}); res.status(413).json({ error: 'file too large' }); req.destroy(); }
  });
  req.pipe(out);
  out.on('finish', async () => {
    if (res.headersSent) return;
    const meta = await probe(file);
    if (!meta.has_video) { fs.rm(file, () => {}); return res.status(400).json({ error: 'not a video file' }); }
    res.json({ id, url: `${PUBLIC_URL}/files/${id}`, bytes, ...meta });
  });
  out.on('error', (e) => { if (!res.headersSent) res.status(500).json({ error: String(e.message || e) }); });
});

app.use('/api', (req, res, next) => {
  if (req.get('x-api-key') !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
});

const probe = (file) => new Promise((resolve) => {
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], (err, out) => {
    if (err) return resolve({});
    try {
      const j = JSON.parse(out);
      const v = (j.streams || []).find((s) => s.codec_type === 'video');
      resolve({ duration: Number(j.format && j.format.duration) || null, width: v ? v.width : null, height: v ? v.height : null, has_video: !!v, has_audio: (j.streams || []).some((s) => s.codec_type === 'audio') });
    } catch (e) { resolve({}); }
  });
});

const EXT_BY_TYPE = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const saveAsset = async (buf, contentType, extHint) => {
  const ext = (extHint || EXT_BY_TYPE[(contentType || '').split(';')[0]] || 'bin').replace(/[^a-z0-9]/gi, '');
  const id = `${crypto.randomUUID()}.${ext}`;
  const file = path.join(ASSETS, id);
  fs.writeFileSync(file, buf);
  const meta = await probe(file);
  return { id, url: `${PUBLIC_URL}/files/${id}`, bytes: buf.length, content_type: contentType || null, ...meta };
};

// Downloads (or POSTs to) any URL and stores the response as an asset.
// auth: "openrouter" adds the OpenRouter key server-side (video downloads, text-to-speech).
const fetchToAsset = async ({ url, method = 'GET', headers = {}, body, auth, ext }) => {
  if (!url) throw Object.assign(new Error('url required'), { status: 400 });
  const h = { ...headers };
  if (auth === 'openrouter') {
    if (!/^https:\/\/openrouter\.ai\//.test(url)) throw Object.assign(new Error('openrouter auth only for openrouter.ai urls'), { status: 400 });
    h.Authorization = `Bearer ${OPENROUTER_API_KEY}`;
  }
  if (body !== undefined) h['Content-Type'] = h['Content-Type'] || 'application/json';
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), signal: AbortSignal.timeout(180000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok) return await saveAsset(buf, r.headers.get('content-type'), ext);
      lastErr = Object.assign(new Error(`upstream ${r.status}: ${buf.toString('utf8').slice(0, 600)}`), { status: 502 });
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) {
      lastErr = Object.assign(new Error(String(e.message || e)), { status: 502 });
    }
    await new Promise((res) => setTimeout(res, attempt * 3000));
  }
  throw lastErr;
};

app.post('/api/assets/fetch', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    res.json(await fetchToAsset(req.body || {}));
  } catch (e) {
    res.status(e.status || 502).json({ error: String(e.message || e) });
  }
});

// Batch version: { items: [{ key, url, method, body, auth, ext }] } -> { results: [{ key, ok, asset | error }] }.
// Runs up to 4 downloads at a time; one failure never fails the whole batch. "meta" is echoed back unchanged.
app.post('/api/assets/fetch-many', express.json({ limit: '5mb' }), async (req, res) => {
  const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const it = items[i] || {};
      try {
        results[i] = { key: it.key ?? i, ok: true, asset: await fetchToAsset(it) };
      } catch (e) {
        results[i] = { key: it.key ?? i, ok: false, error: String(e.message || e).slice(0, 800) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  res.json({ results, meta: (req.body || {}).meta ?? null });
});

// Raw upload (body = file bytes). ?ext=png
app.post('/api/assets/upload', express.raw({ type: () => true, limit: '300mb' }), async (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty body' });
  res.json(await saveAsset(req.body, req.get('content-type'), req.query.ext));
});

// Base64 upload from the n8n panel (images are downscaled in the browser first). { data, ext }
app.post('/api/assets/upload-b64', express.json({ limit: '40mb' }), async (req, res) => {
  const { data, ext } = req.body || {};
  const b64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) return res.status(400).json({ error: 'data required' });
  const allowed = ['png', 'jpg', 'jpeg', 'webp', 'mp3', 'm4a', 'wav', 'mp4', 'mov'];
  const e = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!allowed.includes(e)) return res.status(400).json({ error: `ext must be one of ${allowed.join(', ')}` });
  res.json(await saveAsset(Buffer.from(b64, 'base64'), null, e));
});

app.post('/api/assets/probe', express.json(), async (req, res) => {
  const id = path.basename(String((req.body || {}).id || ''));
  const file = path.join(ASSETS, id);
  if (!id || !fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.json({ id, ...(await probe(file)) });
});

// ---------- footage: prepare + transcribe ----------
const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(-1500))) : resolve(stdout)));
});

// Normalises a phone clip: upright, 30fps constant frame rate, H.264 (max 1080 wide for vertical), loudness-normalised voice,
// plus a small mono mp3 for speech-to-text.
app.post('/api/prepare', express.json(), async (req, res) => {
  const id = path.basename(String((req.body || {}).id || ''));
  const src = path.join(ASSETS, id);
  if (!id || !fs.existsSync(src)) return res.status(404).json({ error: 'source not found' });
  const base = crypto.randomUUID();
  const vid = `${base}.mp4`, aud = `${base}.mp3`;
  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src,
      '-vf', "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)',fps=30,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart',
      '-af', 'highpass=f=70,loudnorm=I=-15:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      path.join(ASSETS, vid)]);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(ASSETS, vid), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', path.join(ASSETS, aud)]);
    const vm = await probe(path.join(ASSETS, vid));
    const am = await probe(path.join(ASSETS, aud));
    res.json({ video: { id: vid, url: `${PUBLIC_URL}/files/${vid}`, ...vm }, audio: { id: aud, url: `${PUBLIC_URL}/files/${aud}`, ...am } });
  } catch (e) {
    res.status(500).json({ error: 'prepare failed: ' + String(e.message || e) });
  }
});

// Speech-to-text with word timestamps through OpenRouter. Returns { text, words: [{ text, start, end }], duration, cost }.
app.post('/api/transcribe', express.json(), async (req, res) => {
  const { id, language = 'fa', model } = req.body || {};
  const file = path.join(ASSETS, path.basename(String(id || '')));
  if (!id || !fs.existsSync(file)) return res.status(404).json({ error: 'audio not found' });
  const body = {
    model: model || STT_MODEL,
    input_audio: { data: fs.readFileSync(file).toString('base64'), format: path.extname(file).slice(1) || 'mp3' },
    language, response_format: 'verbose_json', timestamp_granularities: ['word', 'segment'],
  };
  try {
    let j = null, lastErr = '';
    for (let attempt = 1; attempt <= 3 && !j; attempt++) {
      const r = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) });
      const t = await r.text();
      if (r.ok) { j = JSON.parse(t); break; }
      lastErr = `transcription ${r.status}: ${t.slice(0, 600)}`;
      if (r.status < 500 && r.status !== 429) break;
      await new Promise((ok) => setTimeout(ok, attempt * 4000));
    }
    if (!j) return res.status(502).json({ error: lastErr });
    let words = (j.words || []).map((w) => ({ text: String(w.word ?? w.text ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
      .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && !/^\s*$/.test(w.text) && (w.type ? w.type === 'word' : true));
    // Provider without word timestamps: spread each segment's words over its time range.
    if (!words.length && Array.isArray(j.segments)) {
      for (const sg of j.segments) {
        const ws = String(sg.text || '').trim().split(/\s+/).filter(Boolean);
        const len = ws.reduce((a, w) => a + w.length + 1, 0) || 1;
        let t = Number(sg.start) || 0; const span = (Number(sg.end) || t) - t;
        for (const w of ws) { const d = span * (w.length + 1) / len; words.push({ text: w, start: t, end: t + d }); t += d; }
      }
    }
    res.json({ text: j.text || words.map((w) => w.text).join(' '), words, duration: j.duration || null, cost: (j.usage && j.usage.cost) || 0, word_timestamps: !!(j.words && j.words.length) });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// ---------- rendering ----------
let serveUrl = null;
const jobs = new Map();
const queue = [];
let current = null;

// Spec URLs may point at our own /files: rewrite them to localhost so the renderer never goes through the public proxy.
const localize = (v) => {
  if (typeof v === 'string') {
    if (v.startsWith(`${PUBLIC_URL}/files/`)) return LOCAL + v.slice(PUBLIC_URL.length);
    if (v.startsWith('asset:')) return `${LOCAL}/files/${path.basename(v.slice(6))}`;
    return v;
  }
  if (Array.isArray(v)) return v.map(localize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x)]));
  return v;
};

const notify = async (job) => {
  if (!job.webhook) return;
  try {
    await fetch(job.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(publicJob(job)) });
  } catch (e) { console.error('webhook failed', e.message); }
};

const publicJob = (j) => ({ id: j.id, status: j.status, progress: j.progress, url: j.url || null, duration: j.duration || null, error: j.error || null, ref: j.ref || null, created_at: j.created_at, finished_at: j.finished_at || null });

const runNext = async () => {
  if (current || !queue.length || !serveUrl) return;
  const job = jobs.get(queue.shift());
  current = job.id;
  job.status = 'rendering';
  const outFile = path.join(OUT, `${job.id}.mp4`);
  try {
    const inputProps = { spec: localize(job.spec) };
    const composition = await selectComposition({ serveUrl, id: job.composition, inputProps, browserExecutable: BROWSER, timeoutInMilliseconds: 120000 });
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: outFile, inputProps,
      crf: 18, pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 92, audioBitrate: '192k',
      concurrency: CONCURRENCY, browserExecutable: BROWSER, timeoutInMilliseconds: 120000,
      onProgress: ({ progress }) => { job.progress = Math.round(progress * 100); },
    });
    job.status = 'done';
    job.progress = 100;
    job.url = `${PUBLIC_URL}/renders/${job.id}.mp4`;
    job.duration = composition.durationInFrames / composition.fps;
  } catch (e) {
    job.status = 'failed';
    job.error = String(e.message || e).slice(0, 1500);
    console.error('render failed', job.id, e);
  }
  job.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `${job.id}.json`), JSON.stringify(publicJob(job)));
  current = null;
  notify(job);
  runNext();
};

app.post('/api/render', express.json({ limit: '5mb' }), (req, res) => {
  const { spec, webhook, ref } = req.body || {};
  const composition = (req.body || {}).composition === 'Edit' ? 'Edit' : 'Reel';
  if (composition === 'Reel' && (!spec || !Array.isArray(spec.scenes) || !spec.scenes.length)) return res.status(400).json({ error: 'spec.scenes required' });
  if (composition === 'Edit' && (!spec || !Array.isArray(spec.segments) || !spec.segments.length)) return res.status(400).json({ error: 'spec.segments required' });
  const id = crypto.randomUUID();
  const job = { id, spec, composition, webhook: webhook || null, ref: ref || null, status: 'queued', progress: 0, created_at: new Date().toISOString() };
  jobs.set(id, job);
  queue.push(id);
  runNext();
  res.status(202).json(publicJob(job));
});

app.get('/api/render/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) return res.json(publicJob(job));
  const file = path.join(OUT, `${path.basename(req.params.id)}.json`);
  if (fs.existsSync(file)) return res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  res.status(404).json({ error: 'not found' });
});

// Deletes assets and renders older than RETENTION_DAYS, once a day.
const cleanup = () => {
  const limit = Date.now() - RETENTION_DAYS * 86400000;
  for (const dir of [ASSETS, OUT]) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p); } catch (e) { /* ignore */ }
    }
  }
};
setInterval(cleanup, 86400000);

const server = app.listen(PORT, async () => {
  console.log(`reel render service on :${PORT} (${PUBLIC_URL})`);
  serveUrl = await bundle({ entryPoint: path.join(__dirname, 'src', 'index.js') });
  console.log('bundle ready');
  runNext();
});
// Keep idle connections open longer than typical client pools so reused sockets are not closed mid-upload.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
