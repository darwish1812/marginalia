/* What the booklet says about the monthly allowance — which is, now, almost nothing.
 *
 * The running count used to sit under the enrich button on every load: "489 of your 500
 * words left this month." It was removed because a number that only ever goes down invites
 * rationing by a reader who was never short, and the ceiling belongs to whoever set it.
 *
 * Removing it is one line, and one line is exactly how the refusal message would have gone
 * with it. These cases exist to keep the two apart: silent while there is room, and plain
 * when there is not.
 */
import { test, expect } from '@playwright/test';

async function stock(page) {
  await page.goto('/index.local.html');
  await page.locator('#packs button').first().click();
  await page.locator('#packgo button').click();
  await page.locator('.card').first().waitFor();
}

/* The harness blanks SUPABASE_URL, so loadGateway() never runs and GATEWAY keeps its
   factory value. Setting it by hand is the whole of the arrangement these cases need. */
async function quota(page, { enabled = true, limit = 500, used = 0 } = {}) {
  return page.evaluate(({ enabled, limit, used }) => {
    GATEWAY = { enabled, auto_merge: false, quota_used: used, quota_limit: limit,
                resets: '2026-12-01' };
    showQuota();
    const el = document.getElementById('quota');
    return {
      text: el.textContent.trim(),
      warn: el.className.includes('warn'),
      shown: getComputedStyle(el).display !== 'none',
    };
  }, { enabled, limit, used });
}

/* The fault: the count was there at all. Not near the limit, not at 15% — never. */
test('a reader with words left is told nothing about them', async ({ page }) => {
  await stock(page);

  for (const used of [0, 11, 425, 480, 499]) {
    const r = await quota(page, { used });
    expect(r.text, `${used} used still produced a line`).toBe('');
    expect(r.shown, 'an empty line still claimed its row').toBe(false);
  }
});

/* The fault this guards against is the other half of the same edit: deleting the count and
   taking the refusal with it. A button that worked this morning and does nothing now, with
   nothing on screen to say why, is a broken booklet — not a tidy one. */
test('a reader out of words is told why, and when it comes back', async ({ page }) => {
  await stock(page);
  const r = await quota(page, { limit: 500, used: 500 });

  expect(r.shown).toBe(true);
  expect(r.text).toContain('500 words');
  expect(r.text, 'the reader is not told when it returns').toContain('2026-12-01');
  expect(r.text, 'nothing says the manual way still works').toContain('prompt above');
  expect(r.warn, 'the exhausted message is not marked as a warning').toBe(true);
});

/* Overspent past the ceiling is still spent: the subtraction is clamped, and a negative
   count must not read as "words left". */
test('past the ceiling reads the same as at it', async ({ page }) => {
  await stock(page);
  const r = await quota(page, { limit: 500, used: 517 });
  expect(r.text).toContain('500 words');
  expect(r.warn).toBe(true);
});

/* No gateway, or no ceiling on it, was always silent and stays silent — there is nothing
   true to say about an allowance that does not exist. */
test('nothing is said where there is no allowance', async ({ page }) => {
  await stock(page);
  expect((await quota(page, { enabled: false, used: 500 })).text).toBe('');
  expect((await quota(page, { limit: 0, used: 500 })).text).toBe('');
});
