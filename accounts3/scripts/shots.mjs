/* The screenshot matrix: every destination on every device, plus the states a
 * static review misses — an open flashcard round and the first-run gate.
 *
 * Usage: npm run shots
 * Output: shots/<dest>-<phone|tablet|desktop>.png (18 files, gitignored)
 *
 * This builds a fresh local copy, starts its own server (the same
 * tests/serve.mjs the suite uses) on a free port, and stops it afterwards,
 * so it never depends on whatever happens to be listening.
 *
 * Comparison is by eye, on purpose: these shots are for looking at after a
 * CSS/layout change, not pixel-diffing in CI. A blank render fails the run —
 * every file must exist and be bigger than an empty page. */
import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { chromium, expect } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'shots');
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1440, height: 900 },
};

/* Stock the booklet the way the suite does: first pack, go, cards on screen. */
async function stock(page, base) {
  await page.goto(base + '/index.local.html');
  await page.locator('#packs button').first().click();
  await page.locator('#packgo button').click();
  await page.locator('.card').first().waitFor();
}

async function shot(page, name) {
  /* Transitions and webfonts land within a beat; the shots should show the
     resting state, not mid-flight. */
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, name), fullPage: true });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function waitUp(base, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + '/index.local.html', { method: 'HEAD' });
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('server never came up at ' + base);
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
execFileSync(process.execPath, [join(root, 'tests', 'local-build.mjs')], { stdio: 'inherit' });
const srv = spawn(process.execPath, [join(root, 'tests', 'serve.mjs')], {
  env: { ...process.env, PORT: String(port) },
  stdio: 'inherit',
});
let failed = false;
try {
  await waitUp(base);
  const browser = await chromium.launch();
  try {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      /* First-run first, on a page that has never stocked: the pack picker. (The
         sign-in gate itself is unreachable in this harness — no account backend —
         which tests/README.md already states for the suite.) */
      {
        const page = await browser.newPage({ viewport: vp });
        await page.goto(base + '/index.local.html');
        await page.locator('#packs').waitFor();
        await shot(page, `first-run-${name}.png`);
        await page.close();
      }
      const page = await browser.newPage({ viewport: vp });
      await stock(page, base);
      await page.locator('.dest[data-dest="book"]').click();
      await page.locator('.card').first().waitFor();
      await shot(page, `book-${name}.png`);
      await page.locator('.dest[data-dest="add"]').click();
      await page.locator('#panel.on').waitFor();
      await shot(page, `add-${name}.png`);
      await page.locator('.dest[data-dest="study"]').click();
      await page.locator('#fc').waitFor();
      await shot(page, `study-${name}.png`);
      await page.locator('#fc-all').click();
      await page.locator('#fc-go').click();
      await page.locator('#fc-card').waitFor();
      await shot(page, `flashcards-${name}.png`);
      /* The deck is an overlay; close it before moving on. */
      await page.locator('#fc-x').click();
      await expect(page.locator('#fc')).toBeHidden();
      await page.locator('.dest[data-dest="you"]').click();
      await page.locator('#settings').waitFor();
      await shot(page, `you-${name}.png`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  srv.kill();
}

/* Blank renders fail the run. 12KB is far below any real page — flat night
   backgrounds compress hard, so a small flashcard shot is no alarm — and far
   above an empty one. */
const expected = [];
for (const name of Object.keys(VIEWPORTS)) {
  for (const dest of ['first-run', 'book', 'add', 'study', 'flashcards', 'you']) {
    expected.push(`${dest}-${name}.png`);
  }
}
for (const f of expected) {
  let kb = 0;
  try { kb = statSync(join(outDir, f)).size / 1024; } catch {}
  console.log(`${kb.toFixed(0).padStart(5)}KB  ${f}`);
  if (kb < 12) { failed = true; console.error(`BLANK OR MISSING: ${f}`); }
}
process.exit(failed ? 1 : 0);
