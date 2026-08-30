# delete-account

One route. A signed-in reader deletes their own account and everything hanging off it.

```bash
supabase functions deploy delete-account
```

**No secrets to set.** It uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, both of which
the platform injects into every edge function. If you have already deployed `enrich`, there
is nothing else to do.

**Until it is deployed the button exists and fails**, saying so in the dialog — `HTTP 404`.
That is the right failure: nothing local is thrown away unless the account actually went.

## Why it is its own function

`enrich` is the gateway, and its own note says it does not write the app's tables: it returns
text and the app decides what to keep. This one does nothing but delete. They should not be
able to be confused for each other in a hurry, and they should not be redeployed together.

## Why the client cannot do this

Removing a row from `auth.users` needs the service role, and the service role bypasses row
level security entirely — it is the key to every account at once. It lives here and is never
sent anywhere.

The caller is identified from their JWT and nothing else. **There is no user id in the body**
and there is no route for deleting somebody else: an endpoint that took an id would be one
typo away from being an endpoint that empties the project.

## What it deletes, and in what order

`runs` first, by hand, then the user.

Every other table the reader owns — `profiles`, `words`, `fields`, `corrections`, `faults` —
references `auth.users` with `on delete cascade`, so deleting the user takes them with it.
`runs` does not: it lives in `gateway.sql` rather than `schema.sql`, and `subject` is a bare
`uuid` with no foreign key at all. Left alone it would outlive an account whose owner had been
told everything was gone.

That is deleted here rather than fixed with a foreign key on purpose. A constraint added to a
table that already holds rows pointing at users who no longer exist fails to apply, and the
migration to clean that up first is a worse thing to get wrong than one explicit delete in the
only place accounts are ever removed. If you would rather have the constraint, delete the
orphans first and it becomes belt and braces.

The user goes last. The other way round, the cascade fires while the client still holds a live
session — signed in, with the words already gone, which is the worst state to fail in.

## What it returns

`{ok:true}`, or `{error}` with a status. **Nothing about the reader is returned and nothing is
logged.** A function whose whole purpose is that somebody wanted to stop existing here should
not leave a note saying who did.

## Proving it

There is no test for this in `tests/`, and there cannot be one: it needs a real session and a
real account, and the suite holds no credentials. Prove it by hand, on a throwaway account:

1. Sign up, stock a pack, mark a word.
2. **You → Starting over → Delete my account.** Take the copy on the way out and check the
   file has your words in it.
3. Confirm. You should land on the gate with *Your account and everything in it is gone.*
4. In the dashboard: no rows for that uid in `words`, `fields`, `corrections`, `faults`,
   `profiles`, `runs`, and the user gone from Authentication.
5. Sign up again with the same address. You should be asked what you read, with an empty
   booklet.
