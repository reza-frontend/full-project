import { workflow, node, trigger, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const PG = { postgres: { id: 'EOQuXqKL8wvzLD9W', name: 'Nutrident Postgres' } };
const OR = { openRouterApi: { id: 'ezncqeNDdAAKn59E', name: 'OpenRouter' } };

const SCHEMA = JSON.stringify({
  type: 'object',
  required: ['title', 'angle', 'hook', 'scenes', 'cta', 'caption', 'hashtags', 'cover_text', 'qa'],
  properties: {
    title: { type: 'string' },
    angle: { type: 'string' },
    hook: { type: 'object', required: ['text', 'highlight'], properties: { text: { type: 'string' }, highlight: { type: 'string' } } },
    scenes: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'object', required: ['voiceover', 'label', 'visual_prompt', 'use_image'], properties: { voiceover: { type: 'string' }, label: { type: 'string' }, visual_prompt: { type: 'string' }, use_image: { type: 'integer' } } } },
    cta: { type: 'object', required: ['text', 'sub', 'voiceover'], properties: { text: { type: 'string' }, sub: { type: 'string' }, voiceover: { type: 'string' } } },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    cover_text: { type: 'string' },
    qa: { type: 'object', required: ['hook_score', 'clarity_score', 'value_score', 'engagement_score', 'notes'], properties: { hook_score: { type: 'integer' }, clarity_score: { type: 'integer' }, value_score: { type: 'integer' }, engagement_score: { type: 'integer' }, notes: { type: 'string' } } },
  },
});

const WRITER_SYSTEM = `You are a senior Persian short-form video strategist and scriptwriter for Instagram Reels. You write for ONE real business (BUSINESS below). Every reel must: (1) stop the scroll in the first 2 seconds, (2) make it obvious within 10 seconds what this business does and for whom, (3) give the viewer one concrete, useful takeaway, (4) end with a specific action that creates engagement (comment a keyword, save, share, follow or DM).

STRUCTURE (scenes in order):
1. HOOK scene: its voiceover starts with the hook sentence word for word. Pattern interrupt + open loop + something specific (a number, a common mistake, a bold claim, a surprising before/after, a question this audience cares about). Hook sentence max 12 words. Never open with a greeting, the brand name or «در این ویدیو».
2. CONTEXT: the audience's real situation, in their own everyday words.
3-5. VALUE: one idea per scene (tips, steps, myth vs truth, comparison, behind the scenes) with concrete details, never generic advice.
6. PROOF: how THIS business solves it: the real product, service, process or result, told naturally (not an ad read).
The call to action goes in the separate cta field.

VOICEOVER (read aloud by an AI voice in Persian):
- Natural, polite spoken Persian (محاوره‌ای مودبانه), short sentences, the owner's voice, consistent person (ما / شما or من / تو as the tone suggests).
- Write numbers as Persian words. No English words, no abbreviations, no emoji, no symbols such as % or & (write «درصد»).
- Each scene 6 to 18 words. Total words (all scenes + cta voiceover) inside WORD_BUDGET.
- Never invent statistics, prices, awards, customer stories or results. Use only facts given in BUSINESS or the brief; otherwise phrase it generally.

LABEL: optional 1-3 word on-screen tag such as «اشتباه ۱», «راه درست», «قبل», «بعد» (Persian digits allowed). Empty string when it adds nothing.

VISUAL_PROMPT (English, for an AI video model, one 3-10 second shot):
- Literally show what that scene's voiceover says. One subject, one simple action, one camera move (slow push-in, handheld follow, top-down, macro close-up, slow orbit).
- State subject, setting, action, lighting and lens. People look like this business's real audience; when people appear use an Iranian setting and modest clothing suitable for Iran.
- Never ask for text, signs, screens with writing, logos, brand names, detailed finger work or crowds.
- When one of the KIT IMAGES fits the scene (the real product or place), set use_image to its index and describe camera/subject motion that brings that photo to life; otherwise use_image = -1. If kit images exist, use at least one in the PROOF scene.

CTA: text = short on-screen line (max 7 words); sub = one supporting line; voiceover = the spoken CTA (max 14 words). Prefer a comment-keyword CTA («کلمه‌ی ... رو کامنت کن تا ...») or a save/share CTA tied to the value; use the business's default CTA when it fits.

CAPTION: Persian Instagram caption: first line restates the hook idea in new words, then 2-4 short lines of value, then the CTA; no hashtags inside it. HASHTAGS: 6-10 relevant tags (mostly Persian, a few English), without #. COVER_TEXT: 2-5 words for the thumbnail.

Score yourself honestly in qa (1-10). All Persian fields in Persian.`;

const EDITOR_SYSTEM = `You are the head editor of a top Persian Instagram agency. You receive a draft reel storyboard for the business in the context. Make it clearly better before money is spent producing it. Check and fix, in this order:
1. HOOK: would a fast-scrolling viewer stop? Max 12 words, specific, opens a loop, and the video really pays it off. Rewrite it if weak; scene 1 voiceover must start with the hook sentence word for word.
2. CLARITY: by scene 3 a viewer knows what this business offers and for whom.
3. RETENTION: every scene adds something new; cut filler and repetition; strongest order; no slow intro.
4. SPOKEN PERSIAN for an AI voice: natural, grammatical, numbers as words, no English or symbols; each scene 6-18 words; total words inside WORD_BUDGET.
5. TRUTH: remove invented facts, prices, statistics or testimonials.
6. VISUALS: literal to the line, filmable by an AI video model (single subject, simple motion, one camera move), no text or logos; use kit images where they fit (use_image index, else -1).
7. CTA specific and engaging; caption, hashtags and cover text strong.
MODE manual: the owner wrote the voiceover. Keep their wording and order (only fix typos, numbers-as-words and English words, and split into scenes); improve everything else and list wording suggestions in qa.notes instead of applying them.
Return the complete improved storyboard in the same schema. Fill qa with honest 1-10 scores and Persian notes: what you changed and any remaining risk.`;

const start = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1, config: { name: 'Director Trigger', parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'project_id', type: 'number' }] } } } });

const startScripting = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Start Scripting', credentials: PG, parameters: { operation: 'executeQuery', query: "WITH up AS (\n  UPDATE reel.projects SET status = 'scripting', error = NULL, updated_at = now()\n  WHERE id = $1::bigint AND status IN ('queued', 'scripting', 'script_ready', 'failed', 'rejected', 'review')\n  RETURNING *\n)\nSELECT row_to_json(up) AS project,\n  (SELECT row_to_json(k) FROM reel.kits k WHERE k.id = up.kit_id) AS kit,\n  (SELECT COALESCE(json_agg(h), '[]'::json) FROM (\n     SELECT p.status, p.title, p.storyboard->'hook'->>'text' AS hook, p.feedback\n     FROM reel.projects p WHERE p.kit_id = up.kit_id AND p.id <> up.id AND p.storyboard IS NOT NULL\n     ORDER BY p.id DESC LIMIT 15) h) AS history\nFROM up", options: { queryReplacement: expr('{{ [$json.project_id] }}') } } } });

const buildBrief = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Build Brief', parameters: { mode: 'runOnceForAllItems', jsCode: `// Packs the style kit, mode rules, word budget, past videos + owner feedback into one context block for both LLM passes.
const r = $input.first().json;
const p = r.project, k = r.kit || {}, hist = r.history || [];
const target = Math.min(60, Math.max(15, Number(p.target_seconds) || 30));
const minW = Math.round((target - 4) * 2.1), maxW = Math.round((target - 2) * 2.6);
const images = (Array.isArray(k.images) ? k.images : []).map((im, i) => i + ': ' + (im.desc || 'photo of the real product/place')).join('\\n') || 'none';
const MODES = {
  auto: 'Pick the strongest topic yourself from BUSINESS (offer, interests, audience problems). Avoid the topics of RECENT VIDEOS. Prefer formats that earn saves and shares: common mistakes, short checklists, myth vs truth, behind the scenes, before/after.',
  topic: 'The owner gave the topic or idea in BRIEF. Build the best possible reel on exactly that topic.',
  manual: 'The owner wrote the scenario in BRIEF. Keep their wording and order for the voiceover (only fix typos, write numbers as words, replace English words, split into scenes, trim only if far over the budget). Use their first sentence as the hook unless they marked another one. Your job: scenes, labels, visuals, CTA (keep theirs if given), caption.',
};
const business = { brand: k.brand_name, instagram: k.handle, business: k.business, audience: k.audience, offer: k.offer, interests_and_topics: k.interests, never_say_or_show: k.avoid, tone: k.tone, default_cta: k.cta_default };
const history = hist.map(h => '- [' + h.status + '] ' + (h.title || '') + ' | hook: ' + (h.hook || '') + (h.feedback ? ' | owner feedback: ' + h.feedback : '')).join('\\n') || 'none';
const context = 'MODE: ' + p.mode + '\\n' + MODES[p.mode] +
  '\\n\\nTARGET LENGTH: about ' + target + ' seconds -> WORD_BUDGET: ' + minW + '-' + maxW + ' words in total (all scene voiceovers + cta voiceover).' +
  '\\n\\nBUSINESS:\\n' + JSON.stringify(business, null, 1) +
  '\\n\\nKIT IMAGES (index: description):\\n' + images +
  '\\n\\nRECENT VIDEOS (do not repeat their topics or hooks; learn from the owner feedback):\\n' + history +
  '\\n\\nOWNER FEEDBACK ON THIS VIDEO (must be applied):\\n' + (p.feedback || 'none') +
  '\\n\\nBRIEF / SCRIPT FROM OWNER:\\n<<<\\n' + (p.brief || '(none)') + '\\n>>>' +
  '\\n\\nSTYLE NOTES FOR THIS VIDEO:\\n' + (p.style_notes || 'none');
return [{ json: { context, mode: p.mode, project_id: p.id, auto_produce: !!p.auto_produce } }];` } } });

const writerModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter', version: 1, config: { name: 'Writer Model', parameters: { model: 'x-ai/grok-4.7', options: { temperature: 0.85, timeout: 240000, maxRetries: 2 } }, credentials: OR } });
const writerSchema = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'Writer Schema', parameters: { schemaType: 'manual', inputSchema: SCHEMA } } });

const writer = node({ type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9, config: { name: 'Script Writer', onError: 'continueErrorOutput', parameters: { promptType: 'define', hasOutputParser: true, text: expr('{{ $json.context }}\n\nWrite the reel storyboard now.'), messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: WRITER_SYSTEM }] } }, subnodes: { model: writerModel, outputParser: writerSchema } } });

const editorModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter', version: 1, config: { name: 'Editor Model', parameters: { model: 'x-ai/grok-4.7', options: { temperature: 0.4, timeout: 240000, maxRetries: 2 } }, credentials: OR } });
const editorSchema = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'Editor Schema', parameters: { schemaType: 'manual', inputSchema: SCHEMA } } });

const editor = node({ type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9, config: { name: 'Script Editor', onError: 'continueErrorOutput', parameters: { promptType: 'define', hasOutputParser: true, text: expr("{{ $('Build Brief').first().json.context }}\n\nDRAFT STORYBOARD:\n{{ JSON.stringify($json.output) }}\n\nReturn the improved storyboard."), messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: EDITOR_SYSTEM }] } }, subnodes: { model: editorModel, outputParser: editorSchema } } });

const finalize = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Finalize Script', onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode: `// Cleans the edited storyboard, guarantees scene 1 starts with the hook, and adds word/length stats.
const sb = Object.assign({}, $input.first().json.output || {});
sb.scenes = (sb.scenes || []).filter(s => s && String(s.voiceover || '').trim()).slice(0, 8).map(s => ({
  voiceover: String(s.voiceover).trim(),
  label: String(s.label || '').trim().slice(0, 24),
  visual_prompt: String(s.visual_prompt || '').trim(),
  use_image: Number.isInteger(s.use_image) ? s.use_image : -1,
}));
if (sb.scenes.length < 2) throw new Error('the script came back with fewer than 2 scenes');
const hook = String((sb.hook && sb.hook.text) || '').trim();
const norm = s => String(s).replace(/[\\s\\u200c.,!?؟،:؛«»"']/g, '');
if (hook && !norm(sb.scenes[0].voiceover).startsWith(norm(hook))) sb.scenes[0].voiceover = hook + ' ' + sb.scenes[0].voiceover;
const words = sb.scenes.map(s => s.voiceover).concat([(sb.cta && sb.cta.voiceover) || '']).join(' ').split(/\\s+/).filter(Boolean).length;
sb.stats = { words, est_seconds: Math.round(words / 2.4 + 3) };
const tags = (sb.hashtags || []).map(t => '#' + String(t).replace(/^#/, '').trim().replace(/\\s+/g, '_')).filter(t => t.length > 1);
return [{ json: { storyboard: sb, qa: sb.qa || {}, title: sb.title || '', caption: sb.caption || '', hashtags: tags.join(' ') } }];` } } });

const saveScript = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Save Script', credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET storyboard = $2::jsonb, qa = $3::jsonb, title = $4, caption = $5, hashtags = $6, status = 'script_ready', error = NULL, updated_at = now()\nWHERE id = $1::bigint RETURNING id AS project_id, auto_produce", options: { queryReplacement: expr("{{ [$('Director Trigger').first().json.project_id, JSON.stringify($json.storyboard), JSON.stringify($json.qa), $json.title, $json.caption, $json.hashtags] }}") } } } });

const autoProduce = ifElse({ version: 2.2, config: { name: 'Auto Produce?', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr('{{ $json.auto_produce }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } } } });

const runProducer = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3, config: { name: 'Run Producer', parameters: { mode: 'once', source: 'database', workflowId: { __rl: true, mode: 'id', value: 'X2F21BGx3A2K8RUZ', cachedResultName: 'REEL_02_Producer' }, workflowInputs: { mappingMode: 'defineBelow', value: { project_id: expr('{{ $json.project_id }}') }, matchingColumns: [], schema: [{ id: 'project_id', displayName: 'project_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' }], attemptToConvertTypes: true, convertFieldsToString: false }, options: { waitForSubWorkflow: false } } } });

const markFailed = node({ type: 'n8n-nodes-base.postgres', version: 2.7, config: { name: 'Mark Failed', executeOnce: true, credentials: PG, parameters: { operation: 'executeQuery', query: "UPDATE reel.projects SET status = 'failed', error = $2, updated_at = now() WHERE id = $1::bigint RETURNING id", options: { queryReplacement: expr("{{ [$('Director Trigger').first().json.project_id, 'script: ' + String((typeof $json.error === 'string' ? $json.error : ($json.error && ($json.error.message || $json.error.description))) || $json.message || 'script generation failed').slice(0, 800)] }}") } } } });

export default workflow('reel-01-director', 'REEL_01_Director')
  .add(start)
  .to(startScripting)
  .to(buildBrief)
  .to(writer.onError(markFailed))
  .to(editor.onError(markFailed))
  .to(finalize.onError(markFailed))
  .to(saveScript)
  .to(autoProduce.onTrue(runProducer));
