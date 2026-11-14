/* Marginalia — the offline shell.
 *
 * The booklet has always kept its words in localStorage, so the data survived losing
 * signal. The *app* did not: with no network, Chrome could not fetch index.html, so you
 * got the error page and the words sat in storage with nothing able to read them. This
 * file is the fix, and it is the whole of it — no build step, no bundler, one script.
 *
 * What it does NOT touch, and why that matters more than what it does:
 *
 *   - Anything that is not a GET. A POST to /run or /test is a thing happening in the
 *     world; replaying one from a cache would charge an allowance twice.
 *   - Anything on another origin except the one script the page cannot start without.
 *     Supabase auth, the REST rows and the Edge Functions all go straight to the network,
 *     every time. A cached session or a cached row is a lie about somebody's account, and
 *     a cached 401 is worse.
 *
 * Strategy is stale-while-revalidate for everything it does handle: answer from the cache
 * at once, fetch in the background, and keep what comes back for next time. That was
 * chosen over a version-named cache on purpose. This project has no build step and nobody
 * to remember to bump a number, so a cache keyed on a version would have gone stale the
 * first time somebody published without touching it — and stale forever, silently. This
 * way a publish reaches a reader on their next open, without anyone remembering anything.
 */

const CACHE = 'marginalia-shell';

/* The shell: everything needed to open the booklet and read what is already in it.
   Not img/ beyond the three the starter pack draws — the rest arrive on demand and are
   kept by the handler below the first time they are seen. */
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'words.json',
  'packs/business.json',
  'packs/academic.json',
  'icon.svg',
  'icon-32.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png',
  'img/radish.svg',
  'img/rodent.svg',
  'img/porridge.svg',
];

/* The one cross-origin file worth holding. Without supabase-js the page throws on load
   rather than falling back to local mode, so an offline open would fail for a reason that
   has nothing to do with being offline. Fetched no-cors, so what lands is opaque — it
   cannot be read here, only handed back, which is all that is wanted. */
const VENDOR = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* One at a time rather than addAll: addAll is all-or-nothing, so a single file renamed
       in the booklet would leave a reader with no offline shell at all and no clue why. */
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    /* fetch-then-put, not cache.add. add() runs the response through the same check as a
       normal request and rejects anything outside 2xx — and an opaque response has status
       0, so add() threw every time and the one file that cannot be missed was the one file
       never stored. It failed silently because this line catches, which is right for a
       CDN that may be down and was wrong for a bug. */
    await fetch(VENDOR, { mode: 'no-cors' })
      .then(res => cache.put(VENDOR, res))
      .catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const mine = url.origin === self.location.origin;
  if (!mine && req.url !== VENDOR) return;      // Supabase, and anything else, goes out.

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });

    const live = fetch(req).then(res => {
      /* An opaque response has status 0 and is still worth keeping — that is what a no-cors
         fetch of the vendor script looks like. A real error is not. */
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    if (hit) return hit;                        // instant, and revalidating behind us
    const res = await live;
    if (res) return res;

    /* Offline, and nothing cached under this exact request. A navigation still has
       somewhere to go: the shell. Anything else legitimately fails. */
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'offline' });
  })());
});
