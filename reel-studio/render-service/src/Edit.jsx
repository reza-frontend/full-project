import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill, Sequence, OffthreadVideo, Img, Audio,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
  continueRender, delayRender,
} from 'remotion';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/900.css';
import '@fontsource/lalezar/400.css';
import { buildEdit, editChunks } from './editTimeline';

const DEFAULT_THEME = { primary: '#FFD400', text: '#FFFFFF', dark: '#0B0B0F', captionFont: 'Vazirmatn', displayFont: 'Lalezar', captionStyle: 'pop', captionY: 0.66, frame: 'none' };

const useFonts = () => {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    Promise.all(['900 60px Vazirmatn', '700 60px Vazirmatn', '400 60px Lalezar'].map((f) => document.fonts.load(f, 'سلام')))
      .then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);
};

const ease = (frame, fps, delay = 0) => spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 190, mass: 0.7 } });
const fadeOut = (frame, frames, len = 6) => interpolate(frame, [frames - len, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

// ---------- footage ----------
const Segment = ({ seg, clip, fps }) => {
  const frame = useCurrentFrame();
  const frames = Math.max(1, Math.round(seg.dur * fps));
  const drift = interpolate(frame, [0, frames], [0, 0.025]);
  const scale = seg.zoom + drift;
  const landscape = clip.width && clip.height && clip.width > clip.height;
  const common = { src: clip.url, startFrom: Math.round(seg.start * fps), endAt: Math.round(seg.end * fps) };
  if (!landscape) {
    return (
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <OffthreadVideo {...common} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <OffthreadVideo {...common} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(.55)', transform: 'scale(1.2)' }} />
      <AbsoluteFill style={{ justifyContent: 'center' }}>
        <OffthreadVideo {...common} style={{ width: '100%', objectFit: 'contain', transform: `scale(${scale})` }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const CutFlash = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 4], [0.55, 0], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: '#fff', opacity: o }} />;
};

const Shade = () => <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 52%, rgba(0,0,0,.55) 100%)' }} />;

// ---------- captions (exact word timing) ----------
const Captions = ({ chunks, theme, fps }) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  const chunk = chunks.find((c) => t >= c.start && t < c.end);
  if (!chunk) return null;
  const pop = ease(Math.round((t - chunk.start) * fps), fps);
  const boxed = theme.captionStyle === 'box';
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', top: `${theme.captionY * 100}%` }}>
      <div style={{ direction: 'rtl', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 16px', maxWidth: 920, transform: `scale(${0.86 + 0.14 * pop})`, background: boxed ? 'rgba(0,0,0,.72)' : 'none', padding: boxed ? '16px 26px' : 0, borderRadius: 22 }}>
        {chunk.words.map((w, i) => {
          const active = t >= w.start && t < w.end + 0.05 && theme.captionStyle !== 'clean';
          return (
            <span key={i} style={{ fontFamily: theme.captionFont, fontWeight: 900, fontSize: 80, lineHeight: 1.25, color: active ? theme.dark : theme.text, background: active ? theme.primary : 'transparent', borderRadius: 14, padding: '0 12px', WebkitTextStroke: active || boxed ? '0' : '10px #000', paintOrder: 'stroke fill', textShadow: active ? 'none' : '0 6px 18px rgba(0,0,0,.5)', transform: active ? 'scale(1.06)' : 'none', display: 'inline-block' }}>{w.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- graphics templates ----------
const TopSlot = ({ children, top = '12%' }) => <AbsoluteFill style={{ alignItems: 'center', top, direction: 'rtl' }}>{children}</AbsoluteFill>;

const Hook = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = ease(frame, fps);
  const hi = new Set(String(g.highlight || '').split(' ').filter(Boolean));
  return (
    <TopSlot top="11%">
      <div style={{ maxWidth: 940, padding: '26px 38px', background: '#fff', borderRadius: 26, boxShadow: '0 26px 70px rgba(0,0,0,.45)', transform: `rotate(-2deg) scale(${0.6 + 0.4 * s})`, opacity: fadeOut(frame, frames), textAlign: 'center' }}>
        <div style={{ fontFamily: theme.displayFont, fontSize: 80, lineHeight: 1.35, color: theme.dark }}>
          {String(g.text || '').split(' ').map((w, i) => <span key={i} style={{ background: hi.has(w) ? theme.primary : 'none', borderRadius: 10, padding: hi.has(w) ? '0 8px' : 0 }}>{w} </span>)}
        </div>
      </div>
    </TopSlot>
  );
};

const Label = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = ease(frame, fps);
  return (
    <TopSlot top="13%">
      <div style={{ fontFamily: theme.captionFont, fontWeight: 900, fontSize: 56, color: theme.dark, background: theme.primary, padding: '10px 34px', borderRadius: 999, transform: `translateY(${(1 - s) * -40}px)`, opacity: s * fadeOut(frame, frames), boxShadow: '0 12px 30px rgba(0,0,0,.35)' }}>{g.text}</div>
    </TopSlot>
  );
};

const LowerThird = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = ease(frame, fps); const s2 = ease(frame, fps, 6);
  const o = fadeOut(frame, frames, 8);
  return (
    <AbsoluteFill style={{ top: '47%', right: 60, alignItems: 'flex-end', direction: 'rtl' }}>
      <div style={{ overflow: 'hidden', borderRadius: 18, opacity: o }}>
        <div style={{ background: theme.primary, color: theme.dark, fontFamily: theme.captionFont, fontWeight: 900, fontSize: 54, padding: '12px 30px', transform: `translateX(${(1 - s) * 110}%)` }}>{g.title || g.text}</div>
        {g.subtitle ? <div style={{ background: 'rgba(0,0,0,.78)', color: '#fff', fontFamily: theme.captionFont, fontWeight: 700, fontSize: 38, padding: '8px 30px', transform: `translateX(${(1 - s2) * 110}%)` }}>{g.subtitle}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const toFa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const Counter = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const target = Number(g.value) || 0;
  const p = interpolate(frame, [0, Math.min(frames - 6, fps * 1.2)], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const v = Number.isInteger(target) ? Math.round(target * p) : (target * p).toFixed(1);
  const s = ease(frame, fps);
  return (
    <TopSlot top="12%">
      <div style={{ textAlign: 'center', background: 'rgba(0,0,0,.72)', borderRadius: 30, padding: '18px 48px', transform: `scale(${0.7 + 0.3 * s})`, opacity: fadeOut(frame, frames), border: `4px solid ${theme.primary}` }}>
        <div style={{ fontFamily: theme.displayFont, fontSize: 150, lineHeight: 1.1, color: theme.primary }}>{g.prefix || ''}{toFa(v)}{g.suffix || ''}</div>
        {g.text ? <div style={{ fontFamily: theme.captionFont, fontWeight: 900, fontSize: 46, color: '#fff' }}>{g.text}</div> : null}
      </div>
    </TopSlot>
  );
};

const Checklist = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const items = (g.items || []).slice(0, 5);
  const step = Math.max(8, Math.floor((frames - 10) / Math.max(1, items.length)));
  return (
    <TopSlot top="10%">
      <div style={{ background: 'rgba(255,255,255,.95)', borderRadius: 28, padding: '22px 34px', minWidth: 640, maxWidth: 920, opacity: fadeOut(frame, frames), boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
        {g.title ? <div style={{ fontFamily: theme.displayFont, fontSize: 58, color: theme.dark, marginBottom: 8 }}>{g.title}</div> : null}
        {items.map((it, i) => {
          const s = ease(frame, fps, i * step);
          const checked = frame > i * step + 6;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: theme.captionFont, fontWeight: 700, fontSize: 44, color: theme.dark, opacity: s, transform: `translateX(${(1 - s) * -40}px)`, margin: '6px 0' }}>
              <span style={{ width: 52, height: 52, borderRadius: 14, background: checked ? theme.primary : '#e7e7ea', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 38 }}>{checked ? '✓' : ''}</span>
              <span>{it}</span>
            </div>
          );
        })}
      </div>
    </TopSlot>
  );
};

const Compare = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = ease(frame, fps); const b = ease(frame, fps, 10);
  const box = (title, text, good, s) => (
    <div style={{ flex: 1, background: good ? 'rgba(24,160,90,.92)' : 'rgba(210,50,50,.92)', borderRadius: 24, padding: '16px 18px', color: '#fff', textAlign: 'center', transform: `scale(${0.7 + 0.3 * s})`, opacity: s }}>
      <div style={{ fontSize: 64 }}>{good ? '✅' : '❌'}</div>
      <div style={{ fontFamily: theme.displayFont, fontSize: 50 }}>{title}</div>
      {text ? <div style={{ fontFamily: theme.captionFont, fontWeight: 700, fontSize: 34, marginTop: 4 }}>{text}</div> : null}
    </div>
  );
  return (
    <TopSlot top="10%">
      <div style={{ display: 'flex', gap: 18, width: 940, opacity: fadeOut(frame, frames) }}>
        {box(g.bad_title || 'اشتباه', g.bad, false, a)}
        {box(g.good_title || 'درست', g.good, true, b)}
      </div>
    </TopSlot>
  );
};

const Sticker = ({ g, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 8, stiffness: 220 } });
  const wobble = Math.sin(frame / 4) * 6;
  const left = g.side === 'right' ? undefined : 70; const right = g.side === 'right' ? 70 : undefined;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: '40%', left, right, fontSize: 170, transform: `scale(${s}) rotate(${wobble}deg)`, opacity: fadeOut(frame, frames), filter: 'drop-shadow(0 10px 20px rgba(0,0,0,.45))' }}>{g.emoji || '🔥'}</div>
    </AbsoluteFill>
  );
};

const Keyword = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 10, stiffness: 260 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', top: '-12%' }}>
      <div style={{ fontFamily: theme.displayFont, fontSize: 150, color: theme.primary, WebkitTextStroke: '12px #000', paintOrder: 'stroke fill', transform: `scale(${0.4 + 0.6 * s}) rotate(-3deg)`, opacity: fadeOut(frame, frames), direction: 'rtl', textAlign: 'center', maxWidth: 980, lineHeight: 1.2 }}>{g.text}</div>
    </AbsoluteFill>
  );
};

const ImageCard = ({ g, theme, frames }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = ease(frame, fps);
  if (!g.url) return null;
  return (
    <TopSlot top="9%">
      <div style={{ background: '#fff', padding: 14, borderRadius: 30, boxShadow: '0 26px 70px rgba(0,0,0,.5)', transform: `translateY(${(1 - s) * -80}px) rotate(${(1 - s) * -8 + 2}deg)`, opacity: fadeOut(frame, frames) }}>
        <Img src={g.url} style={{ width: 560, height: 560, objectFit: 'cover', borderRadius: 20, display: 'block' }} />
        {g.text ? <div style={{ fontFamily: theme.captionFont, fontWeight: 900, fontSize: 44, color: theme.dark, textAlign: 'center', marginTop: 8, direction: 'rtl' }}>{g.text}</div> : null}
      </div>
    </TopSlot>
  );
};

const GRAPHICS = { hook: Hook, label: Label, lower_third: LowerThird, counter: Counter, checklist: Checklist, compare: Compare, sticker: Sticker, keyword: Keyword, image: ImageCard };

const Frame = ({ theme }) => {
  if (!theme.frame || theme.frame === 'none') return null;
  const c = theme.primary;
  const style = theme.frame === 'glow'
    ? { boxShadow: `inset 0 0 0 14px ${c}, inset 0 0 60px 20px ${c}55` }
    : { boxShadow: `inset 0 0 0 16px ${c}` };
  return <AbsoluteFill style={{ ...style, borderRadius: 0, pointerEvents: 'none' }} />;
};

const CtaCard = ({ cta, brand, theme }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = ease(frame, fps); const b = ease(frame, fps, 8);
  const pulse = 1 + 0.04 * Math.sin((frame / fps) * Math.PI * 2.2);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 30%, #23232e, ${theme.dark})`, justifyContent: 'center', alignItems: 'center', direction: 'rtl' }}>
      {brand.logoUrl ? <Img src={brand.logoUrl} style={{ width: 220, height: 220, objectFit: 'contain', borderRadius: 40, marginBottom: 40, transform: `scale(${a})` }} /> : null}
      <div style={{ fontFamily: theme.displayFont, fontSize: 92, color: '#fff', textAlign: 'center', maxWidth: 920, lineHeight: 1.3, transform: `translateY(${(1 - a) * 60}px)`, opacity: a }}>{cta.text}</div>
      {cta.sub ? <div style={{ fontFamily: theme.captionFont, fontWeight: 700, fontSize: 46, color: '#cfcfd6', marginTop: 22, textAlign: 'center', maxWidth: 880, opacity: b }}>{cta.sub}</div> : null}
      {brand.handle ? <div style={{ marginTop: 56, fontFamily: theme.captionFont, fontWeight: 900, fontSize: 52, color: theme.dark, background: theme.primary, padding: '16px 46px', borderRadius: 999, transform: `scale(${b * pulse})`, direction: 'ltr' }}>{brand.handle}</div> : null}
    </AbsoluteFill>
  );
};

export const Edit = ({ spec }) => {
  useFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = { ...DEFAULT_THEME, ...(spec.theme || {}) };
  const brand = spec.brand || {};
  const clips = spec.clips || [];
  const tl = buildEdit(spec);
  const chunks = editChunks(tl.words);
  const videoFrames = Math.round(tl.videoSec * fps);
  const inCta = frame >= videoFrames;
  const music = spec.music && spec.music.url ? spec.music : null;
  const graphics = (spec.graphics || []).filter((g) => GRAPHICS[g.type]);

  return (
    <AbsoluteFill style={{ background: theme.dark }}>
      {tl.segments.map((seg, i) => {
        const from = Math.round(seg.out * fps);
        const dur = Math.max(1, Math.round((seg.out + seg.dur) * fps) - from);
        const prev = tl.segments[i - 1];
        return (
          <Sequence key={i} from={from} durationInFrames={dur} name={`cut-${i + 1}`}>
            <Segment seg={seg} clip={clips[seg.clip] || {}} fps={fps} />
            {prev && prev.clip !== seg.clip ? <CutFlash /> : null}
          </Sequence>
        );
      })}

      {!inCta ? <Shade /> : null}

      <Sequence from={0} durationInFrames={Math.max(1, videoFrames)} name="captions">
        <Captions chunks={chunks} theme={theme} fps={fps} />
      </Sequence>

      {graphics.map((g, i) => {
        const C = GRAPHICS[g.type];
        const from = Math.max(0, Math.round((Number(g.at) || 0) * fps));
        const dur = Math.max(10, Math.min(Math.round((Number(g.duration) || 2.5) * fps), videoFrames - from));
        if (from >= videoFrames) return null;
        return <Sequence key={i} from={from} durationInFrames={dur} name={`gfx-${g.type}`}><C g={g} theme={theme} frames={dur} /></Sequence>;
      })}

      {!inCta ? (
        <AbsoluteFill>
          <Frame theme={theme} />
          <div style={{ position: 'absolute', top: 0, right: 0, height: 10, width: `${(frame / Math.max(1, videoFrames)) * 100}%`, background: theme.primary }} />
          {brand.logoUrl ? <Img src={brand.logoUrl} style={{ position: 'absolute', top: 54, left: 48, width: 110, height: 110, objectFit: 'contain', opacity: 0.92 }} /> : null}
          {!brand.logoUrl && brand.name ? <div style={{ position: 'absolute', top: 56, left: 48, fontFamily: theme.captionFont, fontWeight: 900, fontSize: 38, color: '#fff', opacity: 0.9, textShadow: '0 3px 12px rgba(0,0,0,.6)' }}>{brand.name}</div> : null}
        </AbsoluteFill>
      ) : null}

      {tl.ctaSec ? (
        <Sequence from={videoFrames} durationInFrames={Math.round(tl.ctaSec * fps)} name="cta">
          <CtaCard cta={spec.cta} brand={brand} theme={theme} />
        </Sequence>
      ) : null}

      {music ? <Audio src={music.url} loop volume={(f) => (f >= videoFrames ? Number(music.ctaVolume) || 0.3 : Number(music.volume) || 0.07)} /> : null}
    </AbsoluteFill>
  );
};
