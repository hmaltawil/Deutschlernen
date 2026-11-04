// Reproduce: in Type / Listen mode, after answering, points + mastery line + "I know this" + autoplay are missing.
const { chromium } = require('playwright');
const U = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.type() + ': ' + m.text().slice(0, 300)));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  // count audio playback attempts
  await ctx.addInitScript(() => {
    window.__plays = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__plays++; return orig.call(this); };
    if (window.speechSynthesis) { const sp = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u) => { window.__plays++; return sp(u); }; }
  });
  await page.goto(U); await page.waitForSelector('.hero');
  const answers = await page.evaluate(async () => {
    const m = {}; for (const it of await (await fetch('deck/level-01.json')).json()) m[it.id] = it.a; return m;
  });
  const bad = [];
  for (const mode of ['Type', 'Listen', 'Choose']) {
    await page.goto(U + '#/'); await page.waitForSelector('.hero');
    await page.click(`.seg button:has-text("${mode}")`);
    await page.goto(U + '#/play?kind=new');
    await page.waitForSelector('.cloze-card');
    const id = await page.$eval('.cloze-card', (e) => e.dataset.id);
    const before = await page.evaluate(() => window.__plays);
    if (mode === 'Choose') {
      const texts = await page.$$eval('.choice', (bs) => bs.map((x) => x.textContent.slice(1)));
      await page.keyboard.press(String(texts.indexOf(answers[id]) + 1));
    } else {
      await page.fill('.blank-input', answers[id]);
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.feedback');
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({
      verdict: document.querySelector('.verdict')?.textContent.trim(),
      points: document.querySelector('.pts-pop')?.textContent,
      mastery: !!document.querySelector('.feedback .small.muted'),
      known: !!document.querySelector('[data-testid=known]'),
      head: document.querySelector('.play-points')?.textContent,
      plays: window.__plays,
    }));
    console.log(mode.padEnd(7), JSON.stringify({ ...r, playsAfterAnswer: r.plays - before }));
    if (!(r.points && r.mastery && r.known && r.plays - before >= 1)) bad.push(mode);
    await page.click('button[aria-label="Quit round"]');
  }
  console.log('console:', JSON.stringify(logs, null, 1));
  console.log(bad.length || logs.length ? `FAILED: ${bad.join(', ')}` : 'ALL PASSED');
  await b.close();
  process.exit(bad.length || logs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
