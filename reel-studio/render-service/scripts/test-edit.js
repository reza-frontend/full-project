// Local smoke test for footage editing: makes a 12s vertical clip, uploads it with a ticket, prepares it,
// then renders an Edit spec with cuts, word-timed captions and every graphics template.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3900';
const KEY = process.env.API_KEY;
const H = { 'x-api-key': KEY, 'content-type': 'application/json' };
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();

(async () => {
  const raw = fs.mkdtempSync('/tmp/edit-') + '/raw.mov';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=25', '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', raw]);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = crypto.createHash('md5').update(`${KEY}:${exp}`).digest('hex');
  const up = await (await fetch(`${BASE}/upload/video?exp=${exp}&token=${token}&ext=mov`, { method: 'POST', body: fs.readFileSync(raw) })).json();
  console.log('upload', up.id, up.duration);
  const prep = await post('/api/prepare', { id: up.id });
  console.log('prepared', prep.video && prep.video.duration, prep.error || '');
  const say = ['اگه', 'قهوه‌ی', 'خونه‌ت', 'بی‌مزه‌ست', 'این', 'سه', 'اشتباه', 'رو', 'ببین.', 'اول', 'قهوه‌ی', 'آسیاب‌شده', 'نخر،', 'عطرش', 'زود', 'می‌ره.', 'دوم', 'پاکت', 'رو', 'باز', 'نذار.', 'سوم', 'دانه', 'رو', 'تازه', 'بگیر.'];
  const words = say.map((w, i) => ({ text: w, clip: 0, start: 0.2 + i * 0.42, end: 0.2 + i * 0.42 + 0.36 }));
  const spec = {
    theme: { primary: '#FFD400', captionStyle: 'pop', frame: 'glow' },
    brand: { name: 'کافه نمونه', handle: '@sample.cafe' },
    clips: [{ url: prep.video.url, width: prep.video.width, height: prep.video.height }],
    segments: [{ clip: 0, start: 0, end: 4, zoom: 1 }, { clip: 0, start: 4.1, end: 7.2, zoom: 1.12 }, { clip: 0, start: 7.4, end: 11.4, zoom: 1 }],
    words,
    graphics: [
      { type: 'hook', at: 0, duration: 2.4, text: 'سه اشتباه قهوه‌ی خونه', highlight: 'اشتباه' },
      { type: 'counter', at: 2.5, duration: 1.6, value: 3, text: 'اشتباه رایج' },
      { type: 'label', at: 4.2, duration: 1.8, text: 'اشتباه ۱' },
      { type: 'sticker', at: 4.4, duration: 1.4, emoji: '❌', side: 'left' },
      { type: 'compare', at: 6.1, duration: 2, bad: 'پاکت باز', good: 'ظرف دربسته' },
      { type: 'checklist', at: 8.2, duration: 2.6, title: 'چک‌لیست', items: ['دانه‌ی کامل', 'ظرف دربسته', 'آسیاب لحظه‌ای'] },
      { type: 'lower_third', at: 0.4, duration: 2.2, title: 'علی رضایی', subtitle: 'مدیر کافه' },
      { type: 'keyword', at: 10.9, duration: 0.9, text: 'تازه!' },
    ],
    cta: { text: 'کلمه‌ی قهوه رو کامنت کن', sub: 'راهنمای انتخاب دانه رو می‌فرستیم', duration: 3 },
  };
  const job = await post('/api/render', { composition: 'Edit', spec });
  console.log('queued', job.id || job);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await (await fetch(`${BASE}/api/render/${job.id}`, { headers: H })).json();
    if (st.status === 'done' || st.status === 'failed') { console.log(st); break; }
  }
})();
