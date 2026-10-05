/* The booklet under test, with the accounts turned off.
 *
 * Every test here runs against the same index.html that ships — read at run time, never a
 * copy kept in the repo, because a copy is a thing that goes stale and then passes while
 * testing an app that no longer exists. That is precisely what happened to the two files
 * this harness replaces.
 *
 * One line changes: SUPABASE_URL is blanked, which is the app's own supported mode — no
 * account, words kept in the browser. It is also the only mode a test can reach, since
 * signing in needs credentials no test should be holding. What that leaves untested is
 * stated in tests/README.md rather than left for someone to discover.
 *
 * The result is written to the repo root so that words.json, packs/ and img/ resolve
 * beside it exactly as they do in production. It is gitignored.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.html'), 'utf8');

const RE = /const SUPABASE_URL\s*=\s*'[^']*';/;
if (!RE.test(src)) {
  throw new Error('local-build: could not find the SUPABASE_URL constant in index.html. ' +
                  'If it was renamed, this harness is testing nothing — fix it here.');
}

const out = src.replace(RE, "const SUPABASE_URL      = '';  /* blanked by tests/local-build.mjs */");
writeFileSync(join(root, 'index.local.html'), out);
console.log('built index.local.html from index.html');
