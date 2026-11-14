#!/usr/bin/env node
//
// Is this checkout current?
//
// This repo has no remote. It is published by replaying commits into a subdirectory of
// github.com/darwish1812/marginalia, which means `git pull` cannot tell you anything and
// two checkouts can drift apart in silence for weeks. One of them did: a whole spoken-words
// feature was built and published from somewhere else, and work continued here for a day
// against a tree that was a lineage behind, rebuilding things that already existed.
//
// So: before touching anything, ask the published tree whether it recognises you.
//
//   node scripts/check-published.mjs
//
// Three answers, and only one of them means "carry on":
//
//   IN SYNC   the published tree is exactly your HEAD. Work.
//   AHEAD     the published tree is one of your ancestors. Work; you have unpublished commits.
//   DIVERGED  the published tree is in none of your history. STOP. Something was published
//             from another checkout. Import it before writing a line — replaying over it
//             would revert whatever it holds.
//
// The publish clone defaults to ../Marginalia and the directory to accounts3; both can be
// overridden, because both have moved before and will move again:
//
//   MARGINALIA_PUB=../somewhere MARGINALIA_DIR=accounts4 node scripts/check-published.mjs

import { execFileSync } from 'node:child_process';

const PUB = process.env.MARGINALIA_PUB ?? '../Marginalia';
const DIR = process.env.MARGINALIA_DIR ?? 'accounts3';

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();

function die(msg, code = 2) {
  console.error('check-published: ' + msg);
  process.exit(code);
}

let publishedTree;
try {
  // Fetch rather than trust: the publish clone is usually left behind, and a stale
  // origin/main would report IN SYNC against a tree that has since moved on.
  git(['-C', PUB, 'fetch', 'origin', 'main', '-q']);
  publishedTree = git(['-C', PUB, 'rev-parse', `origin/main:${DIR}`]);
} catch (e) {
  die(`could not read ${DIR}/ from ${PUB}. Set MARGINALIA_PUB / MARGINALIA_DIR if either has moved.\n  ${e.message}`);
}

const headTree = git(['rev-parse', 'HEAD^{tree}']);

if (publishedTree === headTree) {
  console.log(`IN SYNC — ${DIR}/ is exactly HEAD (${git(['rev-parse', '--short', 'HEAD'])}).`);
  process.exit(0);
}

// Does the published tree belong to anything we know about? Checking every commit in the
// repo, not just this branch: the work may have been published from a branch we are not on.
const owner = git(['rev-list', '--all'])
  .split('\n')
  .filter(Boolean)
  .find((sha) => {
    try { return git(['rev-parse', `${sha}^{tree}`]) === publishedTree; }
    catch { return false; }
  });

if (owner) {
  const behind = git(['rev-list', '--count', `${owner}..HEAD`]);
  console.log(`AHEAD — ${DIR}/ matches ${git(['log', '-1', '--format=%h %s', owner])}`);
  console.log(`         you have ${behind} commit(s) not published yet.`);
  process.exit(0);
}

console.log(`DIVERGED — ${DIR}/ holds tree ${publishedTree.slice(0, 12)}, which is in none of this`);
console.log(`           repository's history. Something was published from another checkout.`);
console.log('');
console.log('           Import it before writing anything:');
console.log(`             git -C ${PUB} archive origin/main:${DIR} | tar -x -C <empty dir>`);
console.log('           then commit that tree on a branch and diff the two.');
console.log('');
console.log('           Replaying over it would revert whatever it holds.');
process.exit(1);
