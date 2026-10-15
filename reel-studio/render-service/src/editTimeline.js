// Timing for the footage-edit composition: kept segments of the source clips are laid end to end;
// words (source time) are mapped onto the output timeline so captions follow the real voice.
const FPS = 30;

const buildEdit = (spec) => {
  const fps = spec.fps || FPS;
  let t = 0;
  const segments = (spec.segments || []).filter((s) => Number(s.end) > Number(s.start)).map((s, i) => {
    const dur = Number(s.end) - Number(s.start);
    const seg = { index: i, clip: Number(s.clip) || 0, start: Number(s.start), end: Number(s.end), out: t, dur, zoom: Number(s.zoom) || 1 };
    t += dur;
    return seg;
  });
  const videoSec = t;
  const words = [];
  for (const w of spec.words || []) {
    const clip = Number(w.clip) || 0;
    const seg = segments.find((s) => s.clip === clip && w.start >= s.start - 0.05 && w.end <= s.end + 0.12);
    if (!seg) continue;
    const start = seg.out + Math.max(0, w.start - seg.start);
    const end = Math.min(seg.out + seg.dur, seg.out + (w.end - seg.start));
    words.push({ text: String(w.text), start, end: Math.max(end, start + 0.08) });
  }
  const ctaSec = spec.cta && spec.cta.text ? Number(spec.cta.duration) || 3 : 0;
  return { fps, segments, words, videoSec, ctaSec, totalFrames: Math.max(fps, Math.round((videoSec + ctaSec) * fps)) };
};

// Caption chunks: up to 3 words, broken at punctuation or pauses; each chunk stays until the next starts (if the gap is short).
const editChunks = (words) => {
  const chunks = [];
  let cur = [];
  words.forEach((w, i) => {
    const next = words[i + 1];
    cur.push(w);
    const punct = /[.!?؟،,:؛…]$/.test(w.text);
    const gap = next ? next.start - w.end : 99;
    if (cur.length >= 3 || punct || gap > 0.3 || !next) { chunks.push(cur); cur = []; }
  });
  return chunks.map((ws, i) => {
    const nextChunk = chunks[i + 1];
    const end = ws[ws.length - 1].end;
    const holdTo = nextChunk && nextChunk[0].start - end < 0.4 ? nextChunk[0].start : end + 0.15;
    return { start: ws[0].start, end: holdTo, words: ws };
  });
};

module.exports = { buildEdit, editChunks };
