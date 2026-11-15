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
