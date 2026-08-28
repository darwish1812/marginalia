# The tests

```bash
npm install
npx playwright install chromium
npm test
```

`npm run test:headed` to watch it happen, `npm run test:ui` to step through one.

**The app still has no build step.** Everything here is development tooling: `index.html`
opens in a browser exactly as it always did, and none of this ships. The booklet's one
runtime dependency is still the Supabase client.

## How it runs

`tests/local-build.mjs` reads `index.html` at run time and writes `index.local.html` with
one line changed — `SUPABASE_URL` blanked. That is the app's own supported mode: no
account, words kept in the browser.

It is built each run rather than kept in the repo, because **a copy kept in the repo goes
stale and then passes while testing an app that no longer exists.** That is precisely what
happened to `index.test.html` and `index.auto.test.html`, which drifted 1,600 lines behind
and were still sitting there looking like tests.

`tests/serve.mjs` serves the repo root, because the booklet fetches `words.json` and
`packs/*.json` by relative path and has to be served beside them.

## What it does not cover

**Everything behind a sign-in.** Sync between devices, row-level security in practice,
stocking a new account, the offline mirror, the sign-in gate itself, and the OAuth
redirects. All of it needs credentials, and a test suite should not be holding any.

That gap is not small and it is where a real fault already hid: the iPad redirect bug lived
at the gate, which is the one place nothing here can reach. Until there is a throwaway test
account, **that half of the app is checked by hand or not at all.**

Also uncovered: printing, speech (the runner has no voice), and anything that needs a real
touchscreen — the swipe is driven by mouse events, which exercises the same handler but not
iOS's own gesture handling.

## Writing a new one

Cases here are mostly faults that reached a reader, and each says which one it stands for.
Keep that up. A test whose reason is written down survives a rewrite; one that only asserts
gets deleted by whoever finds it inconvenient.

Every test also fails on anything the page throws — `pageerror` and console errors are
collected per test and asserted empty. Two of the six faults were uncaught exceptions, so
that one rule would have caught a third of them on its own.
