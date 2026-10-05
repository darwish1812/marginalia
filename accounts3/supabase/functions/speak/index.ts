// Marginalia — spoken words (OpenAI text-to-speech through the gateway).
//
// One function, two routes. It exists for one reason: the administrator's key must
// never reach a reader's browser, so the browser asks here and this asks OpenAI.
//
// Two properties carry over from the enrichment gateway beside it:
//
//   1. The client sends text and a voice name, never a key, an endpoint or a model
//      override. What actually gets called is assembled here from the stored
//      configuration (F2 over there).
//
//   2. This function writes only its own log table. It never touches the app's
//      tables (F3 over there).
//
// What it deliberately does not do: enforce a quota. The reader chose none, so
// spending is bounded by the text cap below and recorded in tts_log for the day
// a quota is wanted. A single example sentence is a few dozen characters; the
// cap below is sentences, not chapters.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APP_ID = 'marginalia';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// The service role bypasses row level security entirely — it is the key to every
// account at once. It exists here and must never be sent anywhere, logged, or
// returned.
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// The voices OpenAI sells. Anything else is either a typo or a different
// provider's name smuggled in, and neither should reach the key.
const VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
  'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

// Sentences, not chapters. An example sentence with room to spare is under two
// hundred characters; two thousand is generosity, and more importantly a ceiling
// on what one call can spend. Letters and marks from any script, the sentence
// punctuation an example needs, and nothing that could carry structure.
const TEXT = /^[\p{L}\p{M}\p{N}\s'’"“”.,!?;:\-–—()…]{1,2000}$/u;

async function caller(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user;
}

async function isAdmin(userId: string) {
  const { data } = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

// Provider rows carry chat endpoints (`…/v1/chat/completions`), not API bases —
// appending `/audio/speech` to one of those is how a 404 reading
// `/v1/chat/completions/audio/speech` happens. The base is what is left after
// the chat suffix comes off; anything else is taken as a base already.
function speechBase(endpoint: string): string {
  return String(endpoint || 'https://api.openai.com')
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|v1\/messages)$/, '');
}

// The TTS provider: the one the administrator named, falling back to the
// provider in use when that one speaks OpenAI. Anything else — Anthropic,
// local — has no /audio/speech to call, and saying so plainly beats sending
// the key somewhere it does not belong.
async function ttsKey(cfg: any): Promise<{ key: string; endpoint: string; model: string } | { error: string }> {
  const ids = [cfg?.tts_provider_id, cfg?.provider_id].filter((n) => Number.isInteger(n));
  for (const id of ids) {
    const { data: p } = await db.from('providers').select('*').eq('id', id).maybeSingle();
    if (!p || p.adapter !== 'openai') continue;
    const { data: s } = await db.from('provider_secrets')
      .select('api_key').eq('provider_id', p.id).is('user_id', null).maybeSingle();
    if (!s?.api_key) continue;
    return {
      key: s.api_key as string,
      endpoint: speechBase(p.endpoint),
      model: String(cfg?.tts_model || 'gpt-4o-mini-tts'),
    };
  }
  return { error: 'no OpenAI provider with a key is available for speech — name one in the Voice block' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  // Deployed, the path is /functions/v1/speak/... ; served locally it is /speak/... .
  const route = url.pathname.replace(/^.*\/speak/, '') || '/';

  const user = await caller(req);
  if (!user) return json({ error: 'not signed in' }, 401);
  const userId = user.id;

  const { data: cfg } = await db.from('app_config').select('*').eq('app_id', APP_ID).maybeSingle();

  // The OpenAI call itself, shared by both routes below. Throws with the
  // upstream's own words; the caller decides what the failure means.
  async function callSpeech(text: string, voice: string): Promise<ArrayBuffer> {
    const resolved = await ttsKey(cfg);
    if ('error' in resolved) throw new Error(resolved.error);
    const res = await fetch(resolved.endpoint + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + resolved.key },
      body: JSON.stringify({
        model: resolved.model,
        input: text,
        voice,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      let said = '';
      try { said = (await res.json())?.error?.message || ''; } catch { /* not json */ }
      throw new Error('it answered ' + res.status + (said ? ' — ' + said : ''));
    }
    return await res.arrayBuffer();
  }

  async function logSpeech(chars: number, voice: string, error: string | null) {
    // Written down whether it worked or not: a failure row is how a broken
    // provider is found, and a success row is what a future quota will bill.
    // Logging must never fail the request.
    try {
      await db.from('tts_log').insert({
        app_id: APP_ID,
        subject: userId,
        chars,
        voice,
        error,
      });
    } catch { /* ignore */ }
  }

  // ---- POST /test -----------------------------------------------------
  // The administrator's own ears. It bypasses the tested gate below on purpose:
  // the gate exists to keep untested voices from readers, and this is how a
  // voice earns its mark. Passing marks the voice tested; failing marks
  // nothing. Readers can never reach it — isAdmin says so first.
  if (route === '/test' && req.method === 'POST') {
    if (!(await isAdmin(userId))) return json({ error: 'not an administrator' }, 403);
    const body = await req.json().catch(() => null);
    const text = typeof body?.text === 'string' && body.text.trim() ? body.text.trim() : 'fealty';
    let voice = typeof body?.voice === 'string' ? body.voice.toLowerCase() : '';
    if (!VOICES.has(voice)) voice = String(cfg?.tts_voice || 'nova');
    if (!VOICES.has(voice)) voice = 'nova';
    if (!text || !TEXT.test(text)) return json({ error: 'bad request' }, 400);
    try {
      const audio = await callSpeech(text, voice);
      await logSpeech([...text].length, voice, null);
      await db.from('app_config').update({ tts_tested_at: new Date().toISOString() }).eq('app_id', APP_ID);
      return new Response(audio, {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      await logSpeech([...text].length, voice, why);
      return json({ error: 'the voice did not answer — ' + why }, 502);
    }
  }

  if (!cfg?.tts_enabled) return json({ error: 'spoken words are off' }, 409);
  if (!cfg?.tts_tested_at) return json({ error: 'spoken words were never tested' }, 409);

  // ---- POST / ---------------------------------------------------------
  if (route === '/' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const voice = typeof body?.voice === 'string' ? body.voice.toLowerCase() : '';
    if (!text || !TEXT.test(text)) return json({ error: 'bad request' }, 400);
    if (!VOICES.has(voice)) return json({ error: 'bad request' }, 400);

    try {
      const audio = await callSpeech(text, voice);
      await logSpeech([...text].length, voice, null);
      return new Response(audio, {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      await logSpeech([...text].length, voice, why);
      return json({ error: 'the voice did not answer — ' + why }, 502);
    }
  }

  return json({ error: 'not found' }, 404);
});
