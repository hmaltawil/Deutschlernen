// Simulates Safari dropping the database connection mid-session (iPhone app left in the background),
// then checks that answering still shows points, mastery, "I know this", plays audio, and saves.
const { chromium } = require('playwright');
const U = process.argv[2];
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
  await ctx.addInitScript(() => {
    window.__plays = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (!String(this.src).startsWith('blob:') || this.duration !== 0.1) window.__plays++; return orig.call(this); };
    if (window.speechSynthesis) { const sp = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u) => { window.__plays++; return sp(u); }; }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(U); await page.waitForSelector('.hero');
  const answers = await page.evaluate(async () => { const m = {}; for (const it of await (await fetch('deck/level-01.json')).json()) m[it.id] = it.a; return m; });
  const answer = async (mode, right = true) => {
    await page.waitForSelector('.cloze-card');
    const id = await page.$eval('.cloze-card', (e) => e.dataset.id);
    if (mode === 'Choose') {
      const texts = await page.$$eval('.choice', (bs) => bs.map((x) => x.textContent.slice(1)));
      await page.keyboard.press(String((right ? texts.indexOf(answers[id]) : texts.findIndex((t) => t !== answers[id])) + 1));
    } else {
      await page.fill('.blank-input', right ? answers[id] : 'xyz');
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.feedback');
    return id;
  };
  const played = async () => { await page.goto(U + '#/stats'); await page.waitForSelector('.tile'); return Number(await page.$eval('.tile:has(.label:text("Sentences played")) .value', (e) => e.textContent)); };

  let expectPlayed = 0;
  for (const mode of ['Type', 'Listen', 'Choose']) {
    await page.goto(U + '#/'); await page.waitForSelector('.hero');
    await page.click(`.seg button:has-text("${mode}")`);
    await page.goto(U + '#/play?kind=new');
    await answer(mode);
    await page.waitForTimeout(400); await page.keyboard.press('Enter');
    await page.evaluate(() => window.__dropDb()); // Safari drops the connection
    const before = await page.evaluate(() => window.__plays);
    await answer(mode);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({
      pts: document.querySelector('.pts-pop')?.textContent,
      mastery: /Mastery/.test(document.querySelector('.feedback')?.textContent || ''),
      known: !!document.querySelector('[data-testid=known]'),
      saveError: !!document.querySelector('.feedback [role=alert]'),
      plays: window.__plays,
    }));
    ok(r.pts && r.mastery && r.known && !r.saveError, `${mode}: after the connection drop the card shows points (${r.pts}), mastery and "I know this"`);
    ok(r.plays > before, `${mode}: audio played automatically after the answer (${(await page.textContent('.source')).trim().slice(0, 30)})`);
    await page.keyboard.press('k');
    await page.waitForSelector('text=Marked as known');
    ok(true, `${mode}: "I know this" works after the drop`);
    await page.click('button[aria-label="Quit round"]');
    expectPlayed += 2;
  }
  await page.reload(); await page.waitForSelector('.hero');
  ok((await played()) === expectPlayed, `all answers were saved despite the dropped connections (${expectPlayed} sentences)`);
  // a review after another drop
  await page.goto(U + '#/'); await page.waitForSelector('.hero');
  await page.click('.seg button:has-text("Type")');
  await page.goto(U + '#/play?kind=new');
  await answer('Type', false);
  await page.click('button[aria-label="Quit round"]');
  await page.evaluate(() => window.__dropDb());
  await page.goto(U + '#/play?kind=review');
  await answer('Type', true);
  await page.waitForTimeout(800);
  ok(/Review/.test(await page.textContent('.cloze-card .badge')) && /Mastery 0% → /.test(await page.textContent('.feedback')), 'a review card after a drop shows its mastery change');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + JSON.stringify(errors) : ''}`);
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await b.close(); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
