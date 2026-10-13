// Shared timing math: used by calculateMetadata (total length) and by the Reel component (scene/caption placement).
const FPS = 30;

const sceneSeconds = (s) => {
  const voice = Number(s.voice && s.voice.duration) || 0;
  const min = Number(s.minDuration) || 2.5;
  return Math.min(15, Math.max(min, voice ? voice + 0.3 : min));
};

const computeTimeline = (spec) => {
  const fps = spec.fps || FPS;
  let cursor = 0;
  const scenes = (spec.scenes || []).map((s, i) => {
    const frames = Math.round(sceneSeconds(s) * fps);
    const item = { index: i, from: cursor, frames, scene: s };
    cursor += frames;
    return item;
  });
  const ctaFrames = spec.cta && spec.cta.text ? Math.round((Number(spec.cta.duration) || 3) * fps) : 0;
  const cta = ctaFrames ? { from: cursor, frames: ctaFrames } : null;
  return { fps, scenes, cta, total: Math.max(fps, cursor + ctaFrames) };
};

// Splits spoken text into short caption chunks (max 3 words, breaks at punctuation) and times them
// proportionally to their length across the voice duration. Each word gets its own start/end too.
const captionChunks = (text, durationSec, fps) => {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || !durationSec) return [];
  const chunks = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const punct = /[.!?؟،,:؛…]$/.test(w);
    if (cur.length >= 3 || punct || i === words.length - 1) { chunks.push(cur); cur = []; }
  });
  const weight = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2;
  const total = words.reduce((a, w) => a + weight(w), 0);
  const perUnit = (durationSec * fps) / total;
  let t = 0;
  return chunks.map((ws) => {
    const start = t;
    const timed = ws.map((w) => { const s = t; t += weight(w) * perUnit; return { text: w, start: Math.round(s), end: Math.round(t) }; });
    return { start: Math.round(start), end: Math.round(t), words: timed };
  });
};

module.exports = { FPS, computeTimeline, captionChunks, sceneSeconds };
