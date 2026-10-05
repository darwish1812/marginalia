/* Spoken words (OpenAI through the gateway), pinned without an account.
 *
 * The local harness blanks SUPABASE_URL, so there is no session and no gateway —
 * cloudOn() is false here by construction. What is pinned is everything around
 * the network: the toggle contract, the cache (repeats never re-fetch), the
 * silent OS fallback, and the validation that keeps absurd input off the wire.
 * The wire itself — key, endpoint, MP3 bytes — is the Test voice button's job
 * in admin.html, where a human hears it.
 */
import { test, expect } from '@playwright/test';

async function stock(page) {
  await page.goto('/index.local.html');
  await page.locator('#packs button').first().click();
  await page.locator('#packgo button').click();
  await page.locator('.card').first().waitFor();
}

/* Factory bytes: a stub MP3 is never decoded — play() is stubbed too — so four
   bytes stand in for any audio. What matters is the journey, not the sound. */
const BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x00]);

async function withStubs(page, { fail = false } = {}) {
  /* Counted inside the page: counting from the route handler would mean calling
     back into the page from inside request handling, which deadlocks. */
  await page.addInitScript(() => {
    window.__fetchCount = 0;
    window.__played = [];
    const _fetch = window.fetch;
    window.fetch = function (url, opts) {
      if (String(url).includes('/functions/v1/speak')) window.__fetchCount++;
      return _fetch.call(this, url, opts);
    };
    const proto = window.HTMLAudioElement.prototype;
    proto.play = function () {
      window.__played.push({ src: this.currentSrc || this.src, rate: this.playbackRate });
      return Promise.resolve();
    };
  });
  await page.route('**/functions/v1/speak', async (route) => {
    if (fail) return route.abort();
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from(BYTES) });
  });
}

test('without an account the cloud path never fires', async ({ page }) => {
  await page.addInitScript(() => {
    window.__fetchCount = 0;
    const _fetch = window.fetch;
    window.fetch = function (url, opts) {
      if (String(url).includes('/functions/v1/speak')) window.__fetchCount++;
      return _fetch.call(this, url, opts);
    };
  });
  await stock(page);
  const r = await page.evaluate(() => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    speak('fealty', btn);
    const out = { cloud: cloudOn(), fetches: window.__fetchCount || 0 };
    stopSpeech(); current = null;
    btn.remove();
    return out;
  });
  expect(r.cloud, 'the gateway answered with no account').toBe(false);
  expect(r.fetches, 'the OS path reached for the network').toBe(0);
});

test('a repeat never re-fetches, and the button shows speaking', async ({ page }) => {
  await withStubs(page);
  await stock(page);
  const r = await page.evaluate(async () => {
    /* A session the harness can never really have: without one the code
       correctly refuses to even ask, which the first test pins. Here the
       network itself is under test, so the session is lent. */
    testSession = async () => ({ access_token: 'test' });
    aiVoice = 'nova';
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await speakCloud('fealty', btn);
    const first = {
      speaking: btn.classList.contains('speaking'),
      played: window.__played.length,
      rate: window.__played.length ? window.__played[0].rate : null,
    };
    const btn2 = document.createElement('button');
    document.body.appendChild(btn2);
    await speakCloud('fealty', btn2);
    const out = { first, fetches: window.__fetchCount, secondSpeaking: btn2.classList.contains('speaking') };
    stopSpeech(); current = null;
    btn.remove(); btn2.remove();
    return out;
  });
  expect(r.first.speaking, 'no speaking state on the button').toBe(true);
  expect(r.first.played, 'audio never played').toBe(1);
  expect(r.first.rate, 'the rate did not reach the element').toBe(0.9);
  expect(r.fetches, 'the repeat went back to the network').toBe(1);
  expect(r.secondSpeaking, 'the cached repeat shows nothing').toBe(true);
});

test('a failed fetch falls back silently', async ({ page }) => {
  /* No engine here at all. Deleted, not nulled: the app detects speech with
     `'speechSynthesis' in window`, and a present-but-undefined property reads
     as an engine that then explodes on first touch. */
  await page.addInitScript(() => {
    try { delete window.speechSynthesis; } catch {}
  });
  await withStubs(page, { fail: true });
  await stock(page);
  const r = await page.evaluate(async () => {
    testSession = async () => ({ access_token: 'test' });
    aiVoice = 'nova';
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await speakCloud('a sentence that will not arrive', btn);
    const out = {
      fetches: window.__fetchCount,
      speaking: btn.classList.contains('speaking'),
      currentNull: current === null,
    };
    btn.remove();
    return out;
  });
  expect(r.fetches, 'nothing was even attempted').toBe(1);
  expect(r.speaking, 'the failed button stayed lit').toBe(false);
  expect(r.currentNull, 'a dead request still owns the voice').toBe(true);
});

test('absurd input never reaches the network', async ({ page }) => {
  await page.addInitScript(() => {
    try { delete window.speechSynthesis; } catch {}
  });
  await withStubs(page);
  await stock(page);
  const r = await page.evaluate(async () => {
    aiVoice = 'nova';
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await speakCloud('', btn);
    await speakCloud('x'.repeat(2001), btn);
    await speakCloud('pay <b>now</b>', btn);
    const out = { fetches: window.__fetchCount, speaking: btn.classList.contains('speaking') };
    stopSpeech(); current = null;
    btn.remove();
    return out;
  });
  expect(r.fetches, 'validation let something through').toBe(0);
  expect(r.speaking).toBe(false);
});
