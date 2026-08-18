// Marginalia — the enrichment gateway.
//
// One function, four routes. The design and the findings it obeys are in `LLM-GATEWAY.md`;
// what it asks the model for is in `MARGINALIA-ENRICHMENT.md`. Read F1–F6 before changing
// anything here — several of these decisions look like over-caution until you know what
// they prevent.
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
          'x-api-key': a.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
    // Everything else speaks the OpenAI body.
    : await fetch(a.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.apiKey}` },
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

async function config() {
  const { data } = await db.from('app_config').select('*').eq('app_id', APP_ID).maybeSingle();
  return data;
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
    return json({
      admin,
      // A reader is offered the button only when there is something behind it AND it has
      // answered correctly once. Enabling an untested gateway makes every reader the test.
      enabled: cfg.enabled && !!cfg.model && !!cfg.provider_id && !!cfg.tested_at,
      tested: !!cfg.tested_at,
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

    // These two are not a switch — without them there is nothing to call.
    if (!cfg.provider_id || !cfg.model) {
      return json({
        error: 'unconfigured',
        message: !cfg.provider_id
          ? 'No provider is set. Choose one, paste a key, and save.'
          : 'No model is set. Type a model name and save.',
      }, 503);
    }
    if (!cfg.enabled && !runAdmin) {
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

    const prov = await db.from('providers').select('*').eq('id', cfg.provider_id).maybeSingle();
    if (!prov.data) return json({ error: 'no provider' }, 500);

    // Own key first, shared key second — the column exists today so this is a coalesce
    // rather than a migration later.
    const own = await db.from('provider_secrets').select('api_key')
      .eq('provider_id', cfg.provider_id).eq('user_id', user.id).maybeSingle();
    const shared = own.data ? null : await db.from('provider_secrets').select('api_key')
      .eq('provider_id', cfg.provider_id).is('user_id', null).maybeSingle();
    const apiKey = own.data?.api_key ?? shared?.data?.api_key;
    if (!apiKey) return json({ error: 'no key', message: 'No API key is set for this provider.' }, 503);

    const template = fields.fields.length ? cfg.template : (cfg.propose_template || cfg.template);
    if (!template.trim()) return json({ error: 'no template', message: 'No template is set.' }, 503);

    const run = await db.from('runs').insert({
      app_id: APP_ID, subject: user.id, model: cfg.model, requested: items.items.length,
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
          model: cfg.model, prompt, temperature, maxTokens, drop: dropped,
        });
      } catch (e: any) {
        const said = String(e.said ?? '');
        const blamed = ['temperature', 'max_tokens', 'top_p'].find(
          p => said.includes(p) && !dropped.includes(p));
        if (!blamed || !(e.status >= 400 && e.status < 500)) throw e;
        dropped.push(blamed);
        return await callModel({
          adapter: prov.data.adapter, endpoint: prov.data.endpoint, apiKey,
          model: cfg.model, prompt, temperature, maxTokens, drop: dropped,
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
      return json({
        config: cfg,
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

      if (body.provider) {
        const p = body.provider;
        const row = {
          name: String(p.name ?? 'provider'),
          adapter: p.adapter === 'anthropic' ? 'anthropic' : 'openai',
          endpoint: String(p.endpoint ?? ''),
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
        body.config = { ...(body.config ?? {}), provider_id: p.id };
      }

      if (body.config) {
        const c = body.config;
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const k of ['provider_id', 'model', 'temperature', 'max_tokens', 'batch_size',
                         'template', 'propose_template', 'monthly_per_user', 'max_per_run',
                         'app_budget', 'enabled']) {
          if (k in c) patch[k] = c[k];
        }
        // Keep one version back so Revert is one click (LLM-GATEWAY §6.2).
        if ('template' in c && c.template !== cfg.template) patch.template_prev = cfg.template;
        await db.from('app_config').update(patch).eq('app_id', APP_ID);
      }

      if (body.tested) await db.from('app_config').update({ tested_at: new Date().toISOString() }).eq('app_id', APP_ID);

      return json({ ok: true, config: await config() });
    }
  }

  return json({ error: 'no such route', route }, 404);
});
