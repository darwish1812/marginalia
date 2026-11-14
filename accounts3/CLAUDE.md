# Working in this repo

## Before anything else, check you are not a lineage behind

```
npm run check
```

This repo **has no git remote**. It is published by replaying commits into a subdirectory of
`github.com/darwish1812/marginalia`, so `git pull` tells you nothing and two checkouts can
drift apart in silence. That has already happened once: a whole spoken-words feature —
the `speak` function, `tts-voice.sql`, `tts.spec.js`, and an `index.html` that calls them —
was built and published from another checkout, and a full day of work went into rebuilding
it here against a tree that was a lineage behind.

Three answers. Only two of them mean carry on:

- **IN SYNC** — work.
- **AHEAD** — work; you have unpublished commits.
- **DIVERGED** — **stop**. Import the published tree onto a branch and diff before writing
  anything. Replaying over it reverts whatever it holds.

Resuming an old session does not re-run this. The session remembers a branch and a state
that may be months stale, and will carry on as if they were current. Run it anyway.

## Before writing code that touches the gateway

The deployed project is part of the source of truth and the repo is not all of it. Ask it
what is actually running:

```
supabase functions list --project-ref pnsmrzlncqlbrkpamnyq
```

A function can exist there and in no branch here — `speak` did, for a month. If something
is deployed that you cannot find in the checkout, find out where it came from before
writing a replacement for it.

## Publishing

See `memory` / the replay procedure: extract `git archive <sha>` into the published
subdirectory and commit with the original message and author date, one commit at a time,
because the messages carry the reasoning. Before pushing, confirm the published tree
matches the last commit you expect, that nothing outside the subdirectory changed, and that
no file present there has gone missing from your tree.

## House style

Conventional commit prefix, then prose: what was wrong, in whole sentences, including what
was tried and rejected. Comments say **why**, and name the fault they fixed. When a decision
turns out to be wrong, correct the reasoning document rather than leaving the old reasoning
to mislead. Prefer deleting what a design replaced to leaving it behind a flag.
