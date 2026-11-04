// Word info after answering (and its setting), favourites and "Often missed" lists,
// loop audio, and the Dictate mode.
const { chromium } = require('playwright');
const path = require('path');
const { shots } = require('./_lib.cjs');

const U = process.argv[2];
let failed = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`), c || failed++);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    window.__plays = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!String(this.src).startsWith('blob:') || this.duration !== 0.1) window.__plays++;
      return orig.call(this);
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(U);
  await page.waitForSelector('.hero');
  const deck = await page.evaluate(async () => {
    const out = {};
    for (const n of [1, 2]) for (const it of await (await fetch(`deck/level-0${n}.json`)).json()) out[it.id] = it;
    return out;
  });
  const cardId = async () => Number(await page.$eval('.cloze-card', (e) => e.dataset.id));
  const choose = async (right = true) => {
    await page.waitForSelector('.choices');
    const id = await cardId();
    const texts = await page.$$eval('.choice', (bs) => bs.map((x) => x.textContent.slice(1)));
    const i = texts.indexOf(deck[id].a);
    await page.keyboard.press(String((right ? i : (i + 1) % 4) + 1));
    await page.waitForSelector('.feedback');
    return id;
  };
  const next = async () => {
    await page.waitForTimeout(380);
    await page.click('.next-bar button');
  };
  const toggle = async (id, on) => {
    await page.goto(U + '#/settings');
    await page.waitForSelector(`#${id}`);
    if ((await page.isChecked(`#${id}`)) !== on) await page.click(`#${id}`);
  };
  await page.goto(U + '#/settings');
  await page.selectOption('#round', '5');

  // 1. word info after answering
  await page.goto(U + '#/play?kind=new&level=1');
  const first = await choose();
  await page.waitForSelector('[data-testid=word-info]', { timeout: 8000 }).catch(() => {});
  const info = await page.$eval('[data-testid=word-info]', (e) => e.innerText).catch(() => '');
  ok(info.length > 0 && /Wiktionary/.test(info), `word info shows after answering ("${deck[first].a}": ${info.split('\n').slice(0, 2).join(' / ')})`);
  await page.screenshot({ path: path.join(shots(), 'word-info.png') });

  // 2. star with F; it shows on Home and in its list; a favourites round plays only it
  await page.keyboard.press('f');
  ok(await page.$eval('.star-btn', (e) => e.getAttribute('aria-pressed') === 'true'), 'F stars the sentence');
  await page.click('button[aria-label="Quit round"]');
  await page.waitForSelector('[data-testid=your-lists]');
  ok((await page.textContent('[data-list=fav]')).includes('1 sentence'), 'Home: Favourites has 1 sentence');
  await page.goto(U + '#/list/fav');
  await page.waitForSelector('.sent-row');
  ok(Number(await page.$eval('.sent-row', (e) => e.dataset.id)) === first, 'the favourites page lists it');
  await page.click('a:has-text("Play")');
  const favRound = [await choose()];
  ok(favRound[0] === first, 'a favourites round plays the starred sentence');
  await next();
  ok(!!(await page.$('.summary-list')), '…and only that one');

  // 3. word info can be switched off
  await toggle('word-info', false);
  await page.goto(U + '#/play?kind=new&level=1');
  await choose();
  await page.waitForTimeout(800);
  ok(!(await page.$('[data-testid=word-info]')), 'no word info with the setting off');
  await page.click('button[aria-label="Quit round"]');
  await toggle('word-info', true);

  // 4. often missed: wrong twice (two rounds) → in the list
  await page.goto(U + '#/play?kind=new&level=2');
  const missed = await choose(false);
  await next();
  for (let i = 0; i < 10 && !(await page.$('.summary-list')); i++) {
    await choose(true);
    await next();
  }
  await page.goto(U + '#/play?kind=review&level=2');
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector('.choices, .summary-list');
    if (await page.$('.summary-list')) break;
    const id = await choose((await cardId()) !== missed);
    await next();
    if (id === missed) break;
  }
  await page.goto(U + '#/');
  await page.waitForSelector('[data-testid=your-lists]');
  ok((await page.textContent('[data-list=missed]')).includes('1 sentence'), 'Home: Often missed has the sentence answered wrong twice');
  await page.goto(U + '#/play?kind=missed');
  ok((await (async () => (await page.waitForSelector('.cloze-card'), cardId()))()) === missed, 'an Often missed round plays it');

  // 5. loop audio: plays again and again until stopped
  await toggle('loop-audio', true);
  await page.goto(U + '#/play?kind=new&level=1');
  await page.waitForSelector('.choices');
  // pick a card with a native recording (audio that really ends)
  for (let i = 0; i < 5 && !deck[await cardId()].au; i++) {
    await choose();
    await next();
  }
  const p0 = await page.evaluate(() => window.__plays);
  await choose();
  await page.waitForTimeout(9000);
  const loops = (await page.evaluate(() => window.__plays)) - p0;
  ok(loops >= 3, `loop audio repeats the sentence (${loops} plays in 9 s)`);
  await page.click('button:has-text("Stop loop")');
  const p1 = await page.evaluate(() => window.__plays);
  await page.waitForTimeout(4000);
  ok((await page.evaluate(() => window.__plays)) === p1, '"Stop loop" stops it');
  await page.click('button[aria-label="Quit round"]');
  await toggle('loop-audio', false);

  // 6. dictation
  await page.goto(U + '#/');
  await page.click('.seg button:has-text("Dictate")');
  await page.goto(U + '#/play?kind=new&level=1');
  await page.waitForSelector('.dict-input');
  ok((await page.$$eval('.sentence .mask-word', (e) => e.length)) > 0, 'Dictate: the whole sentence is hidden');
  let id = await cardId();
  await page.fill('.dict-input', deck[id].de.toLowerCase().replace(/[.!?,]/g, ''));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.feedback');
  ok(/Richtig/.test(await page.textContent('.verdict')) && (await page.textContent('.pts-pop')).trim() === '+12', 'Dictate: the whole sentence (any case, no punctuation) is right, +12');
  await next();
  await page.waitForSelector('.dict-input');
  id = await cardId();
  const words = deck[id].de.split(' ');
  await page.fill('.dict-input', words.slice(0, -1).join(' ') + ' xyz');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.feedback');
  const bad = await page.$$eval('.sentence .dict-bad', (e) => e.map((x) => x.textContent));
  ok(/Not quite/.test(await page.textContent('.verdict')) && bad.length === 1, `Dictate: the missed word is marked (${bad.join(', ')})`);
  await page.screenshot({ path: path.join(shots(), 'dictation.png') });

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await b.close();
})()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    console.log(failed ? 'FAILED' : 'ALL PASSED');
    process.exit(failed ? 1 : 0);
  });
