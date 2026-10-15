import { workflow, node, trigger, ifElse, switchCase, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const PG = { postgres: { id: 'EOQuXqKL8wvzLD9W', name: 'Nutrident Postgres' } };
const OR = { openRouterApi: { id: 'ezncqeNDdAAKn59E', name: 'OpenRouter' } };
const renderHeaders = { parameters: [{ name: 'x-api-key', value: expr("{{ $('Start Edit').first().json.settings.render_key }}") }] };

const PLAN_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['title', 'keep', 'hook', 'graphics', 'punch_words', 'cta', 'caption', 'hashtags', 'qa'],
  properties: {
    title: { type: 'string' },
    keep: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'integer' }, to: { type: 'integer' } } } },
    hook: { type: 'object', required: ['text', 'highlight'], properties: { text: { type: 'string' }, highlight: { type: 'string' } } },
    graphics: { type: 'array', items: { type: 'object', required: ['type', 'at_word', 'duration', 'text', 'title', 'subtitle', 'value', 'suffix', 'items', 'bad', 'good', 'emoji', 'image_index'], properties: {
      type: { type: 'string', enum: ['label', 'lower_third', 'counter', 'checklist', 'compare', 'sticker', 'keyword', 'image'] },
      at_word: { type: 'integer' }, duration: { type: 'number' }, text: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' },
      value: { type: 'number' }, suffix: { type: 'string' }, items: { type: 'array', items: { type: 'string' } }, bad: { type: 'string' }, good: { type: 'string' },
      emoji: { type: 'string' }, image_index: { type: 'integer' } } } },
    punch_words: { type: 'array', items: { type: 'integer' } },
    cta: { type: 'object', required: ['text', 'sub'], properties: { text: { type: 'string' }, sub: { type: 'string' } } },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    qa: { type: 'object', required: ['score', 'notes'], properties: { score: { type: 'integer' }, notes: { type: 'string' } } },
  },
});

const PLANNER_SYSTEM = `You are a senior Instagram Reels editor for Persian-speaking business owners. You receive a word-level transcript of raw phone footage the owner filmed. Format: one word per line as index|seconds|word. "--- clip N ---" starts a new clip; "[pause X s]" marks silence. You plan the edit; a renderer applies it exactly.

1. KEEP: an ordered list of word-index ranges (inclusive) that make the final video.
- Remove false starts, repeated takes (keep the best, usually the last complete take), filler sounds (اِ، اوم، خب خب، یعنی یعنی), long tangents, slow intros and greetings that delay the value («سلام دوستان امروز می‌خوام...») and anything off-topic.
- Never cut inside a sentence; a range starts and ends at sentence or clause boundaries.
- You may open with one strong sentence moved from later (a punchy claim, question or result) as a cold-open hook, then continue in natural order without repeating it.
- Ranges must not overlap. Aim close to TARGET seconds (use the timestamps); never exceed 180 seconds. If the footage is shorter, keep everything that is good.
2. HOOK: on-screen hook card for the first seconds: max 8 words matching the opening; highlight = 1-2 of its words.
3. GRAPHICS: 3-8 motion-graphic overlays tied to what is said at that moment (at_word = a KEPT word index where it appears):
- label: 1-3 word tag such as «نکته ۱»، «اشتباه ۲»، «نتیجه»
- lower_third: title = speaker or business name, subtitle = role (only if known from BUSINESS or the speech)
- counter: a number actually said; value = the number, text = what it counts, suffix such as «٪» or «+»
- checklist: when the speaker lists things; title + 2-5 short items
- compare: wrong vs right or before vs after; bad and good = short phrases
- sticker: one emoji reaction (✅ ❌ 🔥 💡 ⚠️ 👉 ⭐ 💰 😮)
- keyword: one or two words of strong emphasis
- image: show a real product photo; image_index from KIT IMAGES (only if one fits)
Duration 1.2-3.5 s. The first 3 seconds belong to the hook card. Never let two cards of type label, lower_third, counter, checklist, compare or image overlap in time. Only use facts that are actually said or given in BUSINESS; never invent numbers.
4. PUNCH_WORDS: 3-8 kept word indexes where a quick punch-in zoom emphasises a key moment.
5. CTA: end card text (max 7 words) + sub line tied to the video's value; use the business default CTA when it fits.
6. CAPTION: Persian Instagram caption (first line restates the hook, 2-4 short lines of value, CTA, no hashtags inside). HASHTAGS: 6-10 relevant tags without #. TITLE: short Persian title. QA: score 1-10 and Persian notes listing what you cut and why plus any risk (bad audio, too long, weak hook).
Fill every field of every object; use "" / 0 / [] / -1 for fields a graphic type does not use.`;

const start = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1, config: { name: 'Editor Trigger', parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'project_id', type: 'number' }] } } } });

const startEdit = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Start Edit', credentials: PG, parameters: { operation: 'executeQuery', query: "WITH up AS (\n  UPDATE reel.projects SET status = 'editing', error = NULL, updated_at = now()\n  WHERE id = $1::bigint AND mode = 'edit' AND status IN ('queued', 'editing', 'failed', 'review', 'rejected', 'approved', 'script_ready')\n  RETURNING *\n)\nSELECT row_to_json(up) AS project,\n  (SELECT row_to_json(k) FROM reel.kits k WHERE k.id = up.kit_id) AS kit,\n  (SELECT json_object_agg(key, value) FROM reel.settings) AS settings\nFROM up", options: { queryReplacement: expr('{{ [$json.project_id] }}') } } } });

const checkFootage = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Check Footage', onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode: `// Re-edits reuse the prepared video + transcript; new uploads (or changed clips) are prepared again.
const r = $input.first().json;
if (!r.settings || !r.settings.render_url) throw new Error('render_url is not set in reel.settings');
const clips = Array.isArray(r.project.clips) ? r.project.clips : [];
if (!clips.length) throw new Error('no uploaded clips');
const fp = (r.project.assets || {}).footage;
const ready = Array.isArray(fp) && fp.length === clips.length && fp.every((f, i) => f.source_id === clips[i].id && f.video && Array.isArray(f.words));
return [{ json: { ready, clips, render: r.settings.render_url.replace(/\\/$/, '') } }];` } } });

const footageReady = ifElse({ version: 2.2, config: { name: 'Footage Ready?', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.ready }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } } } });

const splitClips = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Split Clips', parameters: { mode: 'runOnceForAllItems', jsCode: `return $input.first().json.clips.map((c, i) => ({ json: { index: i, id: c.id, name: c.name || '' } }));` } } });

const prepareClip = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Prepare Clip', onError: 'continueRegularOutput', parameters: { method: 'POST', url: expr("{{ $('Check Footage').first().json.render }}/api/prepare"), sendHeaders: true, headerParameters: renderHeaders, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ id: $json.id }) }}'), options: { timeout: 900000, batching: { batch: { batchSize: 1, batchInterval: 0 } } } } } });

const transcribeClip = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Transcribe Clip', onError: 'continueRegularOutput', parameters: { method: 'POST', url: expr("{{ $('Check Footage').first().json.render }}/api/transcribe"), sendHeaders: true, headerParameters: renderHeaders, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ id: $json.audio ? $json.audio.id : 'missing', language: 'fa', model: $('Start Edit').first().json.settings.stt_model || 'elevenlabs/scribe-v2' }) }}"), options: { timeout: 900000, batching: { batch: { batchSize: 1, batchInterval: 0 } } } } } });

const collectFootage = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Collect Footage', onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode: `const clips = $('Split Clips').all().map(i => i.json);
const preps = $('Prepare Clip').all().map(i => i.json);
const stts = $input.all().map(i => i.json);
const errOf = j => j && j.error ? (typeof j.error === 'string' ? j.error : (j.error.message || JSON.stringify(j.error))) : '';
let cost = 0;
const footage = clips.map((c, i) => {
  const p = preps[i] || {}, t = stts[i] || {};
  if (errOf(p) || !p.video) throw new Error('clip ' + (i + 1) + ' prepare failed: ' + (errOf(p) || 'no output'));
  if (errOf(t) || !Array.isArray(t.words)) throw new Error('clip ' + (i + 1) + ' transcription failed: ' + (errOf(t) || 'no words'));
  if (!t.words.length) throw new Error('clip ' + (i + 1) + ': no speech found');
  cost += Number(t.cost) || 0;
  return { source_id: c.id, video: { id: p.video.id, url: p.video.url, width: p.video.width, height: p.video.height, duration: p.video.duration }, words: t.words, word_timestamps: !!t.word_timestamps };
});
return [{ json: { footage, cost } }];` } } });

const saveFootage = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Save Footage', credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET assets = jsonb_set(coalesce(assets, '{}'::jsonb), '{footage}', $2::jsonb), cost_usd = $3::numeric, updated_at = now() WHERE id = $1::bigint RETURNING id", options: { queryReplacement: expr("{{ [$('Editor Trigger').first().json.project_id, JSON.stringify($json.footage), $json.cost || 0] }}") } } } });

const loadFootage = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Load Footage', executeOnce: true, credentials: PG, parameters: { operation: 'executeQuery', query: "SELECT row_to_json(p) AS project, (SELECT row_to_json(k) FROM reel.kits k WHERE k.id = p.kit_id) AS kit, p.assets->'footage' AS footage FROM reel.projects p WHERE p.id = $1::bigint", options: { queryReplacement: expr("{{ [$('Editor Trigger').first().json.project_id] }}") } } } });

const buildTranscript = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Build Transcript', parameters: { mode: 'runOnceForAllItems', jsCode: `// One line per word (index|seconds|word) with clip and pause markers, plus business context for the planner.
const r = $input.first().json;
const p = r.project, k = r.kit || {}, footage = r.footage || [];
const lines = []; let idx = 0, total = 0;
footage.forEach((f, ci) => {
  lines.push('--- clip ' + (ci + 1) + ' (' + Math.round(f.video.duration || 0) + ' s) ---');
  total += f.video.duration || 0;
  f.words.forEach((w, wi) => {
    const prev = f.words[wi - 1];
    if (prev && w.start - prev.end > 0.6) lines.push('[pause ' + (w.start - prev.end).toFixed(1) + ' s]');
    lines.push(idx + '|' + w.start.toFixed(2) + '|' + w.text);
    idx++;
  });
});
const images = (Array.isArray(k.images) ? k.images : []).map((im, i) => i + ': ' + (im.desc || 'product photo')).join('\\n') || 'none';
const business = { brand: k.brand_name, instagram: k.handle, business: k.business, audience: k.audience, offer: k.offer, never_say_or_show: k.avoid, tone: k.tone, default_cta: k.cta_default };
const context = 'TARGET: about ' + p.target_seconds + ' seconds (raw footage ' + Math.round(total) + ' s, ' + idx + ' words).' +
  '\\n\\nBUSINESS:\\n' + JSON.stringify(business, null, 1) +
  '\\n\\nKIT IMAGES (index: description):\\n' + images +
  '\\n\\nOWNER NOTES / SCRIPT:\\n' + ([p.brief, p.style_notes].filter(Boolean).join('\\n') || 'none') +
  '\\n\\nOWNER FEEDBACK ON THE PREVIOUS EDIT (must be applied):\\n' + (p.feedback || 'none') +
  '\\n\\nTRANSCRIPT:\\n' + lines.join('\\n');
return [{ json: { context, words: idx } }];` } } });

const plannerModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter', version: 1, config: { name: 'Planner Model', parameters: { model: 'x-ai/grok-4.7', options: { temperature: 0.3, timeout: 420000, maxRetries: 1, maxTokens: 8000, providerRouting: { sort: 'throughput' } } }, credentials: OR } });
const plannerSchema = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'Plan Schema', parameters: { schemaType: 'manual', inputSchema: PLAN_SCHEMA } } });
const planner = node({ type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9, config: { name: 'Edit Planner', onError: 'continueErrorOutput', parameters: { promptType: 'define', hasOutputParser: true, text: expr('{{ $json.context }}\n\nPlan the edit now.'), messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: PLANNER_SYSTEM }] } }, subnodes: { model: plannerModel, outputParser: plannerSchema } } });

const buildSpec = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Build Edit Spec', onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode: `// Turns the planner's word ranges into tight segments (silences cut, small padding, alternating jump-cut zoom)
// and places every graphic on the output timeline at the moment its word is spoken.
const r = $('Load Footage').first().json;
const plan = $input.first().json.output || {};
const k = r.kit || {}, footage = r.footage || [];
const all = [];
footage.forEach((f, ci) => f.words.forEach(w => all.push({ text: w.text, start: Number(w.start), end: Number(w.end), clip: ci })));
if (!all.length) throw new Error('empty transcript');
let ranges = (plan.keep || []).map(x => ({ from: Math.max(0, x.from | 0), to: Math.min(all.length - 1, x.to | 0) })).filter(x => x.to >= x.from);
if (!ranges.length) ranges = [{ from: 0, to: all.length - 1 }];
const used = new Set(), order = [];
ranges.forEach(x => { for (let i = x.from; i <= x.to; i++) if (!used.has(i)) { used.add(i); order.push(i); } });

const MAXGAP = 0.35, PAD_IN = 0.10, PAD_OUT = 0.18;
let segs = [], cur = null;
order.forEach((i, n) => {
  const w = all[i], pi = order[n - 1];
  if (cur && pi === i - 1 && all[pi].clip === w.clip && w.start - all[pi].end <= MAXGAP) { cur.end = w.end; cur.words.push(i); }
  else { if (cur) segs.push(cur); cur = { clip: w.clip, start: w.start, end: w.end, words: [i] }; }
});
if (cur) segs.push(cur);
segs.forEach(s => {
  const dur = Number(footage[s.clip].video.duration) || 1e9;
  const a = s.words[0], b = s.words[s.words.length - 1];
  const prevW = all[a - 1], nextW = all[b + 1];
  const minStart = prevW && prevW.clip === s.clip ? prevW.end + 0.02 : 0;
  const maxEnd = nextW && nextW.clip === s.clip ? nextW.start - 0.02 : dur;
  s.start = Math.max(minStart, s.start - PAD_IN, 0);
  s.end = Math.min(Math.max(maxEnd, s.end), s.end + PAD_OUT, dur);
});
// Hard cap: 180 s of video.
let t = 0; segs = segs.filter(s => { const keep = t < 180; t += s.end - s.start; return keep; });
const punch = new Set((plan.punch_words || []).map(Number));
let out = 0;
segs.forEach((s, i) => { s.out = out; out += s.end - s.start; s.zoom = s.words.some(w => punch.has(w)) ? 1.16 : (i % 2 ? 1.08 : 1); });
const videoSec = out;
const wordOut = {};
segs.forEach(s => s.words.forEach(i => { wordOut[i] = s.out + Math.max(0, all[i].start - s.start); }));
const keptIdx = Object.keys(wordOut).map(Number).sort((a, b) => a - b);
const atOf = wi => { if (wordOut[wi] != null) return wordOut[wi]; const n = keptIdx.find(x => x >= wi); return n != null ? wordOut[n] : null; };

const TOP = ['label', 'lower_third', 'counter', 'checklist', 'compare', 'image'];
const images = Array.isArray(k.images) ? k.images : [];
const hookDur = Math.min(3, Math.max(1.8, videoSec * 0.12));
const gfx = [];
if (plan.hook && plan.hook.text) gfx.push({ type: 'hook', at: 0, duration: hookDur, text: plan.hook.text, highlight: plan.hook.highlight || '' });
let topEnd = hookDur + 0.1, midEnd = 0;
(plan.graphics || []).map(g => Object.assign({}, g, { at: atOf(Number(g.at_word)) })).filter(g => g.at != null).sort((a, b) => a.at - b.at).forEach(g => {
  let dur = Math.min(3.5, Math.max(g.type === 'checklist' ? 2.6 : 1.2, Number(g.duration) || 2));
  let at = g.at;
  if (TOP.includes(g.type)) { at = Math.max(at, topEnd); topEnd = at + dur + 0.15; }
  else { at = Math.max(at, midEnd); midEnd = at + dur + 0.1; }
  if (at > videoSec - 0.8) return;
  dur = Math.min(dur, videoSec - at);
  const o = { type: g.type, at, duration: dur };
  if (g.type === 'image') { const im = images[g.image_index]; if (!im) return; o.url = im.url; o.text = g.text || ''; }
  else if (g.type === 'counter') Object.assign(o, { value: Number(g.value) || 0, text: g.text || '', suffix: g.suffix || '' });
  else if (g.type === 'checklist') Object.assign(o, { title: g.title || '', items: (g.items || []).filter(Boolean).slice(0, 5) });
  else if (g.type === 'compare') Object.assign(o, { bad: g.bad || '', good: g.good || '' });
  else if (g.type === 'lower_third') Object.assign(o, { title: g.title || g.text || '', subtitle: g.subtitle || '' });
  else if (g.type === 'sticker') Object.assign(o, { emoji: g.emoji || '🔥', side: gfx.length % 2 ? 'right' : 'left' });
  else o.text = g.text || '';
  gfx.push(o);
});

const theme = Object.assign({ frame: 'none' }, k.theme || {});
const spec = {
  theme,
  brand: { name: k.brand_name || '', handle: k.handle || '', logoUrl: k.logo_url || '' },
  clips: footage.map(f => ({ url: f.video.url, width: f.video.width, height: f.video.height })),
  segments: segs.map(s => ({ clip: s.clip, start: +s.start.toFixed(3), end: +s.end.toFixed(3), zoom: s.zoom })),
  words: order.map(i => all[i]),
  graphics: gfx,
  cta: plan.cta && plan.cta.text ? { text: plan.cta.text, sub: plan.cta.sub || '', duration: 3 } : null,
};
if (k.music_url) spec.music = { url: k.music_url, volume: 0.07 };
const tags = (plan.hashtags || []).map(x => '#' + String(x).replace(/^#/, '').trim().replace(/\\s+/g, '_')).filter(x => x.length > 1).join(' ');
return [{ json: { spec, title: plan.title || '', caption: plan.caption || '', hashtags: tags, qa: plan.qa || {}, plan, video_seconds: Math.round(videoSec) } }];` } } });

const startRender = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Start Render', onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, parameters: { method: 'POST', url: expr("{{ $('Check Footage').first().json.render }}/api/render"), sendHeaders: true, headerParameters: renderHeaders, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ composition: 'Edit', spec: $json.spec, ref: String($('Editor Trigger').first().json.project_id) }) }}"), options: { timeout: 60000 } } } });

const saveRender = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Save Render', credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET status = 'rendering', render_id = $2, updated_at = now() WHERE id = $1::bigint RETURNING id, render_id", options: { queryReplacement: expr("{{ [$('Editor Trigger').first().json.project_id, $json.id] }}") } } } });

const waitRender = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Wait Render', parameters: { resume: 'timeInterval', amount: 15, unit: 'seconds' } } });

const renderStatus = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Render Status', onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, parameters: { method: 'GET', url: expr("{{ $('Check Footage').first().json.render }}/api/render/{{ $json.render_id || $json.id }}"), sendHeaders: true, headerParameters: renderHeaders, options: { timeout: 30000 } } } });

const renderDone = switchCase({ version: 3.2, config: { name: 'Render Done?', parameters: { rules: { values: [
  { outputKey: 'done', renameOutput: true, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'done' }], combinator: 'and' } },
  { outputKey: 'failed', renameOutput: true, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'failed' }], combinator: 'and' } },
] }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'Still Rendering' } } } });

const finish = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Finish Edit', credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET status = 'review', video_url = $2, title = $3, caption = $4, hashtags = $5, qa = $6::jsonb, storyboard = $7::jsonb, updated_at = now() WHERE id = $1::bigint RETURNING id, video_url", options: { queryReplacement: expr("{{ [$('Editor Trigger').first().json.project_id, $json.url, $('Build Edit Spec').first().json.title, $('Build Edit Spec').first().json.caption, $('Build Edit Spec').first().json.hashtags, JSON.stringify($('Build Edit Spec').first().json.qa), JSON.stringify({ kind: 'edit', video_seconds: $('Build Edit Spec').first().json.video_seconds, hook: $('Build Edit Spec').first().json.plan.hook, plan: $('Build Edit Spec').first().json.plan })] }}") } } } });

const markFailed = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Mark Failed', executeOnce: true, credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET status = 'failed', error = $2, updated_at = now() WHERE id = $1::bigint RETURNING id", options: { queryReplacement: expr("{{ [$('Editor Trigger').first().json.project_id, 'edit: ' + String((typeof $json.error === 'string' ? $json.error : ($json.error && ($json.error.message || $json.error.description))) || $json.message || 'edit failed').slice(0, 800)] }}") } } } });

export default workflow('reel-04-editor', 'REEL_04_Editor')
  .add(start)
  .to(startEdit)
  .to(checkFootage.onError(markFailed))
  .to(footageReady
    .onTrue(loadFootage)
    .onFalse(splitClips.to(prepareClip).to(transcribeClip).to(collectFootage.onError(markFailed)).to(saveFootage).to(loadFootage)))
  .add(loadFootage)
  .to(buildTranscript)
  .to(planner.onError(markFailed))
  .to(buildSpec.onError(markFailed))
  .to(startRender.onError(markFailed))
  .to(saveRender)
  .to(waitRender)
  .to(renderStatus.onError(markFailed))
  .to(renderDone
    .onCase(0, finish)
    .onCase(1, markFailed)
    .onCase(2, waitRender));
