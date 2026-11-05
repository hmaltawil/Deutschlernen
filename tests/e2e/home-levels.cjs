// Level cards on Home: levels you play appear (in level order) with today's numbers,
// Play / Review only that level, "Remove from Home" / "Show on Home", and "Reset level".
const { chromium } = require('playwright');
const path = require('path');
const { shots } = require('./_lib.cjs');

const U = process.argv[2];
let failed = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`), c || failed++);

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept()); // the reset confirmation
  await page.goto(U);
  await page.waitForSelector('.hero');
  const deck = await page.evaluate(async () => {
    const m = await (await fetch('deck/manifest.json')).json();
    const out = {};
    for (const l of m.levels.slice(0, 5)) out[l.n] = (await (await fetch('deck/' + l.file)).json()).map((it) => [it.id, it.a]);
    return out;
  });
  const answerOf = Object.fromEntries(Object.values(deck).flat());
  const levelOf = Object.fromEntries(Object.entries(deck).flatMap(([lv, items]) => items.map(([id]) => [id, Number(lv)])));
  const cards = () => page.$$eval('.level-card', (cs) => cs.map((c) => Number(c.dataset.level)));
  const stat = (lv, label) =>
    page.$eval(`.level-card[data-level="${lv}"]`, (c, label) => {
      const box = [...c.querySelectorAll('.mini-stats > div')].find((d) => d.querySelector('span').textContent === label);
      return Number(box.querySelector('strong').textContent);
    }, label);
  const playedText = (lv) => page.$eval(`.level-card[data-level="${lv}"] .spread.small span`, (e) => e.textContent.trim());
  const home = async () => {
    await page.goto(U + '#/');
    await page.waitForSelector('[data-testid=your-levels]');
  };
  /** Answer cards until the summary; returns the levels of the sentences played. wrong = indexes answered wrong. */
  const playRound = async (wrong = []) => {
    const seen = [];
    for (let i = 0; i < 40; i++) {
      await page.waitForSelector('.choices, .summary-list');
      if (await page.$('.summary-list')) break;
      const id = Number(await page.$eval('.cloze-card', (e) => e.dataset.id));
      seen.push(levelOf[id]);
      const texts = await page.$$eval('.choice', (bs) => bs.map((x) => x.textContent.slice(1)));
      const right = texts.indexOf(answerOf[id]);
      await page.keyboard.press(String((wrong.includes(i) ? (right + 1) % 4 : right) + 1));
      await page.waitForSelector('.feedback');
      await page.waitForTimeout(380);
      await page.click('.next-bar button');
    }
    return seen;
  };

  // 1. a new learner sees Level 1
  await home();
  ok(JSON.stringify(await cards()) === '[1]', 'Home starts with a Level 1 card');

  // 2. play level 3 from the Levels page (5 sentences, first one wrong)
  await page.goto(U + '#/settings');
  await page.selectOption('#round', '5');
  await page.goto(U + '#/levels/3');
  await page.click('a:has-text("Play this level")');
  const l3 = await playRound([0]);
  ok(l3.length === 6 && l3.every((lv) => lv === 3), `"Play this level" plays only level 3 (${l3.join(',')})`);
  await home();
  ok(JSON.stringify(await cards()) === '[1,3]', `Level 3 joins Level 1, in level order (cards: ${await cards()})`);
  ok((await stat(3, 'new today')) === 5 && (await stat(3, 'due')) === 1, 'Level 3 card: 5 new today, 1 due');
  ok((await playedText(3)).startsWith('5 / 1,090'), `Level 3 card: ${await playedText(3)}`);
  ok(((await page.textContent('[data-testid=current-level] h2')) || '').includes('Level 3'), 'Level 3 is marked as your level');
  await page.screenshot({ path: path.join(shots(), 'home-levels.png'), fullPage: true });

  // 3. Play on the Level 1 card: only level 1; Review on the Level 3 card: only its review
  await page.click('.level-card[data-level="1"] a:has-text("Play")');
  const l1 = await playRound();
  ok(l1.length === 5 && l1.every((lv) => lv === 1), `Level 1 card's Play plays only level 1 (${l1.join(',')})`);
  await home();
  await page.click('.level-card[data-level="3"] a:has-text("Review (1)")');
  const r3 = await playRound();
  ok(r3.length === 1 && r3[0] === 3, `Level 3 card's Review plays its 1 due sentence (${r3.join(',')})`);
  await home();
  ok((await stat(3, 'due')) === 0, 'Level 3: nothing due after the review');
  ok(((await page.textContent('[data-testid=current-level] h2')) || '').includes('Level 1'), 'playing Level 1 made it your level (reviewing doesn\'t)');

  // 4. remove from Home, and bring it back from the Levels page
  await page.click('.level-card[data-level="1"] button[aria-label="Options for Level 1"]');
  await page.screenshot({ path: path.join(shots(), 'home-level-menu.png') });
  await page.click('.menu button:has-text("Remove from Home")');
  ok(JSON.stringify(await cards()) === '[3]', 'Remove from Home hides the Level 1 card');
  // wait until the choice is stored on the device before reloading
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('luecke');
        req.onsuccess = () => {
          const get = req.result.transaction('kv').objectStore('kv').get('settings');
          get.onsuccess = () => resolve(JSON.stringify(get.result?.pinnedLevels) === '[3]');
          get.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      }),
    null,
    { timeout: 10000 },
  );
  await page.reload();
  await page.waitForSelector('[data-testid=your-levels]');
  ok(JSON.stringify(await cards()) === '[3]', '…and it stays hidden after a reload');
  await page.goto(U + '#/levels/1');
  await page.click('button:has-text("Show on Home")');
  await home();
  ok(JSON.stringify((await cards()).sort()) === '[1,3]', '"Show on Home" on the level page brings it back');

  // 5. reset level 3: its progress goes, level 1 and the points stay
  const pointsBefore = await page.textContent('.hero strong');
  await page.click('.level-card[data-level="3"] button[aria-label="Options for Level 3"]');
  await page.click('.menu button:has-text("Reset Level 3")');
  await page.waitForSelector('.level-card[data-level="3"] [role=status]');
  ok((await playedText(3)).startsWith('0 / 1,090') && (await stat(3, 'due')) === 0, `Reset Level 3: ${await playedText(3)}`);
  ok((await playedText(1)).startsWith('5 / 1,090'), `Level 1 is untouched: ${await playedText(1)}`);
  ok((await page.textContent('.hero strong')) === pointsBefore, `points stay (${pointsBefore})`);
  ok((await cards()).includes(3), 'the reset level stays on Home');
  await page.reload();
  await page.waitForSelector('[data-testid=your-levels]');
  ok((await playedText(3)).startsWith('0 / 1,090'), 'the reset is saved (after a reload)');
  await page.goto(U + '#/levels/3');
  await page.click('a:has-text("Play this level")');
  await page.waitForSelector('.cloze-card');
  ok(levelOf[Number(await page.$eval('.cloze-card', (e) => e.dataset.id))] === 3 && !!(await page.$('.badge.new')), 'its sentences come back as new');

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
