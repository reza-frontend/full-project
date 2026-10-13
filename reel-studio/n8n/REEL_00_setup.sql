CREATE SCHEMA IF NOT EXISTS reel;

CREATE TABLE IF NOT EXISTS reel.settings (key text PRIMARY KEY, value text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS reel.kits (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  brand_name text NOT NULL DEFAULT '',
  handle text NOT NULL DEFAULT '',
  logo_url text NOT NULL DEFAULT '',
  business text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  offer text NOT NULL DEFAULT '',
  interests text NOT NULL DEFAULT '',
  avoid text NOT NULL DEFAULT '',
  tone text NOT NULL DEFAULT 'صمیمی، مطمئن و کاربردی',
  visual_style text NOT NULL DEFAULT 'cinematic, natural light, shallow depth of field, real people and real places, warm color grade',
  cta_default text NOT NULL DEFAULT '',
  theme jsonb NOT NULL DEFAULT '{"primary":"#FFD400","captionStyle":"pop"}'::jsonb,
  voice text NOT NULL DEFAULT 'adam',
  quality text NOT NULL DEFAULT 'standard',
  music_url text NOT NULL DEFAULT '',
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_daily int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel.projects (
  id bigserial PRIMARY KEY,
  kit_id bigint NOT NULL REFERENCES reel.kits(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('auto','topic','manual')),
  brief text NOT NULL DEFAULT '',
  style_notes text NOT NULL DEFAULT '',
  target_seconds int NOT NULL DEFAULT 30,
  auto_produce boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued',
  title text,
  storyboard jsonb,
  qa jsonb,
  assets jsonb NOT NULL DEFAULT '{}'::jsonb,
  caption text,
  hashtags text,
  render_id text,
  video_url text,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  feedback text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_kit_idx ON reel.projects (kit_id, id DESC);
CREATE INDEX IF NOT EXISTS projects_status_idx ON reel.projects (status);

INSERT INTO reel.settings (key, value) VALUES
  ('render_url', ''),
  ('render_key', md5(random()::text || clock_timestamp()::text) || md5(random()::text)),
  ('panel_key', md5(random()::text || clock_timestamp()::text)),
  ('writer_model', 'x-ai/grok-4.7'),
  ('tts_model', 'elevenlabs/eleven-v3'),
  ('video_model_standard', 'kwaivgi/kling-v3.0-std'),
  ('video_model_premium', 'google/veo-3.1-fast'),
  ('telegram_chat_id', ''),
  ('max_cost_per_video_usd', '6')
ON CONFLICT (key) DO NOTHING;

-- Panel API: every panel action except file upload goes through this one function (key check, validation, state changes).
-- Returns {ok, ...}; "run" tells the n8n panel workflow which agent to start afterwards.
CREATE OR REPLACE FUNCTION reel.api(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  a text := coalesce(req->>'action', '');
  pid bigint := NULLIF(req->>'project_id', '')::bigint;
  kid bigint;
  k jsonb;
  busy boolean;
BEGIN
  IF coalesce(req->>'key', '') = '' OR req->>'key' <> (SELECT value FROM reel.settings WHERE key = 'panel_key') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF pid IS NOT NULL THEN
    SELECT status IN ('queued', 'scripting', 'producing', 'rendering') AND updated_at > now() - interval '40 minutes'
      INTO busy FROM reel.projects WHERE id = pid;
    IF busy IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ویدیو پیدا نشد'); END IF;
  END IF;

  IF a = 'bootstrap' THEN
    RETURN jsonb_build_object('ok', true,
      'kits', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM reel.kits x),
      'projects', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC), '[]'::jsonb) FROM (
         SELECT id, kit_id, mode, status, title, left(brief, 160) AS brief, video_url, cost_usd, error, created_at, updated_at,
                storyboard->'hook'->>'text' AS hook
         FROM reel.projects ORDER BY id DESC LIMIT 80) x),
      'settings', (SELECT jsonb_object_agg(key, value) FROM reel.settings WHERE key NOT IN ('panel_key', 'render_key')));

  ELSIF a = 'get_project' THEN
    RETURN jsonb_build_object('ok', true, 'project', (SELECT to_jsonb(p) - 'assets' FROM reel.projects p WHERE id = pid));

  ELSIF a = 'save_kit' THEN
    k := coalesce(req->'kit', '{}'::jsonb);
    kid := NULLIF(k->>'id', '')::bigint;
    IF kid IS NULL THEN
      INSERT INTO reel.kits (name) VALUES (coalesce(NULLIF(k->>'name', ''), 'برند جدید')) RETURNING id INTO kid;
    END IF;
    UPDATE reel.kits SET
      name = coalesce(NULLIF(k->>'name', ''), name),
      brand_name = coalesce(k->>'brand_name', brand_name),
      handle = coalesce(k->>'handle', handle),
      logo_url = coalesce(k->>'logo_url', logo_url),
      business = coalesce(k->>'business', business),
      audience = coalesce(k->>'audience', audience),
      offer = coalesce(k->>'offer', offer),
      interests = coalesce(k->>'interests', interests),
      avoid = coalesce(k->>'avoid', avoid),
      tone = coalesce(NULLIF(k->>'tone', ''), tone),
      visual_style = coalesce(NULLIF(k->>'visual_style', ''), visual_style),
      cta_default = coalesce(k->>'cta_default', cta_default),
      theme = coalesce(k->'theme', theme),
      voice = coalesce(NULLIF(k->>'voice', ''), voice),
      quality = CASE WHEN k->>'quality' IN ('standard', 'premium') THEN k->>'quality' ELSE quality END,
      music_url = coalesce(k->>'music_url', music_url),
      images = CASE WHEN jsonb_typeof(k->'images') = 'array' THEN k->'images' ELSE images END,
      auto_daily = least(5, greatest(0, coalesce(NULLIF(k->>'auto_daily', '')::int, auto_daily))),
      is_active = coalesce((k->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = kid;
    RETURN jsonb_build_object('ok', true, 'kit', (SELECT to_jsonb(x) FROM reel.kits x WHERE id = kid));

  ELSIF a = 'create_project' THEN
    kid := NULLIF(req->>'kit_id', '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM reel.kits WHERE id = kid) THEN RETURN jsonb_build_object('ok', false, 'error', 'اول یک سبک برند بسازید'); END IF;
    IF coalesce(req->>'mode', '') NOT IN ('auto', 'topic', 'manual') THEN RETURN jsonb_build_object('ok', false, 'error', 'حالت نامعتبر'); END IF;
    IF req->>'mode' IN ('topic', 'manual') AND length(trim(coalesce(req->>'brief', ''))) < 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'موضوع یا سناریو را بنویسید');
    END IF;
    INSERT INTO reel.projects (kit_id, mode, brief, style_notes, target_seconds, auto_produce)
    VALUES (kid, req->>'mode', coalesce(req->>'brief', ''), coalesce(req->>'style_notes', ''),
            least(60, greatest(15, coalesce(NULLIF(req->>'target_seconds', '')::int, 30))), coalesce((req->>'auto_produce')::boolean, false))
    RETURNING id INTO pid;
    RETURN jsonb_build_object('ok', true, 'project_id', pid, 'run', jsonb_build_object('workflow', 'director', 'project_id', pid));

  ELSIF a = 'regenerate' THEN
    IF busy THEN RETURN jsonb_build_object('ok', false, 'error', 'این ویدیو در حال پردازش است'); END IF;
    UPDATE reel.projects SET feedback = NULLIF(trim(coalesce(req->>'feedback', '')), ''), status = 'queued', updated_at = now() WHERE id = pid;
    RETURN jsonb_build_object('ok', true, 'run', jsonb_build_object('workflow', 'director', 'project_id', pid));

  ELSIF a = 'update_script' THEN
    IF busy THEN RETURN jsonb_build_object('ok', false, 'error', 'این ویدیو در حال پردازش است'); END IF;
    IF jsonb_typeof(req->'storyboard'->'scenes') <> 'array' OR jsonb_array_length(req->'storyboard'->'scenes') < 2 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'سناریو باید حداقل دو صحنه داشته باشد');
    END IF;
    UPDATE reel.projects SET storyboard = req->'storyboard', caption = coalesce(req->>'caption', caption), status = 'script_ready', updated_at = now() WHERE id = pid;
    RETURN jsonb_build_object('ok', true);

  ELSIF a = 'produce' THEN
    IF busy THEN RETURN jsonb_build_object('ok', false, 'error', 'این ویدیو در حال پردازش است'); END IF;
    IF NOT EXISTS (SELECT 1 FROM reel.projects WHERE id = pid AND storyboard IS NOT NULL) THEN RETURN jsonb_build_object('ok', false, 'error', 'سناریو هنوز آماده نیست'); END IF;
    UPDATE reel.projects SET status = 'script_ready', updated_at = now() WHERE id = pid;
    RETURN jsonb_build_object('ok', true, 'run', jsonb_build_object('workflow', 'producer', 'project_id', pid));

  ELSIF a = 'review' THEN
    UPDATE reel.projects SET status = CASE WHEN req->>'decision' = 'approve' THEN 'approved' ELSE 'rejected' END,
      feedback = coalesce(NULLIF(trim(coalesce(req->>'feedback', '')), ''), feedback), updated_at = now()
    WHERE id = pid AND status IN ('review', 'approved', 'rejected');
    RETURN jsonb_build_object('ok', FOUND, 'error', CASE WHEN FOUND THEN NULL ELSE 'ویدیو هنوز آماده‌ی بازبینی نیست' END);

  ELSIF a = 'delete_project' THEN
    IF busy THEN RETURN jsonb_build_object('ok', false, 'error', 'این ویدیو در حال پردازش است'); END IF;
    DELETE FROM reel.projects WHERE id = pid;
    RETURN jsonb_build_object('ok', true);

  ELSIF a = 'save_settings' THEN
    UPDATE reel.settings s SET value = trim(req->'settings'->>s.key), updated_at = now()
    WHERE s.key IN ('render_url', 'telegram_chat_id', 'max_cost_per_video_usd', 'writer_model', 'tts_model', 'video_model_standard', 'video_model_premium')
      AND req->'settings' ? s.key;
    RETURN jsonb_build_object('ok', true);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown action');
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END
$fn$;

SELECT key, value FROM reel.settings ORDER BY key;