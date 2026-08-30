// Marginalia — the way out.
//
// One route, one job: delete the caller's own account and everything hanging off it. The
// browser cannot do this. Removing a row from `auth.users` needs the service role, and the
// service role is the key to every account at once — so it lives here and the client is only
// ever allowed to say "me".
//
// It is deliberately not a seventh route on `enrich`. That function's own design note says
// it does not write the app's tables, and it means it: it returns text and the app decides
// what to keep. This one does nothing but write, and the two should not be able to be
// confused for each other in a hurry. Separate function, separate deploy, separate blast
// radius — the only thing they share is the service key they both already needed.
//
// The caller is identified from their JWT and nothing else. There is no user id in the body
// and there is no route for deleting somebody else: an endpoint that took an id would be one
// typo away from being an endpoint that empties the whole project.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

async function caller(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const user = await caller(req);
  if (!user) return json({ error: 'Sign in first.' }, 401);

  // `runs` first, and by hand.
  //
  // Every other table the reader owns — profiles, words, fields, corrections, faults —
  // references auth.users with `on delete cascade`, so removing the user takes them with it
  // and there is nothing to write here. `runs` does not: it lives in gateway.sql rather than
  // schema.sql, and `subject` is a bare uuid with no foreign key at all. Left alone it would
  // outlive an account whose owner had been told everything was gone, which is a quieter
  // kind of lie than most.
  //
  // Deleting it here rather than adding the foreign key is deliberate. A constraint added to
  // a table that already holds rows pointing at users who no longer exist fails to apply, and
  // the migration that fixes that is a worse thing to get wrong at three in the morning than
  // one explicit delete in the one place accounts are ever removed.
  const runs = await db.from('runs').delete().eq('subject', user.id);
  if (runs.error) return json({ error: 'Could not clear the run history.' }, 500);

  // The user last. The other way round, the cascade fires while the client still holds a live
  // session, and a half-deleted account is the worst state to fail in — signed in, with the
  // words already gone.
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return json({ error: 'The account was not deleted.' }, 500);

  // Nothing about the reader is returned, and nothing is logged. A function whose whole
  // purpose is that somebody wanted to stop existing here should not leave a note saying
  // who did.
  return json({ ok: true });
});
