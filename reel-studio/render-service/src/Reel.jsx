import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill, Sequence, OffthreadVideo, Img, Audio, Loop,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
  continueRender, delayRender,
} from 'remotion';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/900.css';
import '@fontsource/lalezar/400.css';
import { computeTimeline, captionChunks } from './timeline';

const DEFAULT_THEME = {
  primary: '#FFD400',      // highlight colour (active word, hook box accents, progress bar)
  text: '#FFFFFF',
  dark: '#0B0B0F',
  captionFont: 'Vazirmatn',
  displayFont: 'Lalezar',  // hook + CTA headline
  captionStyle: 'pop',     // pop | box | clean
  captionY: 0.64,          // vertical position of captions (0..1), above Instagram's bottom UI
};

const useFonts = () => {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    const families = ['900 60px Vazirmatn', '700 60px Vazirmatn', '400 60px Lalezar'];
    Promise.all(families.map((f) => document.fonts.load(f, 'سلام'))).then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);
};

// ---------- media layer ----------
const SceneMedia = ({ media, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punch = interpolate(frame, [0, 8], [1.09, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  if (!media || !media.url) {
    return <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 35%, #2a2a35, #0b0b0f)' }} />;
  }
  if (media.type === 'image') {
    const kb = interpolate(frame, [0, frames], [1, 1.13]);
    const dx = interpolate(frame, [0, frames], [0, media.panX || -30]);
    return (
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img src={media.url} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb * punch}) translateX(${dx}px)` }} />
      </AbsoluteFill>
    );
  }
  // video: slow a short clip down (cinematic) instead of looping, but never below 0.6x; loop if still too short.
  const clipFrames = Math.round((Number(media.duration) || frames / fps) * fps);
  const rate = Math.max(0.6, Math.min(1, clipFrames / frames));
  const playable = Math.max(1, Math.floor(clipFrames / rate));
  const video = (
    <OffthreadVideo src={media.url} muted playbackRate={rate} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${punch})` }} />
  );
  return <AbsoluteFill style={{ overflow: 'hidden' }}>{playable < frames ? <Loop durationInFrames={playable}>{video}</Loop> : video}</AbsoluteFill>;
};

const Shade = () => (
  <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 45%, rgba(0,0,0,.65) 100%)' }} />
);

// ---------- captions ----------
const Captions = ({ text, durationSec, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chunks = captionChunks(text, durationSec, fps);
  const chunk = chunks.find((c) => frame >= c.start && frame < c.end);
  if (!chunk) return null;
  const local = frame - chunk.start;
  const pop = spring({ frame: local, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });
  const boxed = theme.captionStyle === 'box';
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', top: `${theme.captionY * 100}%` }}>
      <div style={{
        direction: 'rtl', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 18px', maxWidth: 900,
        transform: `scale(${0.85 + 0.15 * pop}) translateY(${(1 - pop) * 24}px)`,
        background: boxed ? 'rgba(0,0,0,.72)' : 'none', padding: boxed ? '18px 28px' : 0, borderRadius: 22,
      }}>
        {chunk.words.map((w, i) => {
          const active = frame >= w.start && frame < w.end && theme.captionStyle !== 'clean';
          return (
            <span key={i} style={{
              fontFamily: theme.captionFont, fontWeight: 900, fontSize: 84, lineHeight: 1.25,
              color: active ? theme.dark : theme.text,
              background: active ? theme.primary : 'transparent', borderRadius: 14, padding: '0 14px',
              WebkitTextStroke: active || boxed ? '0' : '10px #000', paintOrder: 'stroke fill',
              textShadow: active ? 'none' : '0 6px 18px rgba(0,0,0,.55)',
              transform: active ? 'scale(1.06)' : 'none', display: 'inline-block',
            }}>{w.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- hook card (first seconds) ----------
const HookCard = ({ hook, theme, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame, fps, config: { damping: 12, stiffness: 180 } });
  const out = interpolate(frame, [frames - 6, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const words = String(hook.text || '').split(' ');
  const hi = new Set(String(hook.highlight || '').split(' ').filter(Boolean));
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', top: '-14%', opacity: out }}>
      <div style={{
        direction: 'rtl', maxWidth: 940, padding: '34px 44px', background: '#fff', borderRadius: 28,
        boxShadow: '0 30px 80px rgba(0,0,0,.45)', transform: `rotate(-2deg) scale(${0.6 + 0.4 * inS})`, textAlign: 'center',
      }}>
        <div style={{ fontFamily: theme.displayFont, fontSize: 92, lineHeight: 1.35, color: theme.dark }}>
          {words.map((w, i) => (
            <span key={i} style={{ background: hi.has(w) ? theme.primary : 'none', borderRadius: 12, padding: hi.has(w) ? '0 10px' : 0 }}>{w}{i < words.length - 1 ? ' ' : ''}</span>
          ))}
        </div>
        {hook.subtext ? <div style={{ fontFamily: theme.captionFont, fontWeight: 700, fontSize: 44, color: '#444', marginTop: 10 }}>{hook.subtext}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ---------- scene label (e.g. «اشتباه ۱») ----------
const Label = ({ text, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 15 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', top: '13%' }}>
      <div style={{
        direction: 'rtl', fontFamily: theme.captionFont, fontWeight: 900, fontSize: 58, color: theme.dark, background: theme.primary,
        padding: '10px 34px', borderRadius: 999, transform: `translateY(${(1 - s) * -40}px)`, opacity: s, boxShadow: '0 12px 30px rgba(0,0,0,.35)',
      }}>{text}</div>
    </AbsoluteFill>
  );
};

// ---------- CTA end card ----------
const CtaCard = ({ cta, brand, theme, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 13 } });
  const b = spring({ frame: frame - 8, fps, config: { damping: 13 } });
  const pulse = 1 + 0.04 * Math.sin((frame / fps) * Math.PI * 2.2);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 30%, #23232e, ${theme.dark})`, justifyContent: 'center', alignItems: 'center', direction: 'rtl' }}>
      {brand.logoUrl ? <Img src={brand.logoUrl} style={{ width: 220, height: 220, objectFit: 'contain', borderRadius: 40, marginBottom: 40, transform: `scale(${a})` }} /> : null}
      <div style={{ fontFamily: theme.displayFont, fontSize: 96, color: theme.text, textAlign: 'center', maxWidth: 920, lineHeight: 1.3, transform: `translateY(${(1 - a) * 60}px)`, opacity: a }}>{cta.text}</div>
      {cta.sub ? <div style={{ fontFamily: theme.captionFont, fontWeight: 700, fontSize: 48, color: '#cfcfd6', marginTop: 24, textAlign: 'center', maxWidth: 880, opacity: b }}>{cta.sub}</div> : null}
      {brand.handle ? (
        <div style={{ marginTop: 60, fontFamily: theme.captionFont, fontWeight: 900, fontSize: 54, color: theme.dark, background: theme.primary, padding: '18px 48px', borderRadius: 999, transform: `scale(${b * pulse})`, direction: 'ltr' }}>{brand.handle}</div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------- composition ----------
export const Reel = ({ spec }) => {
  useFonts();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = { ...DEFAULT_THEME, ...(spec.theme || {}) };
  const brand = spec.brand || {};
  const tl = computeTimeline(spec);
  const hook = spec.hook && spec.hook.text ? spec.hook : null;
  const firstFrames = tl.scenes[0] ? tl.scenes[0].frames : 0;
  const hookFrames = hook ? Math.min(firstFrames, Math.round((Number(hook.duration) || 2.8) * fps)) : 0;
  const music = spec.music && spec.music.url ? spec.music : null;
  const inCta = tl.cta && frame >= tl.cta.from;

  return (
    <AbsoluteFill style={{ background: theme.dark }}>
      {tl.scenes.map(({ index, from, frames, scene }) => (
        <Sequence key={index} from={from} durationInFrames={frames} name={`scene-${index + 1}`}>
          <SceneMedia media={scene.media} frames={frames} />
          <Shade />
          {scene.voice && scene.voice.url ? <Audio src={scene.voice.url} volume={Number(scene.voice.volume) || 1} /> : null}
          {scene.label ? <Label text={scene.label} theme={theme} /> : null}
          {index === 0 && hook ? null : <Captions text={scene.caption || scene.voice?.text || ''} durationSec={Number(scene.voice && scene.voice.duration) || frames / fps} theme={theme} />}
          {index === 0 && hook && firstFrames > hookFrames ? (
            <Sequence from={hookFrames} durationInFrames={firstFrames - hookFrames}>
              {/* rest of scene 1 after the hook card: captions resume, offset so timing stays aligned with the voice */}
              <CaptionsOffset text={scene.caption || ''} durationSec={Number(scene.voice && scene.voice.duration) || firstFrames / fps} offset={hookFrames} theme={theme} />
            </Sequence>
          ) : null}
        </Sequence>
      ))}

      {hook ? (
        <Sequence from={0} durationInFrames={hookFrames} name="hook">
          <HookCard hook={hook} theme={theme} frames={hookFrames} />
        </Sequence>
      ) : null}

      {tl.cta ? (
        <Sequence from={tl.cta.from} durationInFrames={tl.cta.frames} name="cta">
          <CtaCard cta={spec.cta} brand={brand} theme={theme} frames={tl.cta.frames} />
          {spec.cta.voice && spec.cta.voice.url ? <Audio src={spec.cta.voice.url} /> : null}
        </Sequence>
      ) : null}

      {/* progress bar + watermark */}
      {!inCta ? (
        <AbsoluteFill>
          <div style={{ position: 'absolute', top: 0, right: 0, height: 10, width: `${(frame / durationInFrames) * 100}%`, background: theme.primary }} />
          {brand.logoUrl ? <Img src={brand.logoUrl} style={{ position: 'absolute', top: 60, left: 50, width: 120, height: 120, objectFit: 'contain', opacity: 0.92 }} /> : null}
          {!brand.logoUrl && brand.name ? <div style={{ position: 'absolute', top: 60, left: 50, fontFamily: theme.captionFont, fontWeight: 900, fontSize: 40, color: '#fff', opacity: 0.9, textShadow: '0 3px 12px rgba(0,0,0,.6)' }}>{brand.name}</div> : null}
        </AbsoluteFill>
      ) : null}

      {music ? (
        <Audio src={music.url} loop volume={(f) => (tl.cta && f >= tl.cta.from ? Number(music.ctaVolume) || 0.35 : Number(music.volume) || 0.1)} />
      ) : null}
    </AbsoluteFill>
  );
};

// Captions for the part of scene 1 that comes after the hook card: same chunk timing as the full voice, shifted.
const CaptionsOffset = ({ text, durationSec, offset, theme }) => (
    <Sequence from={-offset} layout="none">
      <Captions text={text} durationSec={durationSec} theme={theme} />
    </Sequence>
);
