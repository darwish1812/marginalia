// @ts-check
/* The gateway console, which nothing covered until a class name went wrong.
 *
 * admin.html has no first-run question and no local mode: it asks the gateway who you are
 * and draws nothing until it answers. These cases skip that by unhiding the console and
 * calling paint() with a fixture — the same way the page is driven in a browser, minus the
 * network — so what is exercised is the real renderer and the real stylesheet.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ADMIN = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

/* Three providers: one doing the words, one local with no key, one holding the voice. */
const STATE = {
  providers: [
    {id:1, name:'anthropic', adapter:'anthropic', endpoint:'https://api.anthropic.com/v1/messages',
     model:'claude-sonnet-5', voice_model:'', key_last4:'KQAA'},
    {id:3, name:'LM Studio (local)', adapter:'openai', endpoint:'http://localhost:11434/v1/chat/completions',
     model:'nemotron', voice_model:''},
    {id:4, name:'OpenAI', adapter:'openai', endpoint:'https://api.openai.com/v1/chat/completions',
     model:'gpt-4o-mini', voice_model:'gpt-4o-mini-tts', key_last4:'aacA'},
  ],
  keys: [{provider_id:1},{provider_id:4}],
  capabilities: [{job:'translate', provider_id:1, enabled:true, tested_at:'2026-11-14T10:16:00Z'},
                 {job:'speech', provider_id:4, enabled:false, tested_at:'2026-11-14T08:52:00Z'}],
  config: {app_id:'marginalia', temperature:0.2, max_tokens:4000, batch_size:20,
           monthly_per_user:500, max_per_run:60, app_budget:8000, template:'x',
           tts_enabled:false, tts_voice:'nova', tts_instructions:'', tts_tested_at:null},
  usage: {words:25, runs:14, failed:2, readers:3, budget:8000, resets:'2026-12-01'},
  errors: [],
};

async function console_(page) {
  await page.goto('/admin.html');
  await page.waitForFunction(() => typeof paint === 'function');
  await page.evaluate((s) => {
    document.getElementById('gate').hidden = true;
    document.getElementById('console').hidden = false;
    paint(s);
  }, STATE);
}

/* The fault: `.job` named two different things. table.prov had th.job/td.job for the Text
   and Voice radio columns long before the What is on block arrived and added a bare
   `.job{display:grid}` — which turned every one of those table cells into a three-column
   grid with a border on top. The headings stacked, the two radios stacked, and nothing
   errored. It shipped, because the block being worked on looked right and the table two
   sections above it was never looked at. */
test('the providers table is a table, not a grid', async ({ page }) => {
  await console_(page);

  const rows = page.locator('#provrows tr');
  await expect(rows).toHaveCount(STATE.providers.length);

  const shape = await page.evaluate(() => {
    const tr = document.querySelector('#provrows tr');
    const c  = [...tr.children];
    const th = [...document.querySelectorAll('table.prov thead th')].slice(0, 6);
    return {
      cells: c.length,
      headers: th.map(h => h.textContent.trim()),
      display: getComputedStyle(c[0]).display,
      borderTop: getComputedStyle(c[0]).borderTopWidth,
      /* The two radio cells sit on one line, as do their headings. If either stacks, some
         rule has made a table cell into a block. */
      cellsLevel: Math.abs(c[0].getBoundingClientRect().top - c[1].getBoundingClientRect().top) < 2,
      headersLevel: Math.abs(th[0].getBoundingClientRect().top - th[1].getBoundingClientRect().top) < 2,
    };
  });

  expect(shape.cells, 'a row does not have one cell per column').toBe(6);
  expect(shape.headers).toEqual(['Text', 'Voice', 'Provider', 'Model', 'Key', '']);
  expect(shape.display, 'a rule turned the Text cell into something other than a table cell').toBe('table-cell');
  expect(shape.borderTop, 'a rule gave the Text cell a border it should not have').toBe('0px');
  expect(shape.cellsLevel, 'the Text and Voice radios are stacked').toBe(true);
  expect(shape.headersLevel, 'the Text and Voice headings are stacked').toBe(true);
});

/* The cause, pinned at the source so the next person to reach for a short class name is
   stopped by a failing test rather than by a screenshot weeks later. */
test('no bare .job rule exists to collide with the table', () => {
  const css = ADMIN.slice(ADMIN.indexOf('<style>'), ADMIN.indexOf('</style>'));
  const bare = css.split('\n').filter(l => /^\s*\.job[\s{:.,]/.test(l));
  expect(bare, 'a bare .job rule is back; table.prov already owns th.job/td.job').toEqual([]);
});

/* The block the collision broke, still right afterwards. */
test('what is on shows one row per job, aligned', async ({ page }) => {
  await console_(page);

  await expect(page.locator('.jobrow')).toHaveCount(2);
  await expect(page.locator('#textstate')).toHaveText('On');
  await expect(page.locator('#ttsstate')).toHaveText('Off');
  await expect(page.locator('#textby')).toContainText('anthropic');
  await expect(page.locator('#ttsby')).toContainText('OpenAI');

  const aligned = await page.evaluate(() => {
    const L = id => document.getElementById(id).getBoundingClientRect();
    return {
      badges: Math.abs(L('textstate').left - L('ttsstate').left) < 1,
      providers: Math.abs(L('textby').left - L('ttsby').left) < 1,
      switches: Math.abs(L('texttoggle').right - L('ttstoggle').right) < 1,
    };
  });
  expect(aligned.badges, 'the On/Off badges do not line up').toBe(true);
  expect(aligned.providers, 'the provider lines do not line up').toBe(true);
  expect(aligned.switches, 'the switches do not line up').toBe(true);
});

/* Readers. The dashboard has said "3 readers" since the gateway existed and could never
   say which three, since when, or which of them was spending the budget. */
const READERS = {
  page: 1, perPage: 100, more: false,
  readers: [
    { id:'a', email:'owner@mail.test', via:'google', joined:'2026-08-02T10:00:00Z',
      last_seen:'2026-11-15T07:40:00Z', confirmed:true, admin:true, stocked:true,
      auto_merge:false, words:193, month:{words:25, runs:14, failed:2} },
    { id:'b', email:'tester@mail.test', via:'google', joined:'2026-11-14T19:12:00Z',
      last_seen:'2026-11-14T19:40:00Z', confirmed:true, admin:false, stocked:true,
      auto_merge:false, words:19, month:{words:0, runs:0, failed:0} },
    { id:'c', email:'stalled@mail.test', via:'email', joined:'2026-11-14T20:55:00Z',
      last_seen:'2026-11-14T20:55:00Z', confirmed:false, admin:false, stocked:false,
      auto_merge:false, words:0, month:{words:0, runs:0, failed:0} },
  ],
};

test('readers are listed with what each has cost', async ({ page }) => {
  await console_(page);
  await page.evaluate((d) => paintReaders(d), READERS);

  const rows = page.locator('#rdrrows tr');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#rdrcount')).toHaveText('3 readers');

  /* The administrator is in the list and marked, not hidden: their own usage comes out of
     the same budget as everybody else's. */
  await expect(rows.nth(0)).toContainText('owner@mail.test');
  await expect(rows.nth(0)).toContainText('admin');
  await expect(rows.nth(0)).toContainText('193');
  await expect(rows.nth(0), 'a failed run is not shown').toContainText('2 failed');

  /* Signed in, never answered the first question. Worth seeing — it is the commonest way
     somebody bounces off, and a 0 would look like a reader who simply had not started. */
  await expect(rows.nth(2)).toContainText('not started');
});

/* The fault this guards against is the one that matters most about this table: that it
   should never grow a column holding what somebody wrote. The route counts; it does not
   read. If a definition ever appears here, something has gone badly wrong upstream. */
/* Stronger than looking at the rendering: the route is read, and what it asks the database
   for. Counting is the most this is allowed to know about anybody's vocabulary — a head
   count, never the rows. If someone later swaps the count for a select of the words to save
   a round trip, every definition in the system crosses the wire and this fails. */
test('the readers route counts words, never reads them', () => {
  const src = readFileSync(fileURLToPath(new URL('../supabase/functions/enrich/index.ts', import.meta.url)), 'utf8');
  const i = src.indexOf("route === '/admin/readers'");
  expect(i, 'the readers route is gone or renamed').toBeGreaterThan(-1);
  const route = src.slice(i, src.indexOf("route === '/admin/errors'", i));

  expect(route, 'the route no longer uses a head count for words')
    .toContain("count: 'exact', head: true");
  /* The columns a word's text lives in. Asking for any of them here would pull every
     definition in the system across the wire to count rows. */
  for (const col of ['"w"', '"d"', '"e"', '"a"', '"norm"']) {
    const bare = col.slice(1, -1);
    expect(route, 'the route is selecting ' + bare + ' from words')
      .not.toContain("'" + bare + "'");
  }
});

test('the readers table says nothing about what anybody wrote', async ({ page }) => {
  await console_(page);
  await page.evaluate((d) => paintReaders(d), READERS);

  const body = await page.locator('#rdrrows').textContent();
  /* The fixture's addresses deliberately avoid these words; an earlier version used
     @example.com and failed itself on "example", which is the sort of test that gets
     deleted rather than understood. */
  for (const leak of ['definition', 'gloss', 'example', 'sentence']) {
    expect(body.toLowerCase(), `the table is showing ${leak}s`).not.toContain(leak);
  }
  const headers = await page.locator('#rdrrows').evaluate(
    b => [...b.closest('table').querySelectorAll('th')].map(h => h.textContent.trim()));
  expect(headers).toEqual(['Reader', 'Joined', 'Last seen', 'Words', 'This month']);
});

/* The count and the search. The count is beside the box rather than under the table
   because what it answers changes as you type — how many there are, and how many you are
   looking at — and a total printed once is wrong the moment the box has anything in it. */
test('the count says how many, and how many of them you are seeing', async ({ page }) => {
  await console_(page);

  /* Before anything is loaded the table says what to do. An empty table with no
     explanation reads like a list of nobody. */
  await expect(page.locator('#rdrrows')).toContainText('Press Refresh');
  await expect(page.locator('#rdrcount')).toHaveText('');

  await page.evaluate((d) => paintReaders(d), READERS);
  await expect(page.locator('#rdrcount')).toHaveText('3 readers');

  await page.locator('#rdrq').fill('tester');
  await expect(page.locator('#rdrrows tr')).toHaveCount(1);
  await expect(page.locator('#rdrcount')).toHaveText('1 of 3 readers');

  /* A search that matches nothing says so, and still says how many there were. */
  await page.locator('#rdrq').fill('zzz');
  await expect(page.locator('#rdrcount')).toHaveText('0 of 3 readers');
  await expect(page.locator('#rdrrows')).toContainText('No reader matches');

  await page.locator('#rdrq').fill('');
  await expect(page.locator('#rdrcount')).toHaveText('3 readers');
});

test('the search reaches what the table shows, and nothing else', async ({ page }) => {
  await console_(page);
  await page.evaluate((d) => paintReaders(d), READERS);

  /* How they signed in is a column, so it is searchable. */
  await page.locator('#rdrq').fill('email');
  await expect(page.locator('#rdrrows tr')).toHaveCount(1);
  await expect(page.locator('#rdrrows')).toContainText('stalled@mail.test');

  /* So is the admin mark. */
  await page.locator('#rdrq').fill('admin');
  await expect(page.locator('#rdrrows tr')).toHaveCount(1);
  await expect(page.locator('#rdrrows')).toContainText('owner@mail.test');

  /* Escape clears it, because a search you have to select-and-delete is a search you
     leave switched on by accident. */
  await page.locator('#rdrq').press('Escape');
  await expect(page.locator('#rdrq')).toHaveValue('');
  await expect(page.locator('#rdrrows tr')).toHaveCount(3);
});

/* The fault this guards against: re-fetching on every keystroke. The list costs a
   listUsers call and one head count per reader; filtering is the browser's job. */
test('typing in the search does not ask the gateway again', async ({ page }) => {
  await console_(page);
  await page.evaluate((d) => paintReaders(d), READERS);

  /* Counting calls to loadReaders, not to fetch. An earlier version stubbed window.fetch
     and still passed against a search that re-fetched on every keystroke — twice over: it
     read the counter before the async call got there, and on a console with no session
     api() throws before it reaches the network at all, so no fetch would have been seen
     even then. What is actually wrong with re-fetching is calling the loader; count that.
     Both functions are top-level declarations, so the listener's `loadReaders()` resolves
     through the global and sees the replacement. */
  const calls = await page.evaluate(async () => {
    let n = 0;
    const real = window.loadReaders;
    window.loadReaders = function () { n++; return Promise.resolve(); };
    const q = document.getElementById('rdrq');
    for (const v of ['t', 'te', 'tes', 'test']) { q.value = v; q.dispatchEvent(new Event('input')); }
    await new Promise(r => setTimeout(r, 200));
    window.loadReaders = real;
    return n;
  });
  expect(calls, 'the search is re-fetching the reader list on every keystroke').toBe(0);
});
