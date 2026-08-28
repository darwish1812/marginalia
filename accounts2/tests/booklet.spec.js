// @ts-check
/* The booklet, exercised.
 *
 * Nearly every case below is a fault that actually reached a reader in the week the shell
 * was built, written down so it cannot reach one twice. Where that is so, the case says
 * which fault it stands for — a test whose reason is written down survives a rewrite; one
 * that only asserts is deleted by whoever finds it inconvenient.
 */
import { test, expect } from '@playwright/test';

const PHONE   = { width: 390, height: 844 };
const TABLET  = { width: 834, height: 1112 };
const DESKTOP = { width: 1440, height: 900 };

/* A fresh browser is a booklet that has never been stocked, so every test answers the
 * first-run question before it can do anything else. */
async function stock(page) {
  await page.goto('/index.local.html');
  await expect(page.locator('#packs button').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#packs button').first().click();
  await page.locator('#packgo button').click();
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 15000 });
}

/* Nothing in this app should ever reach the console. A thrown exception is the exact class
 * of fault that shipped twice, so it fails the test that provoked it rather than being left
 * for someone to notice in a screenshot. */
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.__errors = errors;
});
test.afterEach(async ({ page }) => {
  const noise = /favicon|ERR_INTERNET_DISCONNECTED|net::ERR_NAME_NOT_RESOLVED|supabase/i;
  const real = (page.__errors || []).filter(e => !noise.test(e));
  expect(real, 'the page threw').toEqual([]);
});

test.describe('the book', () => {
  test('stocks itself and draws the index', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await expect(page.locator('.card')).toHaveCount(154);
    await expect(page.locator('.idxrow')).toHaveCount(8);
    await expect(page.locator('.sec')).toHaveCount(8);
  });

  /* Was: renderIndex lived inside render(), so setField() could not see it. The book
     filtered but the pressed state never arrived, which was the only visible symptom. */
  test('a field in the index filters the book and shows as pressed', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const row = page.locator('.idxrow[data-field="4"]');
    await row.click();
    await expect(page.locator('.idxrow[data-field="4"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sec:visible')).toHaveCount(1);
    await page.locator('.idxrow[data-field="4"]').click();
    await expect(page.locator('.sec:visible')).toHaveCount(8);
  });

  test('search reaches the meaning, not just the word', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('#q').fill('loyalty');
    await expect(page.locator('.card:visible')).toHaveCount(1);
    await expect(page.locator('.card:visible .word')).toHaveText('fealty');
  });

  /* Was: on a wide screen a card could not open at all — clicking filled a column down the
     side instead, so the desktop was the one size where the thing you clicked was not the
     thing that answered. */
  test('a card opens where it sits, and closes again', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const card = page.locator('.card').first();
    await expect(card.locator('.ex')).toBeHidden();
    await card.click();
    await expect(card).toHaveClass(/open/);
    await expect(card.locator('.ex')).toBeVisible();
    await expect(card.locator('.say-ex')).toBeVisible();
    await card.click();
    await expect(card).not.toHaveClass(/open/);
  });

  /* Was: a drawing is what the word looks like and was swept in with the detail that
     unfolds, so it waited to be asked for. */
  test('a drawing shows on a closed card', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const withPic = page.locator('.card', { has: page.locator('.pic') }).first();
    await expect(withPic).not.toHaveClass(/open/);
    await expect(withPic.locator('.pic')).toBeVisible();
  });

  /* Was: hearing a word is the point of this booklet and the speaker went missing from
     every card but the desktop inspector. */
  test('every card carries its speaker', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const cards = await page.locator('.card').count();
    await expect(page.locator('.card .say')).toHaveCount(cards);
  });
});

test.describe('the card menu', () => {
  /* Was: taking the per-card Arabic button out deleted three neighbouring handlers with
     it. The ⋯ opened nothing, and filing, unfiling and removing were all dead. */
  test('the ⋯ opens, and files a word into another field', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const card = page.locator('.card').first();
    const word = await card.getAttribute('data-w');
    await card.locator('.more').click();
    await expect(page.locator('.card-menu')).toBeVisible();
    await page.locator('.card-menu button', { hasText: 'Power & Conflict' }).click();
    await expect(page.locator(`#f3 [data-w="${word}"]`)).toHaveCount(1);
  });

  test('removing asks first, and cancelling leaves the word alone', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const card = page.locator('.card').first();
    const word = await card.getAttribute('data-w');
    /* The menu hangs off <body> and is built fresh each time, so a second open has to wait
       for the first to be gone — otherwise the click lands on a button that is about to be
       detached, which is a flake and not a fault. */
    const openMenu = async () => {
      await expect(page.locator('.card-menu')).toHaveCount(0);
      await card.locator('.more').click();
      await expect(page.locator('.card-menu')).toBeVisible();
    };

    await openMenu();
    await page.locator('.card-menu button', { hasText: /Remove/i }).click();
    await expect(card.locator('.cm-confirm')).toBeVisible();
    await card.locator('[data-cancelremove]').click();
    await expect(card.locator('.cm-confirm')).toHaveCount(0);
    await expect(page.locator(`[data-w="${word}"]`), 'cancelling removed it anyway').toHaveCount(1);

    await openMenu();
    await page.locator('.card-menu button', { hasText: /Remove/i }).click();
    await card.locator('[data-reallyremove]').click();
    await expect(page.locator(`[data-w="${word}"]`)).toHaveCount(0);
  });
});

test.describe('the View lens', () => {
  test('filters by mark and wears the live one on its face', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('#lensbtn').click();
    await expect(page.locator('#lens')).toBeVisible();
    await page.locator('[data-filter="todo"]').click();
    await expect(page.locator('#lenslabel')).toHaveText(/Not yet/);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#study').click();
    await expect(page.locator('body')).toHaveClass(/study/);
    await page.locator('#study').click();
    await page.locator('#arabic').click();
    await expect(page.locator('.card .ar').first()).toBeVisible();
  });
});

test.describe('the deck', () => {
  /* Was: .seg dresses both the mark filter and this control, and a global redefinition
     collapsed "the word / by ear" into two grey lines.

     Asserting the buttons exist and are visible does NOT catch it — they were both, even
     while the control around them was two pixels tall with its contents hanging out. The
     measurement is the point: a control must be at least as tall as the things inside it.
     It also has to be taken on a phone. At desktop width the same fault leaves a control
     34px tall and looks nearly right, which is why it reached a reader. */
  test('the way of being asked is a control, not two lines', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="study"]').click();
    const ask = page.locator('#fc .seg button');
    await expect(ask).toHaveCount(2);
    const seg = await page.locator('#fc .seg').boundingBox();
    const btn = await ask.first().boundingBox();
    expect(seg.height, 'the control collapsed and its buttons hang out of it')
      .toBeGreaterThanOrEqual(btn.height);
  });

  test('deals, turns and answers', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('.dest[data-dest="study"]').click();
    await page.locator('#fc-all').click();
    await page.locator('#fc-go').click();
    await expect(page.locator('#fc-card')).toBeVisible();
    await page.locator('#fc-card').click();                 // turn it over
    await expect(page.locator('#fc-k')).toBeEnabled();
    await page.locator('#fc-k').click();
    await expect(page.locator('#fc-count')).toHaveText(/2 \//);
  });

  /* Was: a swipe begun anywhere but the top of a card started a text selection instead. */
  test('a card can be thrown from its lower half', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('.dest[data-dest="study"]').click();
    await page.locator('#fc-all').click();
    await page.locator('#fc-go').click();
    const card = page.locator('#fc-card');
    await card.click();
    const box = await card.boundingBox();
    const y = box.y + box.height - 40;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 + i * 25, y);
    await page.mouse.up();
    await expect(page.locator('#fc-count')).toHaveText(/2 \//);
  });
});

test.describe('the add loop', () => {
  test('checks a list and builds the prompt', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('.dest[data-dest="add"]').click();
    await page.locator('#raw').fill('zeugma, apophasis, holdfast, litotes');
    await page.locator('#check').click();
    await expect(page.locator('#report')).toContainText('3 to enrich');
    await expect(page.locator('#report')).toContainText('holdfast');
    await expect(page.locator('#copyp')).toBeEnabled();
    await expect(page.locator('#prompt')).toContainText('JSON');
  });
});

test.describe('the destinations', () => {
  test('each takes the page, and the book comes back', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    for (const [dest, panel] of [['add', '#panel'], ['you', '#settings']]) {
      await page.locator(`.dest[data-dest="${dest}"]`).click();
      await expect(page.locator(panel)).toHaveClass(/on/);
      await expect(page.locator('#book')).toBeHidden();
      await expect(page.locator(`.dest[data-dest="${dest}"]`)).toHaveAttribute('aria-current', 'true');
    }
    await page.locator('.dest[data-dest="book"]').click();
    await expect(page.locator('#book')).toBeVisible();
    await expect(page.locator('.card').first()).toBeVisible();
  });
});

test.describe('the shell at each size', () => {
  /* Was: the search box claimed a whole line, so View and the tally sat on a second row
     and the head was three bands deep before a word of the book. */
  test('a phone gets one row of head, the tabs, and no sideways scroll', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    const q = await page.locator('#q').boundingBox();
    const lens = await page.locator('#lensbtn').boundingBox();
    expect(Math.abs((q.y + q.height / 2) - (lens.y + lens.height / 2)),
      'search and View share a row').toBeLessThan(3);
    await expect(page.locator('#tally')).toBeHidden();          // it reads in You instead
    await expect(page.locator('#tally2')).toContainText('learned');
    await expect(page.locator('.chip').first()).toBeVisible();
    await expect(page.locator('.dest')).toHaveCount(4);
    const scrolls = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, 'the page scrolls sideways').toBe(false);
  });

  /* Was: the strip travelled with the page, so the index that was taken off the cover for
     scrolling away went on scrolling away. */
  test('the field strip stays put while the book moves', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    const before = (await page.locator('#inkchips').boundingBox()).y;
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(250);
    const after = (await page.locator('#inkchips').boundingBox()).y;
    expect(Math.round(after), 'the strip scrolled away').toBe(Math.round(before));
  });

  /* Was: the deck covered the four destinations, so the only way out of Study was its own
     Close — on the one screen where that bar is the whole navigation. */
  test('a phone keeps its tabs during Study, and leaving closes the deck', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="study"]').click();
    await expect(page.locator('#fc')).toBeVisible();
    await expect(page.locator('.dest[data-dest="book"]')).toBeVisible();
    await page.locator('.dest[data-dest="book"]').click();
    await expect(page.locator('#fc')).toBeHidden();
    await expect(page.locator('#book')).toBeVisible();
  });

  test('a tablet gets the rail and the field index, and can fold', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await stock(page);
    await expect(page.locator('.idxwrap')).toBeVisible();
    await expect(page.locator('#navfold')).toBeVisible();
    /* the fold button stands over the rail; the first destination begins below it */
    const fold = await page.locator('.navtop').boundingBox();
    const first = await page.locator('.dest').first().boundingBox();
    expect(fold.y + fold.height, 'the fold button covers the first destination')
      .toBeLessThanOrEqual(first.y);
    await page.locator('#navfold').click();
    await expect(page.locator('.idxwrap')).toBeHidden();
    await expect(page.locator('.chip').first()).toBeVisible();   // the index changes shape
    await page.locator('#navfold').click();
    await expect(page.locator('.idxwrap')).toBeVisible();
  });

  test('a desktop gets the sidebar, and folding is remembered', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await expect(page.locator('.brand')).toBeVisible();
    await page.locator('#navfold').click();
    await expect(page.locator('.brand')).toBeHidden();
    await expect(page.locator('.idxrow .nm').first()).toBeHidden();
    await page.reload();
    await expect(page.locator('.card').first()).toBeVisible();
    await expect(page.locator('.brand'), 'the fold was not remembered').toBeHidden();
  });
});
