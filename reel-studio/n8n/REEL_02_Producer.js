import { workflow, node, trigger, ifElse, switchCase, expr } from '@n8n/workflow-sdk';

const PG = { postgres: { id: 'EOQuXqKL8wvzLD9W', name: 'Nutrident Postgres' } };
const OR = { openRouterApi: { id: 'ezncqeNDdAAKn59E', name: 'OpenRouter' } };
const renderHeaders = { parameters: [{ name: 'x-api-key', value: expr("{{ $('Plan Production').first().json.render_key }}") }] };

const start = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1, config: { name: 'Producer Trigger', parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'project_id', type: 'number' }] } } } });

const startProduction = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Start Production', credentials: PG, parameters: { operation: 'executeQuery', query: "WITH up AS (\n  UPDATE reel.projects SET status = 'producing', error = NULL, updated_at = now()\n  WHERE id = $1::bigint AND storyboard IS NOT NULL AND status IN ('script_ready', 'failed', 'review', 'rejected', 'producing')\n  RETURNING *\n)\nSELECT row_to_json(up) AS project,\n  (SELECT row_to_json(k) FROM reel.kits k WHERE k.id = up.kit_id) AS kit,\n  (SELECT json_object_agg(key, value) FROM reel.settings) AS settings\nFROM up", options: { queryReplacement: expr('{{ [$json.project_id] }}') } } } });

const planProduction = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Plan Production', onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode: `// One voice-over per scene (+ CTA), all fetched by the render service in one batch call.
const row = $input.first().json;
const p = row.project, k = row.kit || {}, st = row.settings || {};
if (!st.render_url) throw new Error('render_url is not set in reel.settings');
const sb = p.storyboard || {};
const scenes = Array.isArray(sb.scenes) ? sb.scenes : [];
if (!scenes.length) throw new Error('storyboard has no scenes');
const model = k.quality === 'premium' ? st.video_model_premium : st.video_model_standard;
const tts = (key, text) => ({ key, url: 'https://openrouter.ai/api/v1/audio/speech', method: 'POST', auth: 'openrouter', ext: 'mp3', body: { model: st.tts_model, input: String(text || '').trim(), voice: k.voice || 'adam', response_format: 'mp3' } });
const items = scenes.map((s, i) => tts('s' + i, s.voiceover));
if (sb.cta && sb.cta.voiceover) items.push(tts('cta', sb.cta.voiceover));
return [{ json: { project_id: p.id, render_url: st.render_url.replace(/\\/$/, ''), render_key: st.render_key, model, max_cost: Number(st.max_cost_per_video_usd) || 6, items } }];` } } });

const makeVoices = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Make Voices', onError: 'continueErrorOutput', parameters: { method: 'POST', url: expr('{{ $json.render_url }}/api/assets/fetch-many'), sendHeaders: true, headerParameters: renderHeaders, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ items: $json.items }) }}'), options: { timeout: 600000 } } } });

const planVideos = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Plan Videos', onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode: `// Builds one video request per scene: clip length follows the voice-over, real kit photos become the first frame.
const plan = $('Plan Production').first().json;
const row = $('Start Production').first().json;
const sb = row.project.storyboard, k = row.kit || {};
const res = $input.first().json.results || [];
const byKey = Object.fromEntries(res.map(r => [r.key, r]));
const bad = res.filter(r => !r.ok && r.key !== 'cta');
if (bad.length) throw new Error('voice-over failed: ' + bad.map(f => f.key + ': ' + f.error).join(' | ').slice(0, 600));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const CAPS = {
  'kwaivgi/kling-v3.0-std': { res: '720p', durs: range(3, 15), price: 0.084 },
  'kwaivgi/kling-v3.0-pro': { res: '720p', durs: range(3, 15), price: 0.112 },
  'google/veo-3.1-fast': { res: '1080p', durs: [4, 6, 8], price: 0.10 },
  'google/veo-3.1': { res: '1080p', durs: [4, 6, 8], price: 0.20 },
  'minimax/hailuo-3-max': { res: '768p', durs: range(5, 15), price: 0.08 },
  'alibaba/wan-3.0': { res: '1080p', durs: range(2, 30), price: 0.20 },
};
const cap = CAPS[plan.model] || { res: '720p', durs: [5, 10], price: 0.15 };
const pick = sec => cap.durs.find(d => d >= sec) || cap.durs[cap.durs.length - 1];
const images = Array.isArray(k.images) ? k.images : [];
let est = 0;
const out = sb.scenes.map((s, i) => {
  const voice = byKey['s' + i].asset;
  const duration = pick(Math.ceil(Math.min(15, (voice.duration || 4) + 0.4)));
  est += duration * cap.price;
  const ui = Number(s.use_image);
  const img = Number.isInteger(ui) && ui >= 0 && images[ui] ? images[ui].url : null;
  const request = {
    model: plan.model,
    prompt: String(s.visual_prompt || '').trim() + '. Look: ' + (k.visual_style || 'cinematic, natural light') + '. Vertical 9:16 frame, main subject centered with space at top and bottom, smooth natural motion, realistic. No text, no letters, no subtitles, no logos, no watermark.',
    duration, resolution: cap.res, aspect_ratio: '9:16', generate_audio: false,
  };
  if (img) request.frame_images = [{ type: 'image_url', image_url: { url: img }, frame_type: 'first_frame' }];
  return { json: { idx: i, voice: { id: voice.id, url: voice.url, duration: voice.duration }, request, image_url: img } };
});
if (est > plan.max_cost) throw new Error('estimated video cost $' + est.toFixed(2) + ' is above the $' + plan.max_cost + ' limit (max_cost_per_video_usd)');
return out;` } } });

const submitVideo = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Submit Video', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, parameters: { method: 'POST', url: 'https://openrouter.ai/api/v1/videos', authentication: 'predefinedCredentialType', nodeCredentialType: 'openRouterApi', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify($json.request) }}'), options: { timeout: 60000, response: { response: { neverError: true } } } }, credentials: OR } });

const collectJobs = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Collect Jobs', parameters: { mode: 'runOnceForAllItems', jsCode: `const plans = $('Plan Videos').all().map(i => i.json);
const subs = $input.all().map(i => i.json);
const cta = ($('Make Voices').first().json.results || []).find(r => r.key === 'cta');
const scenes = plans.map((p, i) => {
  const r = subs[i] || {};
  const ok = !!r.id;
  return { idx: p.idx, voice: p.voice, image_url: p.image_url, model: p.request.model, duration: p.request.duration, job_id: r.id || null, status: ok ? (r.status || 'pending') : 'failed', error: ok ? null : String((r.error && (r.error.message || r.error)) || JSON.stringify(r)).slice(0, 300), cost: 0 };
});
return [{ json: { assets: { scenes, cta_voice: cta && cta.ok ? cta.asset : null, polls: 0 } } }];` } } });

const saveJobs = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Save Jobs', credentials: PG, parameters: { operation: 'executeQuery', query: 'UPDATE reel.projects SET assets = $2::jsonb, updated_at = now() WHERE id = $1::bigint RETURNING id', options: { queryReplacement: expr("{{ [$('Producer Trigger').first().json.project_id, JSON.stringify($json.assets)] }}") } } } });

const waitClips = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Wait For Clips', parameters: { resume: 'timeInterval', amount: 30, unit: 'seconds' } } });

const loadJobs = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Load Jobs', executeOnce: true, credentials: PG, parameters: { operation: 'executeQuery', query: 'SELECT assets FROM reel.projects WHERE id = $1::bigint', options: { queryReplacement: expr("{{ [$('Producer Trigger').first().json.project_id] }}") } } } });

const jobsToPoll = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Jobs To Poll', parameters: { mode: 'runOnceForAllItems', jsCode: `return ($input.first().json.assets.scenes || []).map(s => ({ json: s }));` } } });

const pollVideo = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Poll Video', parameters: { method: 'GET', url: expr('https://openrouter.ai/api/v1/videos/{{ $json.job_id || "none" }}'), authentication: 'predefinedCredentialType', nodeCredentialType: 'openRouterApi', options: { timeout: 30000, response: { response: { neverError: true } } } }, credentials: OR } });

const trackJobs = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Track Jobs', parameters: { mode: 'runOnceForAllItems', jsCode: `// Merges this poll round into the saved job list; ready when every clip is finished or after ~20 minutes.
const a = $('Load Jobs').first().json.assets;
const polls = $input.all().map(i => i.json);
const TERMINAL = ['completed', 'failed', 'cancelled', 'expired'];
a.scenes = a.scenes.map((s, i) => {
  if (TERMINAL.includes(s.status) || !s.job_id) return s;
  const r = polls[i] || {};
  const st = r.status || s.status;
  const n = Object.assign({}, s, { status: st });
  if (st === 'completed') {
    n.content_url = (r.unsigned_urls || [])[0] || ('https://openrouter.ai/api/v1/videos/' + s.job_id + '/content?index=0');
    n.cost = (r.usage && r.usage.cost) || 0;
  }
  if (['failed', 'cancelled', 'expired'].includes(st)) n.error = String(r.error || st).slice(0, 300);
  return n;
});
a.polls = (a.polls || 0) + 1;
const done = a.scenes.every(s => TERMINAL.includes(s.status) || !s.job_id);
const timedOut = a.polls >= 40;
if (timedOut && !done) a.scenes = a.scenes.map(s => TERMINAL.includes(s.status) ? s : Object.assign({}, s, { status: 'failed', error: 'timeout' }));
return [{ json: { assets: a, ready: done || timedOut } }];` } } });

const savePoll = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Save Poll', credentials: PG, parameters: { operation: 'executeQuery', query: 'UPDATE reel.projects SET assets = $2::jsonb, updated_at = now() WHERE id = $1::bigint RETURNING id, assets, $3::boolean AS ready', options: { queryReplacement: expr("{{ [$('Producer Trigger').first().json.project_id, JSON.stringify($json.assets), $json.ready] }}") } } } });

const clipsReady = ifElse({ version: 2.2, config: { name: 'Clips Ready?', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.ready }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } } } });

const downloadClips = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Download Clips', onError: 'continueErrorOutput', parameters: { method: 'POST', url: expr("{{ $('Plan Production').first().json.render_url }}/api/assets/fetch-many"), sendHeaders: true, headerParameters: renderHeaders, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ meta: { assets: $json.assets }, items: $json.assets.scenes.filter(s => s.status === "completed" && s.content_url).map(s => ({ key: "c" + s.idx, url: s.content_url, auth: "openrouter", ext: "mp4" })) }) }}'), options: { timeout: 900000 } } } });

const buildSpec = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Build Spec', onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode: `// Turns storyboard + generated assets into the render-service spec. A scene whose clip failed falls back to a kit photo or a neighbouring clip.
const row = $('Start Production').first().json;
const k = row.kit || {}, sb = row.project.storyboard || {};
const assets = $json.meta.assets;
const clip = Object.fromEntries(($json.results || []).filter(r => r.ok).map(r => [r.key, r.asset]));
const images = Array.isArray(k.images) ? k.images : [];
let cost = 0;
const scenes = assets.scenes.map((s, i) => {
  cost += Number(s.cost) || 0;
  const c = clip['c' + s.idx];
  const media = c ? { type: 'video', url: c.url, duration: c.duration } : (s.image_url ? { type: 'image', url: s.image_url } : null);
  const sc = sb.scenes[i] || {};
  return { label: sc.label || '', caption: sc.voiceover || '', voice: { url: s.voice.url, duration: s.voice.duration }, media };
});
const okClips = Object.keys(clip).length;
if (!okClips && !images.length) throw new Error('no clip was generated: ' + assets.scenes.map(s => s.error).filter(Boolean).join(' | ').slice(0, 500));
let last = scenes.find(s => s.media) ? scenes.find(s => s.media).media : (images[0] ? { type: 'image', url: images[0].url } : null);
scenes.forEach(s => { if (s.media) last = s.media; else s.media = last; });
// Hook card stays on screen while the narrator says the hook: its share of scene 1's text times scene 1's voice length.
const hookText = sb.hook && sb.hook.text ? String(sb.hook.text) : '';
const len = s => String(s || '').replace(/\\s+/g, '').length;
const s1 = scenes[0] || {};
const hookDur = hookText ? Math.min(5, Math.max(1.6, (s1.voice.duration || 3) * Math.min(1, len(hookText) / Math.max(1, len(s1.caption))) + 0.2)) : 0;
const cv = assets.cta_voice;
const spec = {
  theme: k.theme || {},
  brand: { name: k.brand_name || '', handle: k.handle || '', logoUrl: k.logo_url || '' },
  hook: hookText ? { text: hookText, highlight: sb.hook.highlight || '', duration: hookDur } : null,
  scenes,
  cta: sb.cta && sb.cta.text ? { text: sb.cta.text, sub: sb.cta.sub || '', voice: cv ? { url: cv.url, duration: cv.duration } : null, duration: Math.max(3, (cv ? cv.duration : 0) + 0.8) } : null,
};
if (k.music_url) spec.music = { url: k.music_url, volume: 0.09 };
return [{ json: { spec, cost, failed_scenes: assets.scenes.filter(s => !clip['c' + s.idx]).map(s => ({ idx: s.idx, error: s.error })) } }];` } } });

const startRender = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Start Render', onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, parameters: { method: 'POST', url: expr("{{ $('Plan Production').first().json.render_url }}/api/render"), sendHeaders: true, headerParameters: renderHeaders, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ spec: $json.spec, ref: String($('Producer Trigger').first().json.project_id) }) }}"), options: { timeout: 30000 } } } });

const saveRender = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Save Render', credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET status = 'rendering', render_id = $2, cost_usd = $3::numeric, updated_at = now() WHERE id = $1::bigint RETURNING id, render_id", options: { queryReplacement: expr("{{ [$('Producer Trigger').first().json.project_id, $json.id, $('Build Spec').first().json.cost || 0] }}") } } } });

const waitRender = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Wait Render', parameters: { resume: 'timeInterval', amount: 15, unit: 'seconds' } } });

const renderStatus = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Render Status', onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, parameters: { method: 'GET', url: expr("{{ $('Plan Production').first().json.render_url }}/api/render/{{ $json.render_id || $json.id }}"), sendHeaders: true, headerParameters: renderHeaders, options: { timeout: 30000 } } } });

const renderDone = switchCase({ version: 3.2, config: { name: 'Render Done?', parameters: { rules: { values: [
  { outputKey: 'done', renameOutput: true, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'done' }], combinator: 'and' } },
  { outputKey: 'failed', renameOutput: true, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'failed' }], combinator: 'and' } },
] }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'Still Rendering' } } } });

const finish = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Finish Project', credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET status = 'review', video_url = $2, error = NULLIF($3, ''), updated_at = now() WHERE id = $1::bigint RETURNING id, video_url, title, caption", options: { queryReplacement: expr("{{ [$('Producer Trigger').first().json.project_id, $json.url, ($('Build Spec').first().json.failed_scenes || []).length ? 'some scenes used a fallback image: ' + JSON.stringify($('Build Spec').first().json.failed_scenes).slice(0, 400) : ''] }}") } } } });

const markFailed = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Mark Failed', executeOnce: true, credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET status = 'failed', error = $2, updated_at = now() WHERE id = $1::bigint RETURNING id", options: { queryReplacement: expr("{{ [$('Producer Trigger').first().json.project_id, String((typeof $json.error === 'string' ? $json.error : ($json.error && ($json.error.message || $json.error.description))) || $json.message || 'production failed').slice(0, 800)] }}") } } } });

export default workflow('reel-02-producer', 'REEL_02_Producer')
  .add(start)
  .to(startProduction)
  .to(planProduction.onError(markFailed))
  .to(makeVoices.onError(markFailed))
  .to(planVideos.onError(markFailed))
  .to(submitVideo)
  .to(collectJobs)
  .to(saveJobs)
  .to(waitClips)
  .to(loadJobs)
  .to(jobsToPoll)
  .to(pollVideo)
  .to(trackJobs)
  .to(savePoll)
  .to(clipsReady
    .onTrue(downloadClips.onError(markFailed)
      .to(buildSpec.onError(markFailed))
      .to(startRender.onError(markFailed))
      .to(saveRender)
      .to(waitRender)
      .to(renderStatus.onError(markFailed))
      .to(renderDone
        .onCase(0, finish)
        .onCase(1, markFailed)
        .onCase(2, waitRender)))
    .onFalse(waitClips));
