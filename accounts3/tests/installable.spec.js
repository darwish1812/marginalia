/* What makes this an app rather than a page it can be installed from.
 *
 * None of it is visible in the booklet, which is exactly why it needs pinning: a manifest
 * naming an icon that was never published, or a shell listing a file that has been renamed,
 * fails silently on somebody else's phone weeks later.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL('../' + p, import.meta.url));
const read = p => readFileSync(at(p), 'utf8');

const MANIFEST = JSON.parse(read('manifest.json'));

/* The fault: an icon entry is a promise that a file exists at that path. Nothing checks it
   at build time, because there is no build. */
test('every icon the manifest names is actually there', () => {
  expect(MANIFEST.icons.length).toBeGreaterThan(0);
  for (const i of MANIFEST.icons)
    expect(existsSync(at(i.src)), `${i.src} is named in the manifest and not in the repo`).toBe(true);
});

/* The fault: with no maskable icon Android shrinks the whole image into a white circle —
   the sad little stamp that marks a badly packaged app. One is enough; it only has to be
   there for the launcher to stop guessing. */
test('one icon is drawn to be cropped', () => {
  const maskable = MANIFEST.icons.filter(i => String(i.purpose).split(/\s+/).includes('maskable'));
  expect(maskable.length, 'no maskable icon, so a launcher will letterbox the lot').toBe(1);
  expect(maskable[0].sizes).toBe('512x512');
  expect(maskable[0].type).toBe('image/png');
});

/* The fault: `id` resolves against the ORIGIN, not the manifest. This booklet lives in a
   subdirectory of a github.io account that hosts other things, so an id of "/" or "./"
   would claim the whole origin and collide with them. Absent is correct — start_url then
   serves as the identity, and that is unique. */
test('no id is claimed', () => {
  expect(MANIFEST.id).toBeUndefined();
});

const SW = read('sw.js');

/* The fault this exists to prevent is the expensive one: a cached POST would let a reply
   that was paid for once be served twice, and a cached Supabase response is a lie about
   somebody's account — a stale session, a stale row, or a 401 that has stopped being true. */
test('the worker refuses anything but same-origin GETs', () => {
  expect(SW).toContain("req.method !== 'GET'");
  expect(SW).toMatch(/url\.origin\s*===\s*self\.location\.origin/);
  expect(SW, 'Supabase must never be answered from a cache').not.toContain('supabase.co');
});

/* The fault: the shell lists paths by hand, and a renamed file leaves a reader with a
   worker that installs happily and cannot open the booklet offline. */
test('every file the shell precaches is actually there', () => {
  const list = SW.slice(SW.indexOf('const SHELL'), SW.indexOf('];', SW.indexOf('const SHELL')));
  const paths = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(p => p !== './');
  expect(paths.length).toBeGreaterThan(5);
  for (const p of paths)
    expect(existsSync(at(p)), `${p} is precached by sw.js and not in the repo`).toBe(true);
});

/* The fault: index.local.html is a copy of index.html with the project URL blanked. A
   registration written without this guard installs a worker into the Playwright run and
   starts serving it yesterday's HTML — a flaky suite whose cause nobody would look for. */
test('the worker stays out of the test harnesses', async ({ page }) => {
  const guard = /\.\(local\|test\)\?\.html\$/;
  expect(read('index.html')).toMatch(/serviceWorker.*\n?.*local\|test/);

  await page.goto('/index.local.html');
  await page.waitForTimeout(500);
  const controlled = await page.evaluate(async () =>
    !!navigator.serviceWorker && (await navigator.serviceWorker.getRegistrations()).length > 0);
  expect(controlled, 'the harness registered a service worker').toBe(false);
});

/* The fault: the worker's scope is the whole origin, so it cached admin.html like anything
   else and served the gateway console from disk — a page whose entire job is to show the
   live state of the providers, the switches and the budget, handed back a version behind.
   It is also useless offline: every control on it is a call to the gateway. */
test('the service worker never serves the gateway console', () => {
  expect(SW, 'nothing excludes the console').toContain('isConsole');
  expect(SW, 'the console is precached').not.toContain("'admin.html'");

  /* And that the fetch handler actually consults it. An earlier version of this test only
     proved isConsole existed and behaved, so deleting the one line that calls it left every
     assertion green while the console went back to being served from cache. */
  expect(SW, 'isConsole is defined but never used in the fetch handler')
    .toMatch(/if\s*\([^)]*isConsole\(url\)[^)]*\)\s*return;/);

  /* The rule itself, exercised rather than read. */
  const m = SW.match(/const isConsole = url => (.+);/);
  expect(m, 'isConsole is gone or renamed').not.toBeNull();
  const isConsole = eval('url => ' + m[1].replace(/^url => /, ''));
  for (const p of ['/admin.html', '/marginalia/accounts3/admin.html'])
    expect(isConsole({ pathname: p }), `${p} would be cached`).toBe(true);
  for (const p of ['/index.html', '/', '/packs/business.json', '/words.json'])
    expect(isConsole({ pathname: p }), `${p} would stop being cached`).toBe(false);
});
