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

/* A test runner has no speech voices, so the booklet correctly offers no "by ear" and hides
 * the control that carries it. A developer's laptop has voices and shows it. That divergence
 * hid a broken test until CI ran it for the first time — it passed here and failed there,
 * which is the worst way round.
 *
 * One fake voice, installed before the page loads, so the branch is exercised identically
 * everywhere. Call it before stock(). The no-voice path is still covered: every other deck
 * test runs without this, and on CI that is genuinely a machine that cannot speak. */
async function withVoice(page) {
  await page.addInitScript(() => {
    const voices = [{ name: 'Test English', lang: 'en-GB', default: true,
                      localService: true, voiceURI: 'test' }];
    try {
      Object.defineProperty(window.speechSynthesis, 'getVoices',
        { value: () => voices, configurable: true });
    } catch { /* if an engine refuses, the assertion below will say so plainly */ }
  });
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
    await page.locator('.card-menu [data-file="3"]').click();
    await expect(page.locator(`#f3 [data-w="${word}"]`)).toHaveCount(1);
  });

  /* These two were one test that opened the menu, cancelled, and opened it again. The
     second open was flaky on CI — the menu hangs off <body> and is rebuilt each time, and
     the card changes height underneath it as the confirmation comes and goes, so the click
     sometimes landed on a node about to be replaced. It went green on the retry, which is
     the worst outcome: a test that needs a retry is a test that will fail for real one day.
     Two tests that each open the menu once, and no retry is needed. */
  test('removing asks first, and cancelling leaves the word alone', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const card = page.locator('.card').first();
    const word = await card.getAttribute('data-w');
    await card.locator('.more').click();
    await page.locator('.card-menu [data-remove]').click();
    await expect(card.locator('.cm-confirm')).toBeVisible();
    await card.locator('[data-cancelremove]').click();
    await expect(card.locator('.cm-confirm')).toHaveCount(0);
    await expect(page.locator(`[data-w="${word}"]`), 'cancelling removed it anyway').toHaveCount(1);
  });

  test('removing, once confirmed, takes the word out', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    const card = page.locator('.card').first();
    const word = await card.getAttribute('data-w');
    const before = await page.locator('.card').count();
    await card.locator('.more').click();
    await page.locator('.card-menu [data-remove]').click();
    await card.locator('[data-reallyremove]').click();
    await expect(page.locator(`[data-w="${word}"]`)).toHaveCount(0);
    await expect(page.locator('.card')).toHaveCount(before - 1);
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
    await withVoice(page);                 // or there is nothing to ask by ear with
    await stock(page);
    await page.locator('.dest[data-dest="study"]').click();
    const ask = page.locator('#fc .seg button');
    await expect(ask).toHaveCount(2);
    const seg = await page.locator('#fc .seg').boundingBox();
    const btn = await ask.first().boundingBox();
    expect(seg.height, 'the control collapsed and its buttons hang out of it')
      .toBeGreaterThanOrEqual(btn.height);
  });

  /* The other half of the same divergence. A device with no voice must lose the choice and
     keep the deck — this asserts it here rather than leaving it to whichever machine happens
     to be silent. Between the two, both branches are covered on every machine. */
  test('a device with no voice loses the choice, not the deck', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window.speechSynthesis, 'getVoices',
          { value: () => [], configurable: true });
      } catch { /* nothing to silence */ }
    });
    await stock(page);
    await page.locator('.dest[data-dest="study"]').click();
    await expect(page.locator('#fc .seg')).toHaveCount(0);
    await page.locator('#fc-all').click();
    await expect(page.locator('#fc-go')).toBeEnabled();
    await page.locator('#fc-go').click();
    await expect(page.locator('#fc-card')).toBeVisible();
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

test.describe('emptying the booklet', () => {
  /* It asked you to type the word "empty" until 2026-08-29 and now asks with two buttons,
     the way Reset marks does. The count on the button is what replaced the typing, so it is
     the part worth asserting: a confirmation that does not say what you are about to lose is
     the thing the typed word was there to prevent. */
  test('asks first, and says how many words are about to go', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('#emptybtn').click();
    await expect(page.locator('#emptytype'), 'the typed step should be gone').toHaveCount(0);
    await expect(page.locator('#emptygo')).toHaveText('Empty 154 words');
    await expect(page.locator('#emptygo')).toBeEnabled();
    await expect(page.locator('#emptymsg')).toContainText('cannot be undone');
  });

  test('cancelling leaves every word where it was', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('#emptybtn').click();
    await page.locator('#emptyno').click();
    await expect(page.locator('#emptybtn')).toBeVisible();      // back to rest
    await page.locator('.dest[data-dest="book"]').click();
    await expect(page.locator('.card')).toHaveCount(154);
  });

  test('confirming empties it, and asks what you read', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('#emptybtn').click();
    await page.locator('#emptygo').click();
    /* an emptied booklet is the state the first-run picker was written for */
    await expect(page.locator('#firstrun')).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(0);
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

test.describe('You, where the panel is narrow', () => {
  /* Was: the panel was three columns collapsed into one, so ten settings became thirty
     stacked blocks and 1,255px of scroll on a 812px screen — nothing denser or lighter than
     anything else, and no way to see which voice or what speed without pressing something.
     A number that stands for the whole complaint is the only honest guard against it
     creeping back one padding rule at a time. */
  test('opens on a card, not on a wall', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await expect(page.locator('#youcard')).toBeVisible();
    await expect(page.locator('#tally2'), 'the card carries the tally now').toBeHidden();
    await expect(page.locator('.set-acct'), 'and it carries the account').toBeHidden();
    await expect(page.locator('.set-d').first(), 'the row is not one line').toBeHidden();
    /* Measured with every fold open, which is the state the old panel was always in. A
       folded panel is short whatever the rows look like, so measuring it at rest would
       have passed with the reasons switched back on — it did, the first time this was
       written. */
    for (const h of await page.locator('.set-group .set-h').all()) {
      if (await h.getAttribute('aria-expanded') === 'false') await h.click();
    }
    const box = await page.locator('#settings').boundingBox();
    expect(box.height, 'the panel has grown back into a wall').toBeLessThan(750);
  });

  /* Was: every answer lived inside a button you had to press to read it.
     withVoice, because the two rows that carry the most interesting answers are the two the
     booklet correctly removes on a machine that cannot speak — and a test runner is one. It
     passed on a laptop and failed on CI, which is the worst way round and the second time
     this suite has learnt it. */
  test('says which voice and what speed without being pressed', async ({ page }) => {
    await withVoice(page);
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('.set-group').nth(1).locator('.set-h').click();
    await expect(page.locator('#pics')).toHaveText('On');
    await expect(page.locator('#speed')).toHaveText(/^[0-9.]+×$/);
    await expect(page.locator('#voice')).toBeVisible();
    await expect(page.locator('.set-group').nth(1).locator('.set-n')).toHaveText('3');
  });

  /* The mirror. A device with no voice loses those two rows, and the count on the fold has
     to lose them too — a heading that promises three rows and opens on one is a worse fault
     than the missing rows, because it looks like something is broken. */
  test('a device with no voice says so in the count, not just the rows', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window.speechSynthesis, 'getVoices',
          { value: () => [], configurable: true });
      } catch { /* the assertions below will say so plainly */ }
    });
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('.set-group').nth(1).locator('.set-h').click();
    await expect(page.locator('#voice')).toBeHidden();
    await expect(page.locator('#pics')).toBeVisible();
    await expect(page.locator('#speed'), 'speed is not the voice, and stays').toBeVisible();
    await expect(page.locator('.set-group').nth(1).locator('.set-n')).toHaveText('2');
  });

  /* The sentence under each label is hidden on a phone but not deleted: a reader who cannot
     see the row still has to be told why the speed matters. */
  test('keeps every reason for a reader who cannot see the row', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    const id = await page.locator('#speed').getAttribute('aria-describedby');
    expect(id, 'the control lost its reason').toBeTruthy();
    await expect(page.locator('#' + id)).toHaveText(/shadow aloud/);
  });

  test('folds a group, and remembers which', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    const first = page.locator('.set-group').first();
    await expect(first.locator('.set-b')).toBeVisible();      // your words, open at rest
    await first.locator('.set-h').click();
    await expect(first.locator('.set-b')).toBeHidden();
    await page.reload();
    await expect(page.locator('.card').first()).toBeVisible();
    await page.locator('.dest[data-dest="you"]').click();
    await expect(page.locator('.set-group').first().locator('.set-b'),
      'the fold was not remembered').toBeHidden();
  });

  /* A chevron is 14px wide on a line 343px long. The line takes the tap. */
  test('the row is the door, not just its chevron', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('.set-door', { hasText: 'Add words' }).locator('.set-t').click();
    await expect(page.locator('#panel')).toBeVisible();
  });

  test('the card is the way to the account', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('#youcard').click();
    await expect(page.locator('#account')).toBeVisible();
  });

  /* Two pills and a sentence do not fit beside a name on a 343px line, so while it asks the
     row gives them one of their own. Without it the name is squeezed to nothing. */
  test('a bulk action still asks, on a line of its own', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await page.locator('.set-group').nth(2).locator('.set-h').click();
    await page.locator('#emptybtn').click();
    const row = page.locator('.set-ask.grave');
    await expect(row).toHaveClass(/asking/);
    await expect(page.locator('#emptygo')).toHaveText('Empty 154 words');
    const name = await row.locator('.set-t').boundingBox();
    const go   = await page.locator('#emptygo').boundingBox();
    expect(go.y, 'the confirmation did not take its own line')
      .toBeGreaterThan(name.y + name.height - 2);
    /* The failure this is really watching for: the name crushed into a ribbon to make room
       for two pills beside it, which is what happens if the row stops letting them wrap. */
    expect(name.width, 'the name was squeezed out of the way').toBeGreaterThan(120);
  });

  /* The whole of "I downloaded a voice and it never appeared", in one case. Chrome answers
     the first getVoices() with an empty list, so the row hides itself during load; the real
     list arrives through onvoiceschanged a moment later. Until 2026-08-29 the row never came
     back — refreshVoices() refilled a <select> nobody could see — and the count above it went
     on reporting the row it could no longer show. */
  test('a voice arriving after load brings its row back, and the count with it', async ({ page }) => {
    await page.addInitScript(() => {
      let voices = [];
      window.__arrive = () => {
        voices = [{ name: 'Test English', lang: 'en-GB', default: true,
                    localService: true, voiceURI: 'test' }];
        if (typeof speechSynthesis.onvoiceschanged === 'function') speechSynthesis.onvoiceschanged();
      };
      try {
        Object.defineProperty(window.speechSynthesis, 'getVoices',
          { value: () => voices, configurable: true });
      } catch { /* the assertions below will say so plainly */ }
    });
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    const group = page.locator('.set-group').nth(1);
    await group.locator('.set-h').click();
    await expect(page.locator('#voice'), 'no voices yet, so no row').toBeHidden();
    await expect(group.locator('.set-n')).toHaveText('2');

    await page.evaluate(() => window.__arrive());
    await expect(page.locator('#voice'), 'the row never came back').toBeVisible();
    await expect(group.locator('.set-n'), 'the count did not follow the row').toHaveText('3');
  });

  /* Was: the heading read "Your words 3" over four rows. The count is taken from the rows
     that are showing, and Merging is hidden when the page loads and un-hidden later, when
     the gateway answers — which is after the count has already been taken. The gateway's
     own call site cannot be reached without an account, so what is pinned here is the
     invariant it depends on: a row appearing changes the number above it. */
  test('a row appearing after load changes the count above it', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    const count = page.locator('.set-group').first().locator('.set-n');
    const before = Number(await count.textContent());
    await page.evaluate(() => {
      document.getElementById('automerge-row').hidden = false;
      foldSync();
    });
    await expect(count).toHaveText(String(before + 1));
    const rows = await page.locator('.set-group').first()
      .locator('.set:visible').count();
    expect(Number(await count.textContent()), 'the count and the rows disagree').toBe(rows);
  });

  /* Was: the page ended 30px below its last card while a fixed bar 60px tall stood over it,
     so the last card could only be read by scrolling it underneath the bar. And You, whose
     content does not fill a phone, left the page shorter than the screen — the one
     destination the bar was reported jumping on. */
  test('no destination is shorter than the screen, and none ends under the bar', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    for (const dest of ['book', 'add', 'you']) {
      await page.locator(`.dest[data-dest="${dest}"]`).click();
      const m = await page.evaluate(() => ({
        doc: document.documentElement.scrollHeight,
        vh: window.innerHeight,
        pad: parseInt(getComputedStyle(document.querySelector('.views')).paddingBottom, 10),
        bar: Math.round(document.querySelector('.nav').getBoundingClientRect().height),
      }));
      expect(m.doc, `${dest} is shorter than the screen`).toBeGreaterThanOrEqual(m.vh);
      expect(m.pad, `${dest} ends under the bar`).toBeGreaterThan(m.bar);
    }
  });

  /* Was: the bar sat a finger's width off the bottom of an iPhone, and moved further up on
     the destinations whose page is short enough not to scroll. It is position:fixed, so its
     place cannot depend on how much content is above it — this pins that on both a long
     destination and a short one, since it was the difference between the two that showed. */
  test('the bar is on the bottom edge, whatever destination is open', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    const bottom = () => page.locator('.nav').evaluate(
      el => Math.round(window.innerHeight - el.getBoundingClientRect().bottom));
    expect(await bottom(), 'the bar floats above the bottom on the book').toBe(0);
    for (const dest of ['add', 'you']) {
      await page.locator(`.dest[data-dest="${dest}"]`).click();
      expect(await bottom(), `the bar moved on ${dest}`).toBe(0);
    }
  });

  /* Was: the card sat under the iPhone's clock. openPanel() hides the head, and the head is
     the only thing carrying the status bar inset, so a panel has to ask for it.
     env(safe-area-inset-top) is 0 in a desktop Chromium and cannot be emulated, so what is
     checked here is that the rule is live and scoped: the phone's own 12px, and the desk's
     22px left alone. The inset rides on top of the first of those. */
  test('a panel opens where the head would have been, not under the clock', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await expect(page.locator('#settings')).toHaveCSS('margin-top', '12px');
    await page.setViewportSize(DESKTOP);
    await expect(page.locator('#settings')).toHaveCSS('margin-top', '22px');
  });

  /* The fault that set the width. An iPad held upright gave the panel 435px and the three
     columns would not fit in it: 132px of overflow, and a horizontal scrollbar under the
     whole app. It had been doing that before any of this was written. */
  test('a tablet held upright gets the card too, and no sideways scroll', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await expect(page.locator('#youcard')).toBeVisible();
    const over = await page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    expect(over, 'the panel is pushing the page sideways again').toBeLessThanOrEqual(1);
  });

  /* The whole of the above lives in one media query. This is the guard on that claim: a
     desk keeps three columns, every sentence, the long names, and no card. */
  test('and a desk keeps its three columns, its reasons and its long names', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await stock(page);
    await page.locator('.dest[data-dest="you"]').click();
    await expect(page.locator('#youcard')).toBeHidden();
    await expect(page.locator('#tally2')).toBeVisible();
    await expect(page.locator('#pics')).toHaveText('Pictures on');
    await expect(page.locator('#emptybtn')).toHaveText('Empty this booklet');
    await expect(page.locator('#addhint')).toBeVisible();
    const cols = await page.locator('#settings')
      .evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols, 'the desk lost its columns').toBe(3);
  });
});
