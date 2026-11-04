const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL0 = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || require('./_lib.cjs').shots();
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

async function deckMap(page) {
  return page.evaluate(async () => {
    const m = await (await fetch('deck/manifest.json')).json();
    const map = {};
    for (const l of m.levels.slice(0, 3)) {
      const items = await (await fetch('deck/' + l.file)).json();
      for (const it of items) map[it.id] = { a: it.a, au: !!it.au, id: it.id };
    }
    return map;
  });
}

async function currentKey(page) {
  return page.$eval('.cloze-card', (e) => e.dataset.id);
}

async function answerRound(page, map, { mode, wrongIdx = [] }) {
  let n = 0;
  const log = [];
  for (;;) {
    const done = await page.$('text=Runde geschafft!');
    if (done) break;
    await page.waitForSelector('.cloze-card');
    const key = await currentKey(page);
    const entry = map[key];
    if (!entry) throw new Error('sentence not found in deck map: ' + key);
    const isRetry = !!(await page.$('.badge:text("Practice again")'));
    const wrong = !isRetry && wrongIdx.includes(n);
    if (mode === 'mc') {
      const buttons = await page.$$('.choice');
      const texts = await Promise.all(buttons.map((b) => b.evaluate((e) => e.textContent.slice(1))));
      const i = wrong ? texts.findIndex((t) => t !== entry.a) : texts.indexOf(entry.a);
      await page.keyboard.press(String(i + 1));
    } else {
      await page.fill('.blank-input', wrong ? 'xyzzy' : entry.a.toLowerCase());
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.feedback');
    const verdict = await page.textContent('.verdict');
    log.push({ n, retry: isRetry, wrong, verdict: verdict.trim().slice(0, 30) });
    if (!isRetry) n++;
    await page.waitForTimeout(450); // > Enter guard
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  return log;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());

  await page.goto(URL0);
  await page.waitForSelector('.hero');
  const map = await deckMap(page);
  ok(Object.keys(map).length >= 3000, `deck loads (${Object.keys(map).length} sentences in levels 1–3)`);

  // ---- 1. multiple-choice round with 3 wrong answers
  await page.click('a.btn.primary.big');
  const log1 = await answerRound(page, map, { mode: 'mc', wrongIdx: [1, 4, 7] });
  const retries = log1.filter((l) => l.retry).length;
  ok(log1.filter((l) => !l.retry).length === 10, 'MC round has 10 sentences');
  ok(retries === 3, `wrong answers are re-asked once at the end (${retries} retries)`);
  ok(log1.filter((l) => !l.retry && !l.wrong).every((l) => l.verdict.startsWith('Richtig')), 'correct choices are marked Richtig');
  const summary = await page.textContent('.hero');
  const m = summary.match(/\+(\d+) points · (\d+)\/(\d+) correct/);
  ok(m && m[2] === '7' && m[3] === '10', `summary: ${m && m[0]}`);
  const roundPts = m ? Number(m[1]) : 0;
  // 7 correct with combo: 4,4.4,(reset)... just check plausible range
  ok(roundPts >= 28 && roundPts <= 42, `MC points in expected range (${roundPts})`);
  await page.screenshot({ path: path.join(OUT, 'd-summary.png'), fullPage: true });

  // ---- 2. persistence across reload
  await page.click('a.btn.big:text("Home")');
  await page.waitForSelector('.hero');
  await page.reload();
  await page.waitForSelector('.hero');
  const ring = await page.textContent('.ring-label');
  ok(ring.startsWith(String(roundPts)), `today's points persist after reload (${ring})`);
  const due = await page.textContent('.streak-chip[title="Sentences due for review"]');
  ok(/3 due/.test(due), `3 wrong answers are due for review (${due.trim()})`);

  // ---- 3. typed review round
  await page.click('.seg button:has-text("Type")');
  await page.click('a.btn:text("Review (3)")');
  await page.waitForSelector('.blank-input');
  await page.screenshot({ path: path.join(OUT, 'd-type.png') });
  const log2 = await answerRound(page, map, { mode: 'text' });
  ok(log2.length === 3 && log2.every((l) => l.verdict.startsWith('Richtig')), 'typed review: 3/3 accepted (lowercase input)');
  await page.click('a.btn.big:text("Home")');
  await page.waitForSelector('.hero');
  ok(/0 due/.test(await page.textContent('.streak-chip[title="Sentences due for review"]')), 'reviews cleared after correct answers');

  // ---- 4. umlaut / near-miss handling in the UI
  await page.click('a.btn:text("Learn new")');
  await page.waitForSelector('.blank-input');
  const key = await currentKey(page);
  const ans = map[key].a;
  const ascii = ans.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  await page.fill('.blank-input', ascii);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.feedback');
  const vtxt = await page.textContent('.verdict');
  ok(vtxt.trim().startsWith('Richtig'), `ASCII spelling accepted ("${ascii}" for "${ans}") → "${vtxt.trim()}" card=${key} input=${await page.$eval('.feedback', (e) => e.textContent.slice(0, 120))}`);
  await page.click('button[aria-label="Quit round"]');

  // ---- 5. listening mode
  await page.waitForSelector('.hero');
  await page.click('.seg button:has-text("Listen")');
  await page.click('a.btn:text("Learn new")');
  await page.waitForSelector('.blank-input');
  const masks = await page.$$eval('.mask-word', (e) => e.length);
  ok(masks > 0, `listening mode hides the sentence (${masks} masked words)`);
  await page.screenshot({ path: path.join(OUT, 'd-listen.png') });
  await page.click('button[aria-label="Quit round"]');
  await page.waitForSelector('.hero');
  await page.click('.seg button:has-text("Choose")');

  // ---- 6. native-speaker audio is reachable and decodable
  const humanId = Object.values(map).find((e) => e.au);
  const auItem = await page.evaluate(async (id) => {
    const m = await (await fetch('deck/level-01.json')).json();
    return m.find((x) => x.au);
  }, humanId.id);
  const res = await ctx.request.get(`https://tatoeba.org/audio/download/${auItem.au[0]}`);
  ok(res.ok() && /audio\/mpeg/.test(res.headers()['content-type']), `recording URL returns ${res.headers()['content-type']}`);
  const dur = await page.evaluate(
    (u) =>
      new Promise((r) => {
        const a = new Audio(u);
        a.onloadedmetadata = () => r(a.duration);
        a.onerror = () => r(-1);
        a.load();
        setTimeout(() => r(-2), 30000);
      }),
    `https://tatoeba.org/en/audio/download/${auItem.au[0]}`,
  );
  ok(dur > 0.3, `recording loads in an <audio> element (duration ${dur.toFixed ? dur.toFixed(2) : dur}s)`);

  // ---- 7. neural voice download + synthesis through the UI
  await page.click('.banner button:has-text("Download")');
  await page.waitForSelector('.banner', { state: 'detached', timeout: 180000 });
  ok(true, 'neural voice downloaded via banner');
  await page.goto(URL0 + '#/settings');
  await page.waitForSelector('text=Downloaded ✓');
  ok(true, 'settings shows the voice as downloaded');
  // play cards until one without a recording appears; check the neural voice was used
  await page.goto(URL0 + '#/play?kind=new');
  let neural = false;
  for (let i = 0; i < 10 && !neural; i++) {
    await page.waitForSelector('.choices');
    const k = await currentKey(page);
    await page.keyboard.press('1');
    await page.waitForSelector('.feedback');
    if (!map[k].au) {
      await page.waitForFunction(() => /Neural voice|Browser voice/.test(document.querySelector('.source')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
      const src = await page.textContent('.source');
      neural = /Neural voice/.test(src);
      ok(neural, `unrecorded sentence uses the neural voice ("${src.trim()}")`);
      await page.screenshot({ path: path.join(OUT, 'd-neural.png') });
      break;
    }
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
  }

  // ---- 8. export / reset / import round-trip
  await page.goto(URL0 + '#/settings');
  await page.waitForSelector('text=Your data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:text("Export backup")')]);
  const file = path.join(OUT, 'backup.json');
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(backup.app === 'luecke' && backup.progress.length >= 11, `backup has ${backup.progress.length} sentences`);
  await page.click('button:text("Reset progress")');
  await page.waitForSelector('text=Progress reset.');
  await page.goto(URL0 + '#/');
  await page.waitForSelector('.hero');
  ok((await page.textContent('.tile .value')).trim() === '0', 'reset clears progress');
  await page.goto(URL0 + '#/settings');
  await page.setInputFiles('input[data-testid="import-file"]', file);
  await page.waitForSelector('text=Backup restored.');
  await page.goto(URL0 + '#/');
  await page.waitForSelector('.hero');
  ok(Number((await page.textContent('.tile .value')).trim()) === backup.progress.length, 'import restores progress');

  // ---- 9. stats page renders charts
  await page.goto(URL0 + '#/stats');
  await page.waitForSelector('.chart svg');
  const cols = await page.$$eval('.chart .col', (e) => e.filter((x) => x.getAttribute('d')).length);
  ok(cols >= 1, `points chart has ${cols} non-empty column(s)`);
  await page.hover('.chart .col-hit >> nth=29');
  ok(!!(await page.$('.tooltip')), 'hovering a column shows a tooltip');
  await page.screenshot({ path: path.join(OUT, 'd-stats.png'), fullPage: true });

  // dark theme
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(OUT, 'd-stats-dark.png'), fullPage: true });
  await page.goto(URL0 + '#/play?kind=new');
  await page.waitForSelector('.choices');
  await page.keyboard.press('2');
  await page.waitForSelector('.feedback');
  await page.screenshot({ path: path.join(OUT, 'd-play-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // ---- 10. phone layout
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await pp.goto(URL0);
  await pp.waitForSelector('.hero');
  await pp.screenshot({ path: path.join(OUT, 'p-home.png'), fullPage: true });
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!overflow, 'no horizontal scroll on phone (home)');
  await pp.click('a.btn.primary.big');
  await pp.waitForSelector('.choices');
  await pp.screenshot({ path: path.join(OUT, 'p-play.png') });
  await pp.click('.choice >> nth=0');
  await pp.waitForSelector('.feedback');
  await pp.screenshot({ path: path.join(OUT, 'p-play-answered.png') });
  await pp.goto(URL0 + '#/settings');
  await pp.waitForSelector('.seg');
  await pp.click('.seg button:has-text("Type")');
  await pp.goto(URL0 + '#/play?kind=new');
  await pp.waitForSelector('.blank-input');
  await pp.screenshot({ path: path.join(OUT, 'p-type.png') });
  ok(!(await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal scroll on phone (typing)');
  await pp.goto(URL0 + '#/stats');
  await pp.waitForSelector('.chart svg');
  await pp.screenshot({ path: path.join(OUT, 'p-stats.png'), fullPage: true });
  ok(!(await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal scroll on phone (stats)');
  await pp.goto(URL0 + '#/levels/1');
  await pp.waitForSelector('.sent-row');
  await pp.screenshot({ path: path.join(OUT, 'p-level.png') });

  const real = errors.filter((e) => !/numThreads|multi-threading/i.test(e));
  ok(real.length === 0, `no console errors${real.length ? ': ' + JSON.stringify(real) : ''}`);
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
