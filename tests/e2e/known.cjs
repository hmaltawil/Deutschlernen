// "I know this" button and "your level" on Home.
const { chromium } = require('playwright');
const path = require('path');
const U = process.argv[2];
const OUT = process.argv[3] || require('./_lib.cjs').shots();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(U); await page.waitForSelector('.hero');
  const answers = await page.evaluate(async () => {
    const m = {};
    for (const f of ['level-01.json', 'level-07.json']) for (const it of await (await fetch('deck/' + f)).json()) m[it.id] = it.a;
    return m;
  });
  const lv7 = await page.evaluate(async () => (await (await fetch('deck/level-07.json')).json()).map((x) => x.id));
  const due = async () => { await page.goto(U + '#/'); await page.waitForSelector('.hero'); return Number((await page.textContent('.streak-chip[title="Sentences due for review"]')).match(/\d+/)[0]); };
  const choose = async (right) => {
    const id = await page.$eval('.cloze-card', (e) => e.dataset.id);
    const texts = await page.$$eval('.choice', (bs) => bs.map((x) => x.textContent.slice(1)));
    const i = right ? texts.indexOf(answers[id]) : texts.findIndex((t) => t !== answers[id]);
    await page.keyboard.press(String(i + 1));
    await page.waitForSelector('.feedback');
    return id;
  };
  const next = async () => { await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(150); };

  // round: card 1 wrong + marked known (with an undo in between), card 2 right + K, rest right
  await page.goto(U + '#/play?kind=new');
  await page.waitForSelector('.choices');
  const first = await choose(false);
  await page.click('[data-testid=known]');
  await page.waitForSelector('text=Marked as known');
  await page.screenshot({ path: path.join(OUT, 'k-card.png') });
  await page.click('.known-row button:text("Undo")');
  await page.waitForSelector('[data-testid=known]');
  ok(true, 'Undo brings the button back');
  await page.click('[data-testid=known]');
  await page.waitForSelector('text=Marked as known');
  await next();
  const second = await choose(true);
  await page.keyboard.press('k');
  await page.waitForSelector('text=Marked as known');
  ok(true, 'K key marks a sentence as known');
  await next();
  const seen = [first, second];
  for (let i = 0; i < 12; i++) {
    if (await page.$('text=Runde geschafft!')) break;
    await page.waitForSelector('.choices');
    seen.push(await choose(true));
    await next();
  }
  ok(seen.filter((x) => x === first).length === 1, 'the known sentence was not repeated at the end of the round (no "practice again")');
  ok((await page.$$eval('.summary-list .badge', (e) => e.filter((x) => x.textContent === 'known').length)) === 2, 'summary marks the 2 known sentences');
  ok((await due()) === 0, 'a known sentence answered wrong does not come back as a review');

  // level list: filter + review again
  await page.goto(U + '#/levels/1');
  await page.waitForSelector('.sent-row');
  await page.click('.seg button:text("Known")');
  await page.waitForTimeout(300);
  ok((await page.$$('.sent-row')).length === 2, 'level 1 → Known shows the 2 sentences');
  await page.screenshot({ path: path.join(OUT, 'k-level.png') });
  await page.locator('.sent-row button:text("Review again")').first().click();
  await page.waitForTimeout(300);
  ok((await page.$$('.sent-row')).length === 1, '"Review again" takes it off the known list');
  ok((await due()) === 1, '…and it is due for review again');
  await page.reload(); await page.waitForSelector('.hero');
  ok((await due()) === 1, 'known marks survive a reload');

  // your level on Home
  await page.goto(U + '#/');
  ok((await page.textContent('[data-testid=current-level] h2')).includes('Level 1'), 'Home shows level 1 to start with');
  await page.goto(U + '#/levels/7');
  await page.click('a:has-text("Play this level")');
  await page.waitForSelector('.choices');
  const id7 = Number(await page.$eval('.cloze-card', (e) => e.dataset.id));
  ok(lv7.includes(id7), 'Play this level plays level 7');
  await page.click('button[aria-label="Quit round"]');
  await page.waitForSelector('.hero');
  ok((await page.textContent('[data-testid=current-level] h2')).includes('Level 7'), 'Home now shows level 7 as your level');
  await page.screenshot({ path: path.join(OUT, 'k-home.png') });
  await page.click('a.btn:text("Learn new")');
  await page.waitForSelector('.choices');
  ok(lv7.includes(Number(await page.$eval('.cloze-card', (e) => e.dataset.id))), 'Learn new on Home continues with level 7');
  await page.goto(U + '#/levels');
  await page.waitForSelector('.level-row');
  ok(((await page.textContent('a.level-row[href="#/levels/7"]')) || '').includes('yours'), 'Levels page marks level 7 as yours');
  await page.reload(); await page.waitForSelector('.level-row');
  await page.goto(U + '#/'); await page.waitForSelector('.hero');
  ok((await page.textContent('[data-testid=current-level] h2')).includes('Level 7'), 'your level is remembered after a reload');

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + JSON.stringify(errors) : ''}`);
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await b.close(); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
