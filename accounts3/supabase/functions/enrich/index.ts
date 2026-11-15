// Marginalia — the enrichment gateway.
//
// One function, six routes. `README.md` beside this file is how it is deployed and proved,
// and carries the refusals worth checking. The F-numbers cited throughout are the findings
// the design turns on; each is explained where it is obeyed, because several look like
// over-caution until you know what they prevent.
//
// Two properties matter more than the rest:
//
//   1. The client never sends prompt text. It sends a word list and a field list, and this
//      function assembles the prompt from a template it holds itself (F2). Otherwise the
//      administrator's key is an open proxy for anything anyone wants to ask.
//
//   2. This function does not write the app's tables. It returns text; the app validates
//      it and writes it. That keeps validation, sanitising and the write path in one place
//      in the app, where the domain lives, and it is what would let this be extracted into
//      a shared gateway serving several apps without knowing what any of them do.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APP_ID = 'marginalia';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// The service role bypasses row level security entirely — it is the key to every account
// at once. It exists here and must never be sent anywhere, logged, or returned.
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

// ---------------------------------------------------------------- validation
//
// F3. Assembling the prompt server-side is worthless without this: the instructions can
// simply be put inside the data. A "word" of two hundred characters is a prompt.
//
// Letters and marks from any script — the booklet is English words with Arabic glosses, but
// a reader may type either — plus spaces, apostrophes and hyphens. No digits, no brackets,
// no punctuation that could carry structure. Forty characters, because `ad hominem` and
// `beg the question` are legitimate and a sentence is not.
const WORD = /^[\p{L}\p{M}][\p{L}\p{M}\s'’-]{0,39}$/u;

// The cap matters as much as the pattern. A thousand valid words is still a denial of
// wallet, and it is the administrator's wallet.
const MAX_ITEMS = 200;

function validItems(items: unknown): { ok: true; items: string[] } | { ok: false; why: string } {
  if (!Array.isArray(items)) return { ok: false, why: 'items must be an array' };
  if (items.length === 0) return { ok: false, why: 'no words were sent' };
  if (items.length > MAX_ITEMS) return { ok: false, why: `too many words at once (${items.length}, the most is ${MAX_ITEMS})` };
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== 'string') return { ok: false, why: 'every word must be text' };
    const t = raw.trim();
    if (!WORD.test(t)) return { ok: false, why: `"${t.slice(0, 40)}" does not look like a word` };
    out.push(t);
  }
  return { ok: true, items: out };
}

// A field note is substituted into the template exactly as a word is, so it is an injection
// surface exactly as a word is — and unlike a word, the reader wrote it themselves and may
// have written anything.
function validFields(fields: unknown): { ok: true; fields: any[] } | { ok: false; why: string } {
  if (fields == null) return { ok: true, fields: [] };
  if (!Array.isArray(fields)) return { ok: false, why: 'fields must be an array' };
  if (fields.length > 8) return { ok: false, why: 'at most eight fields' };
  const out = [];
  for (const f of fields) {
    if (!f || typeof f !== 'object') return { ok: false, why: 'a field was not an object' };
    const id = Number((f as any).id);
    const name = String((f as any).name ?? '');
    const note = String((f as any).note ?? '');
    if (!Number.isInteger(id) || id < 1 || id > 99) return { ok: false, why: 'a field id was not a small integer' };
    if (!name.trim() || name.length > 80) return { ok: false, why: 'a field name was empty or too long' };
    if (note.length > 200) return { ok: false, why: 'a field note was too long' };
    if (/[<>]/.test(name + note)) return { ok: false, why: 'a field name or note contained angle brackets' };
    out.push({ id, name, note });
  }
  return { ok: true, fields: out };
}

// ---------------------------------------------------------------- the model call
//
// Isolated behind one interface on purpose. If this ever moves to a shared gateway serving
// several apps, extraction is a URL and a shared secret rather than a rewrite — everything
// above and below this function stays where it is.
type CallArgs = {
  adapter: string;
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  temperature: number | null;
  maxTokens: number;
  drop?: string[];        // parameters a previous attempt was told this model will not take
};

async function callModel(a: CallArgs): Promise<{ text: string; ms: number }> {
  const started = Date.now();
  const drop = a.drop ?? [];

  // Sent only when somebody has deliberately chosen one. It is a tuning knob most readers
  // never touch, enrichment wants consistent output rather than varied, and newer models
  // reject it outright — so an unset temperature means "do not mention temperature",
  // not "send the default".
  const body: Record<string, unknown> = {
    model: a.model,
    messages: [{ role: 'user', content: a.prompt }],
  };
  if (a.temperature != null && Number.isFinite(a.temperature) && !drop.includes('temperature')) {
    body.temperature = a.temperature;
  }
  if (!drop.includes('max_tokens')) {
    // Anthropic requires it; the OpenAI shape treats it as optional.
    body[a.adapter === 'anthropic' ? 'max_tokens' : 'max_tokens'] = a.maxTokens;
  }

  const res = a.adapter === 'anthropic'
    ? await fetch(a.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // A local model has no key and no use for the header; sending an empty one makes
          // some servers answer 401 about a credential nobody asked for.
          ...(a.apiKey ? { 'x-api-key': a.apiKey } : {}),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
    // Everything else speaks the OpenAI body.
    : await fetch(a.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(a.apiKey ? { Authorization: `Bearer ${a.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

  if (!res.ok) {
    const body = await res.text();
    // Providers put a precise, actionable sentence in here — "your credit balance is too
    // low", "model not found", "max_tokens too large" — and both the OpenAI and Anthropic
    // shapes keep it in the same place. Flattening that to "could not be reached" throws
    // away the only part of the answer worth reading.
    let said = '';
    try { said = JSON.parse(body)?.error?.message ?? ''; } catch (_) {}
    // The status is carried so the app can tell "the key was refused" from "slow down",
    // which are different messages to a reader and different actions to an administrator.
    throw Object.assign(new Error(body.slice(0, 400)), { status: res.status, said });
  }

  const j = await res.json();

  // Anthropic answers with an array of content blocks, not one string. Reading [0].text
  // assumes the first block is the text — it is not, whenever the model emits anything
  // before it, and the result is a silent empty reply. Take every text block and join them.
  // The OpenAI shape can also hand back a null content with the words somewhere else.
  const text = a.adapter === 'anthropic'
    ? (Array.isArray(j?.content) ? j.content : [])
        .filter((b: any) => b && (b.type === 'text' || typeof b.text === 'string'))
        .map((b: any) => b.text ?? '').join('')
    : (j?.choices?.[0]?.message?.content
       ?? j?.choices?.[0]?.message?.reasoning_content
       ?? j?.choices?.[0]?.text
       ?? '');

  // An empty reply is a failure, and until now it was a silent one: the function reported
  // success with nothing in it and the console said "not valid JSON", which is true of ""
  // and tells nobody anything. Say what actually came back instead.
  if (!String(text).trim()) {
    const why = j?.stop_reason ?? j?.choices?.[0]?.finish_reason ?? 'no reason given';
    const shape = a.adapter === 'anthropic'
      ? 'content blocks: ' + (Array.isArray(j?.content)
          ? (j.content.map((b: any) => b?.type ?? '?').join(', ') || 'none')
          : typeof j?.content)
      : 'choices: ' + (Array.isArray(j?.choices) ? j.choices.length : typeof j?.choices);
    throw Object.assign(
      new Error('the model returned no text (' + shape + ', stop reason: ' + why + ')'),
      { status: 502, said: 'The model answered with no text at all. Stop reason: ' + why
        + '. If that is "max_tokens", raise the limit; if the batch was large, lower the words per request.' },
    );
  }

  return { text: String(text), ms: Date.now() - started };
}

// ---------------------------------------------------------------- helpers

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

// An endpoint on the administrator's own desk. It is the one case where no credential is
// expected, because there is nobody to present one to.
function isLocalEndpoint(endpoint: string) {
  try {
    const h = new URL(endpoint).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch (_) { return false; }
}

async function config() {
  const { data } = await db.from('app_config').select('*').eq('app_id', APP_ID).maybeSingle();
  return data;
}

// Speech is not here. It is its own function — supabase/functions/speak — because it
// answers with audio rather than text, bills in characters rather than words, and keeps an
// allowlist of voice names this file has no use for. What this file owns is the speech
// *row* in app_capabilities, because that is where an administrator sets it; `speak` reads
// that row and never writes the choice.
//
// ---------------------------------------------------------------- capabilities
//
// Which provider does a job, which of its two models that job uses, and whether the job is
// on. This replaced app_config.provider_id, which could only name one provider for an app
// that now asks for two different things — the words may come from Anthropic while the
// voice comes from OpenAI, each with its own key.
//
// Returned together with the provider row and the resolved model, because every caller
// wants all three and fetching them separately is how two gates come to answer differently.
// `model` is the answer to "is there a model for THIS job": a provider serving the words
// has `model`, one serving the voice has `voice_model`, and one doing both has both.
//
// Read without PostgREST's embedding on purpose. The relationship would have to be named
// correctly and present in a reloaded schema cache, and a wrong guess there fails at
// runtime in a sentence about relationships rather than about providers.
type Capability = {
  job: string;
  provider_id: number | null;
  enabled: boolean;
  tested_at: string | null;
  provider: any | null;
  model: string;
};

// Both rows as the console wants them: plain, ordered, no provider attached. `capability`
// is the one that resolves a job; this is the one that answers "what is set".
async function caps() {
  const { data } = await db.from('app_capabilities').select('*').eq('app_id', APP_ID).order('job');
  return data ?? [];
}

async function capability(job: 'translate' | 'speech'): Promise<Capability | null> {
  const { data: cap } = await db.from('app_capabilities')
    .select('*').eq('app_id', APP_ID).eq('job', job).maybeSingle();
  if (!cap) return null;

  let provider: any = null;
  if (cap.provider_id) {
    const { data } = await db.from('providers').select('*').eq('id', cap.provider_id).maybeSingle();
    provider = data ?? null;
  }
  const model = job === 'speech' ? (provider?.voice_model || '') : (provider?.model || '');
  return { ...cap, provider, model } as Capability;
}

// Own key first, shared key second. Lifted out of /run because speech needs exactly the
// same answer, and a second copy of this is a second place for the precedence to be wrong.
async function keyFor(providerId: number, userId: string): Promise<string> {
  const own = await db.from('provider_secrets').select('api_key')
    .eq('provider_id', providerId).eq('user_id', userId).maybeSingle();
  if (own.data?.api_key) return own.data.api_key;
  const shared = await db.from('provider_secrets').select('api_key')
    .eq('provider_id', providerId).is('user_id', null).maybeSingle();
  return shared.data?.api_key ?? '';
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function monthReset() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

// F5. A per-user ceiling multiplied by an unbounded number of users is not a budget.
// Twenty readers at 500 each is fine; two hundred is not, and nothing would tell you before
// the invoice arrives. Both ceilings, every time, before any spending.
async function usage(subject: string, cfg: any) {
  const since = monthStart();

  const mine = await db
    .from('runs')
    .select('requested')
    .eq('app_id', APP_ID)
    .eq('subject', subject)
    .gte('started_at', since);

  const all = await db
    .from('runs')
    .select('requested')
    .eq('app_id', APP_ID)
    .gte('started_at', since);

  const sum = (r: any) => (r.data ?? []).reduce((n: number, x: any) => n + (x.requested ?? 0), 0);

  const override = await db
    .from('quota_overrides')
    .select('monthly')
    .eq('app_id', APP_ID)
    .eq('subject', subject)
    .maybeSingle();

  return {
    used: sum(mine),
    limit: override.data?.monthly ?? cfg.monthly_per_user,
    appUsed: sum(all),
    appLimit: cfg.app_budget,
    resets: monthReset(),
  };
}

function assemble(template: string, words: string[], fields: any[]) {
  return template
    .replaceAll('{{WORDS}}', words.map((w) => '- ' + w).join('\n'))
    .replaceAll('{{FIELDS}}', fields.map((f) => `${f.id} = ${f.name}: ${f.note}`).join('\n'))
    .replaceAll('{{COUNT}}', String(words.length));
}

// ---------------------------------------------------------------- routes

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  // Deployed, the path is /functions/v1/enrich/... ; served locally it is /enrich/... .
  // Strip everything up to and including the function name so both shapes route the same.
  const route = url.pathname.replace(/^.*\/enrich/, '') || '/';

  const user = await caller(req);
  if (!user) return json({ error: 'not signed in' }, 401);

  const cfg = await config();
  if (!cfg) return json({ error: 'the gateway has no configuration row' }, 500);

  // ---- GET /me ----------------------------------------------------------
  if (route === '/me' && req.method === 'GET') {
    const admin = await isAdmin(user.id);
    const u = await usage(user.id, cfg);
    const prof = await db.from('profiles').select('auto_merge').eq('id', user.id).maybeSingle();
    // Enrichment's two answers come from its own row now rather than from app_config.
    // Nothing a reader sees changes shape; only where it is read from.
    const tcap = await capability('translate');
    // Spoken words ride the same flags pattern: on, tested, and resolvable to an
    // OpenAI key. The client offers the voice list only when all three hold, so a
    // reader is never offered a button that cannot work.
    //
    // These stay on app_config. They describe how the voice sounds and whether it is on,
    // which is not the same question as which provider produces it — that one moved to
    // app_capabilities, and it is the only part of speech that did.
    const tts = cfg.tts_enabled && cfg.tts_tested_at
      ? { enabled: true, voice: String(cfg.tts_voice || 'cedar') }
      : { enabled: false, voice: String(cfg.tts_voice || 'cedar') };
    return json({
      admin,
      // A reader is offered the button only when there is something behind it AND it has
      // answered correctly once. Enabling an untested gateway makes every reader the test.
      enabled: !!(tcap?.enabled && tcap.provider_id && tcap.model && tcap.tested_at),
      tested: !!tcap?.tested_at,
      tts,
      auto_merge: !!prof.data?.auto_merge,
      quota_used: u.used,
      quota_limit: u.limit,
      resets: u.resets,
    });
  }

  // The reader's own choice about their own booklet, so they write it themselves.
  if (route === '/me' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.auto_merge !== 'boolean') return json({ error: 'bad request' }, 400);
    await db.from('profiles').update({ auto_merge: body.auto_merge }).eq('id', user.id);
    return json({ ok: true, auto_merge: body.auto_merge });
  }

  // ---- POST /run --------------------------------------------------------
  if (route === '/run' && req.method === 'POST') {
    // `enabled` is a switch about readers. An administrator sending one word through to see
    // whether the Arabic comes back is not a reader enriching, and gating the test on it
    // deadlocks: the console will not let anyone enable a gateway that has never answered
    // correctly, and nothing can answer while it is disabled. So an admin runs regardless.
    const runAdmin = await isAdmin(user.id);

    const tcap = await capability('translate');
    // These two are not a switch — without them there is nothing to call.
    const runModel = tcap?.model ?? '';
    if (!tcap?.provider_id || !runModel) {
      return json({
        error: 'unconfigured',
        message: !tcap?.provider_id
          ? 'No provider is set for the words. Choose one, paste a key, and save.'
          : 'No model is set on that provider. Edit it, type a model name and save.',
      }, 503);
    }
    if (!tcap.enabled && !runAdmin) {
      return json({ error: 'disabled', message: 'Your administrator has not finished setting this up.' }, 503);
    }

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'bad request' }, 400);

    const items = validItems(body.items);
    if (!items.ok) return json({ error: 'bad items', message: items.why }, 400);

    const fields = validFields(body.fields);
    if (!fields.ok) return json({ error: 'bad fields', message: fields.why }, 400);

    if (items.items.length > cfg.max_per_run) {
      return json({ error: 'too many', message: `At most ${cfg.max_per_run} words in one go.` }, 400);
    }

    const u = await usage(user.id, cfg);
    if (u.used + items.items.length > u.limit) {
      return json({ error: 'quota', message: `That would pass your monthly allowance of ${u.limit}. It resets on ${u.resets}.` }, 429);
    }
    if (u.appUsed + items.items.length > u.appLimit) {
      return json({ error: 'budget', message: 'This booklet has reached its monthly ceiling. Ask your administrator.' }, 429);
    }

    const prov = { data: tcap.provider };
    if (!prov.data) return json({ error: 'no provider' }, 500);

    // A model on the administrator's own machine has no credential to present, and demanding
    // one made a local provider impossible to use at all. Everything reachable over the
    // network still needs one: a missing key there is a misconfiguration, and letting it
    // through only trades a clear sentence for somebody else's 401.
    const local = isLocalEndpoint(prov.data.endpoint);
    const apiKey = await keyFor(tcap.provider_id, user.id);
    if (!apiKey && !local) {
      return json({ error: 'no key', message: 'No API key is set for this provider.' }, 503);
    }

    const template = fields.fields.length ? cfg.template : (cfg.propose_template || cfg.template);
    if (!template.trim()) return json({ error: 'no template', message: 'No template is set.' }, 503);

    const model = runModel;

    const run = await db.from('runs').insert({
      app_id: APP_ID, subject: user.id, model, requested: items.items.length,
    }).select('id').single();

    const batch = cfg.batch_size ?? prov.data.batch_size ?? 20;
    // null all the way down means "do not send it" — see callModel.
    const temperature = cfg.temperature ?? prov.data.temperature ?? null;
    const maxTokens = cfg.max_tokens ?? prov.data.max_tokens ?? 4000;

    // When a provider refuses a request because of one named parameter — "`temperature` is
    // deprecated for this model" — it has told us precisely how to succeed. Dropping that
    // parameter and asking once more is unambiguous, because the request is otherwise
    // identical. Only ever tried once, and only for a parameter we actually sent.
    const dropped: string[] = [];
    const callOnce = async (prompt: string) => {
      try {
        return await callModel({
          adapter: prov.data.adapter, endpoint: prov.data.endpoint, apiKey,
          model, prompt, temperature, maxTokens, drop: dropped,
        });
      } catch (e: any) {
        const said = String(e.said ?? '');
        const blamed = ['temperature', 'max_tokens', 'top_p'].find(
          p => said.includes(p) && !dropped.includes(p));
        if (!blamed || !(e.status >= 400 && e.status < 500)) throw e;
        dropped.push(blamed);
        return await callModel({
          adapter: prov.data.adapter, endpoint: prov.data.endpoint, apiKey,
          model, prompt, temperature, maxTokens, drop: dropped,
        });
      }
    };

    const chunks: string[][] = [];
    for (let i = 0; i < items.items.length; i += batch) chunks.push(items.items.slice(i, i + batch));

    const parts: string[] = [];
    let ms = 0;
    // Counted as it goes, because quota should follow what was actually spent. The row was
    // inserted with the full request so a crash mid-run cannot leave the allowance
    // unbilled; on a failure it is corrected down to the chunks that really went out.
    // A reader whose run died on the first chunk has consumed nothing and should not be
    // charged for the administrator's rate limit — but the failure is still recorded, so
    // it shows in the admin's failed count either way.
    let sent = 0;
    try {
      // SEQUENTIAL, never Promise.all. Ten parallel requests hit a free-tier rate limit
      // immediately, and the failure looks like a broken key rather than what it is.
      for (const chunk of chunks) {
        const r = await callOnce(assemble(template, chunk, fields.fields));
        parts.push(r.text);
        ms += r.ms;
        sent += chunk.length;
      }
    } catch (e: any) {
      await db.from('runs').update({
        error: String(e.message ?? e).slice(0, 300), ms, requested: sent,
      }).eq('id', run.data!.id);
      const s = e.status ?? 0;
      const admin = await isAdmin(user.id);
      const said = String(e.said ?? '');

      // Four different things, and telling them apart is the difference between an
      // administrator fixing it in a minute and hunting through code that is working.
      //  · refused        the key is wrong, revoked, or for another account
      //  · rate limited   nothing is wrong; wait
      //  · refused-the-request  reached and answered: no credit, bad model name, bad
      //                   parameter. The provider's own sentence is the useful part and
      //                   "could not be reached" actively misleads, because it was.
      //  · unreachable    a network fault or the provider being down
      const kind = s === 401 || s === 403 ? 'refused'
                 : s === 429 ? 'limited'
                 : s >= 400 && s < 500 ? 'rejected'
                 : 'unreachable';

      const forReader = {
        refused:     'The key was refused. Ask your administrator.',
        limited:     'The model is busy. Try again shortly.',
        rejected:    'The model refused the request. Ask your administrator.',
        unreachable: 'The model could not be reached.',
      }[kind];

      // An administrator gets the provider's own words whenever there are any — including
      // for faults we raise ourselves, like an answer with no text in it, where the
      // explanation is the entire value. A reader never does: it can carry the provider,
      // the account, sometimes the key's own prefix, and they can act on none of it.
      const forAdmin = said
        ? said
        : kind === 'refused'
          ? 'The key was refused — check it is current and belongs to this provider.'
          : forReader;

      return json({
        error: 'model',
        status: s,
        message: admin ? forAdmin : forReader,
        detail: admin ? String(e.message ?? e).slice(0, 400) : undefined,
      }, kind === 'limited' ? 429 : 502);
    }

    await db.from('runs').update({ returned: parts.length, ms }).eq('id', run.data!.id);

    return json({
      run_id: run.data!.id, chunks: parts.length, text: parts.join('\n'), parts,
      // so the console can say the model would not take something, rather than the reader
      // discovering later that a setting they typed is being quietly ignored
      dropped: dropped.length ? dropped : undefined,
    });
  }

  // ---- admin ------------------------------------------------------------
  //
  // Hiding the admin UI is cosmetic. Every route below re-checks server-side, so a forged
  // client-side answer earns a visible panel and 403 on every button in it.
  if (route.startsWith('/admin')) {
    if (!(await isAdmin(user.id))) return json({ error: 'not an administrator' }, 403);

    if (route === '/admin/config' && req.method === 'GET') {
      const provs = await db.from('providers').select('*').order('id');
      const secrets = await db.from('provider_secrets').select('provider_id, user_id');
      const since = monthStart();
      const runs = await db.from('runs').select('requested, subject, started_at, error')
        .eq('app_id', APP_ID).gte('started_at', since);
      const rows = runs.data ?? [];
      // Both jobs, always, even the one with no provider yet: the console draws a row per
      // job and an absent row would read as "this gateway cannot do that" rather than
      // "nobody has chosen one".
      const caps = await db.from('app_capabilities').select('*').eq('app_id', APP_ID).order('job');
      return json({
        config: cfg,
        capabilities: caps.data ?? [],
        providers: provs.data ?? [],
        // presence only, never the value (F4)
        keys: (secrets.data ?? []).map((s: any) => ({ provider_id: s.provider_id, shared: s.user_id === null })),
        usage: {
          words: rows.reduce((n: number, r: any) => n + (r.requested ?? 0), 0),
          runs: rows.length,
          failed: rows.filter((r: any) => r.error).length,
          readers: new Set(rows.map((r: any) => r.subject)).size,
          budget: cfg.app_budget,
          resets: monthReset(),
        },
      });
    }

    if (route === '/admin/config' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: 'bad request' }, 400);

      // One row per provider, and saving one is no longer the same act as choosing it.
      // Both used to happen together, which is how a key issued for one endpoint ended up
      // being sent to another: the row was edited in place and the secret, keyed by a row id
      // that never changed, simply stayed. Which provider is in use is now its own field.
      if (body.provider) {
        const p = body.provider;
        const row = {
          name: String(p.name ?? 'provider'),
          adapter: p.adapter === 'anthropic' ? 'anthropic' : 'openai',
          endpoint: String(p.endpoint ?? ''),
          model: String(p.model ?? ''),
          // Blank is meaningful: it is how the console knows this provider cannot be given
          // the voice, and it is the right answer for Anthropic, which serves no speech.
          voice_model: String(p.voice_model ?? ''),
        };
        if (p.id) await db.from('providers').update(row).eq('id', p.id);
        else {
          const ins = await db.from('providers').insert(row).select('id').single();
          p.id = ins.data?.id;
        }
        if (p.api_key) {
          const key = String(p.api_key);
          await db.from('provider_secrets').delete().eq('provider_id', p.id).is('user_id', null);
          await db.from('provider_secrets').insert({ provider_id: p.id, user_id: null, api_key: key });
          await db.from('providers').update({ key_last4: key.slice(-4) }).eq('id', p.id);
        }
        // The first provider to exist is adopted for the words, because a gateway with
        // exactly one and none selected is a puzzle rather than a choice. After that,
        // selection is explicit. Only the words: a provider is not given the voice by
        // default, because most providers cannot do it and a wrong default here is
        // discovered by pressing play.
        const firstTranslate = await capability('translate');
        if (!firstTranslate?.provider_id) {
          await db.from('app_capabilities')
            .update({ provider_id: p.id, updated_at: new Date().toISOString() })
            .eq('app_id', APP_ID).eq('job', 'translate');
        }
      }

      if (body.config) {
        const c = body.config;
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        // Four names have left this list. provider_id, model and enabled are per job now
        // and are written through /admin/capability; tts_provider_id went the same way,
        // because which provider speaks is the same question as which provider writes and
        // deserved the same answer. tts_model went to the provider as voice_model, beside
        // the model it uses for words.
        //
        // What stays is how the voice sounds and whether it is on, which is genuinely a
        // property of the app rather than of a provider.
        for (const k of ['temperature', 'max_tokens', 'batch_size',
                         'template', 'propose_template', 'monthly_per_user', 'max_per_run',
                         'app_budget', 'tts_enabled', 'tts_voice', 'tts_instructions']) {
          if (k in c) patch[k] = c[k];
        }
        await db.from('app_config').update(patch).eq('app_id', APP_ID);
      }

      // A successful enrichment test is a fact about that job, not about the app.
      if (body.tested) {
        await db.from('app_capabilities')
          .update({ tested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('app_id', APP_ID).eq('job', body.tested === 'speech' ? 'speech' : 'translate');
      }
      // The voice keeps its own mark where the reader-facing gate reads it. `speak` writes
      // this itself when its /test passes; the console asserts it too, because the console
      // is the one that knows a human just heard it.
      if (body.tts_tested) await db.from('app_config').update({ tts_tested_at: new Date().toISOString() }).eq('app_id', APP_ID);

      return json({ ok: true, config: await config(), capabilities: await caps() });
    }

    // ---- POST /admin/capability ------------------------------------------
    // Which provider holds a job, and whether the job is on. Its own route rather than a
    // corner of /admin/config, because it is the one write here that decides where a
    // reader's words — or a reader's voice — are sent.
    //
    // Not which voice. That is on app_config with the rest of how the voice sounds, and is
    // written through /admin/config like every other setting of that kind.
    if (route === '/admin/capability' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const job = body?.job === 'speech' ? 'speech' : body?.job === 'translate' ? 'translate' : null;
      if (!job) return json({ error: 'bad request', message: 'job must be translate or speech' }, 400);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if ('provider_id' in body) {
        const id = body.provider_id === null ? null : Number(body.provider_id);
        if (id !== null && !Number.isFinite(id)) return json({ error: 'bad request' }, 400);

        // A provider with no model for this job cannot do it, and accepting the choice here
        // would put the console and the function into disagreement about whether the job is
        // configured: the console would show a provider, /me would say unconfigured.
        if (id !== null) {
          const { data: prov } = await db.from('providers').select('*').eq('id', id).maybeSingle();
          if (!prov) return json({ error: 'no such provider' }, 400);
          const has = job === 'speech' ? prov.voice_model : prov.model;
          if (!has) {
            return json({
              error: 'no model',
              message: job === 'speech'
                ? 'That provider has no voice model set. Edit it, choose one, and save.'
                : 'That provider has no model set. Edit it, choose one, and save.',
            }, 400);
          }
        }
        patch.provider_id = id;
        // Moving a job to a DIFFERENT provider un-tests it: the previous test proved the
        // old provider answered, and carrying the tick across would be a claim nobody made.
        //
        // Re-choosing the one already set is not a move. It used to be treated as one, which
        // meant clicking a dot that was already filled switched the job off and sent you back
        // through a test you had already passed — easy to do while looking at the table, and
        // the symptom is a gateway that quietly stops serving readers.
        const current = await capability(job);
        if (current?.provider_id !== id) {
          patch.tested_at = null;
          patch.enabled = false;
        }
      }

      // Speech is switched on and off by app_config.tts_enabled, which is what `speak`
      // actually gates its reader route on and what the console's Voice row writes.
      // Accepting it here as well would set a second flag that nothing reads, and leave two
      // answers to "is the voice on" for someone to find them disagreeing.
      if ('enabled' in body && job === 'speech') {
        return json({
          error: 'wrong switch',
          message: 'Spoken words are turned on by the Voice row under What is on, not here.',
        }, 400);
      }

      if ('enabled' in body) {
        const want = !!body.enabled;
        if (want) {
          const cap = await capability(job);
          if (!cap?.provider_id || !cap.model) {
            return json({ error: 'unconfigured', message: 'Choose a provider and a model first.' }, 400);
          }
          if (!cap.tested_at) {
            return json({ error: 'untested', message: 'Send one through first — an untested job makes every reader the test.' }, 400);
          }
        }
        patch.enabled = want;
      }

      await db.from('app_capabilities').update(patch).eq('app_id', APP_ID).eq('job', job);
      return json({ ok: true, capabilities: await caps() });
    }

    // Recent failures from both gateways, newest first. Successes are not
    // listed. Reads runs + tts_log through the service role — neither table
    // has RLS policies, so only this function (admin-checked above) can see them.
    // ---- GET /admin/readers -------------------------------------------
    // Who has signed in, and what it has cost. The administrator is paying for every one
    // of these people out of one budget, and until now the only number on the page was
    // "3 readers" — a count with no way to see who, when, or who is spending it.
    //
    // auth.users is reachable from here and from nowhere else: it is not in the public
    // schema, no row level security policy can expose it, and the anon key cannot see it
    // at all. That is why this is a route on the gateway rather than a query in the
    // console, and why it is behind the same administrator check as everything else above.
    //
    // What it does NOT return: anything a reader wrote. Not their words, not their fields,
    // not a single definition. The administrator pays the bill and can see the bill; the
    // booklet is still theirs. Counting is the most this says about anybody's vocabulary.
    if (route === '/admin/readers' && req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      const perPage = Math.min(200, Math.max(1, Number(q.get('limit')) || 100));
      const page = Math.max(1, Number(q.get('page')) || 1);

      const listed = await db.auth.admin.listUsers({ page, perPage });
      if (listed.error) {
        return json({ error: 'readers', message: listed.error.message }, 502);
      }
      const users = listed.data?.users ?? [];
      const ids = users.map((u) => u.id);

      // This month's spend, in one query rather than one per reader, summed here. The row
      // count is bounded by runs in a month, which is the same set the dashboard above
      // already totals.
      const since = monthStart();
      const runs = await db.from('runs')
        .select('subject, requested, error')
        .eq('app_id', APP_ID)
        .gte('started_at', since);

      const spent = new Map<string, { words: number; runs: number; failed: number }>();
      for (const r of (runs.data ?? []) as any[]) {
        if (!r.subject) continue;
        const e = spent.get(r.subject) ?? { words: 0, runs: 0, failed: 0 };
        e.words += r.requested ?? 0;
        e.runs += 1;
        if (r.error) e.failed += 1;
        spent.set(r.subject, e);
      }

      // How many words each booklet holds. A head count per reader, because asking for the
      // rows themselves would pull every word in the system across the wire to count them —
      // and those words are the one thing this route exists not to read.
      const counted = await Promise.all(ids.map(async (id) => {
        const { count } = await db.from('words')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', id);
        return [id, count ?? 0] as const;
      }));
      const words = new Map(counted);

      const profiles = await db.from('profiles').select('id, seeded_at, auto_merge').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const prof = new Map((profiles.data ?? []).map((r: any) => [r.id, r]));

      const admins = await db.from('admins').select('subject');
      const isAdmin = new Set((admins.data ?? []).map((r: any) => r.subject));

      return json({
        page,
        perPage,
        more: users.length === perPage,
        readers: users.map((u) => {
          const s = spent.get(u.id) ?? { words: 0, runs: 0, failed: 0 };
          const p: any = prof.get(u.id) ?? {};
          return {
            id: u.id,
            email: u.email ?? null,
            // How they got in, which is worth seeing when a sign-in stops working.
            via: (u.app_metadata as any)?.provider ?? 'email',
            joined: u.created_at ?? null,
            last_seen: (u as any).last_sign_in_at ?? null,
            confirmed: !!(u as any).email_confirmed_at,
            admin: isAdmin.has(u.id),
            stocked: !!p.seeded_at,
            auto_merge: !!p.auto_merge,
            words: words.get(u.id) ?? 0,
            month: s,
          };
        }),
      });
    }

    if (route === '/admin/errors' && req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      const source = q.get('source') || 'all';
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50));
      const out: any[] = [];
      if (source === 'all' || source === 'enrichment') {
        const { data } = await db.from('runs')
          .select('started_at, model, requested, returned, error, ms')
          .eq('app_id', APP_ID).not('error', 'is', null)
          .order('started_at', { ascending: false }).limit(limit);
        for (const r of (data ?? [])) {
          out.push({
            at: (r as any).started_at,
            source: 'enrichment',
            detail: `${(r as any).model || 'model'} · ${(r as any).requested ?? 0} words`,
            message: String((r as any).error || '').slice(0, 300),
          });
        }
      }
      if (source === 'all' || source === 'voice') {
        const { data } = await db.from('tts_log')
          .select('started_at, voice, chars, error')
          .eq('app_id', APP_ID).not('error', 'is', null)
          .order('started_at', { ascending: false }).limit(limit);
        for (const r of (data ?? [])) {
          out.push({
            at: (r as any).started_at,
            source: 'voice',
            detail: `${(r as any).voice || 'voice'} · ${(r as any).chars ?? 0} chars`,
            message: String((r as any).error || '').slice(0, 300),
          });
        }
      }
      out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return json({ errors: out.slice(0, limit) });
    }

    // Deleting a provider deletes its key with it — provider_secrets cascades — which is the
    // point: a credential should not outlive the only thing that knew where to send it.
    if (route === '/admin/provider/delete' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const id = Number(body?.id);
      if (!id) return json({ error: 'bad request' }, 400);
      // app_capabilities.provider_id references this row and the reference is not ON
      // DELETE, so the delete would be refused by the database rather than by us. Clearing
      // the choice first is what makes deleting a provider in use possible at all — and the
      // job goes off with it, because a job that is enabled and pointed at nothing answers
      // every reader with a 500 instead of the manual fallback it is supposed to offer.
      //
      // Every job it held, not just one: a provider can be doing both, and leaving the
      // other row pointing at a deleted id is the same fault with a longer fuse.
      await db.from('app_capabilities')
        .update({ provider_id: null, enabled: false, tested_at: null, updated_at: new Date().toISOString() })
        .eq('app_id', APP_ID).eq('provider_id', id);
      await db.from('providers').delete().eq('id', id);
      return json({ ok: true, config: await config(), capabilities: await caps() });
    }

    // What does this provider actually serve? A model name means nothing to a provider that
    // has never heard of it, and typing one from memory is how a model ends up on an endpoint
    // that cannot answer to it. Every provider carried here keeps a catalogue beside the
    // endpoint that answers words, so it is asked rather than guessed at.
    //
    // The console asks a local provider directly — no credential exists to withhold. It comes
    // here for everything else, because the key is held here and nowhere else. The reply is a
    // list of names: no capability is added that /admin/config did not already have, since
    // saving a provider has always accepted an arbitrary endpoint and key.
    if (route === '/admin/provider/models' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const endpoint = String(body?.endpoint ?? '').trim();
      if (!endpoint) return json({ error: 'bad request' }, 400);

      // A key typed but not yet saved is used as given, so a provider can be checked before
      // it is committed. Otherwise the stored one, if this row has one.
      let apiKey = String(body?.api_key ?? '');
      if (!apiKey && body?.id) {
        const shared = await db.from('provider_secrets').select('api_key')
          .eq('provider_id', Number(body.id)).is('user_id', null).maybeSingle();
        apiKey = shared.data?.api_key ?? '';
      }

      // The catalogue sits where the verb was: chat / completions / messages are dropped and
      // `models` put in their place, leaving whatever prefix the provider uses untouched.
      // Cutting a fixed number of segments gets DeepSeek and LM Studio wrong, and a wrong
      // guess is not always refused — /v1/chat/models comes back 200 with an empty list.
      const VERB = /^(chat|completions|messages|responses|generate|invoke)$/i;
      let url: string;
      try {
        const u = new URL(endpoint);
        const parts = u.pathname.split('/').filter(Boolean);
        let popped = 0;
        while (parts.length && VERB.test(parts[parts.length - 1])) { parts.pop(); popped++; }
        if (!popped) parts.pop();
        u.pathname = '/' + parts.concat('models').join('/');
        u.search = '';
        url = u.toString();
      } catch (_) {
        return json({ error: 'bad endpoint' }, 400);
      }

      const adapter = body?.adapter === 'anthropic' ? 'anthropic' : 'openai';
      const headers: Record<string, string> = adapter === 'anthropic'
        ? { ...(apiKey ? { 'x-api-key': apiKey } : {}), 'anthropic-version': '2023-06-01' }
        : { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };

      let res: Response;
      try {
        res = await fetch(url, { headers });
      } catch (e) {
        return json({ error: 'unreachable', message: 'That provider could not be reached.' }, 502);
      }
      if (!res.ok) {
        const said = await res.text();
        let msg = ''; try { msg = JSON.parse(said)?.error?.message ?? ''; } catch (_) {}
        return json({ error: 'refused', status: res.status, message: msg || 'It would not list its models.' }, 502);
      }

      const j = await res.json().catch(() => null);
      // Both shapes answer with `data`; a couple of self-hosted servers use `models`.
      const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
      const models = raw
        .map((m: any) => (typeof m === 'string' ? m : m?.id ?? m?.name))
        .filter((x: any) => typeof x === 'string' && x)
        .slice(0, 500);   // a catalogue, not a payload

      return json({ models });
    }

    // Removing a key without removing the provider. There was no way to do this at all: the
    // only operation on a secret was to overwrite it with a different one.
    if (route === '/admin/provider/forget-key' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const id = Number(body?.id);
      if (!id) return json({ error: 'bad request' }, 400);
      await db.from('provider_secrets').delete().eq('provider_id', id).is('user_id', null);
      await db.from('providers').update({ key_last4: '' }).eq('id', id);
      return json({ ok: true, config: await config() });
    }
  }

  return json({ error: 'no such route', route }, 404);
});
