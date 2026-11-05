// Stats with realistic data (a few days of points, ~80 sentences): no chart text on top of a
// column, no sideways scrolling, "1 day" not "1 days". Seeds IndexedDB directly.
const { chromium } = require('playwright');
const path = require('path');
const { shots } = require('./_lib.cjs');

const U = process.argv[2];
let failed = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`), c || failed++);

/** In the page: fill the app's database (run once the app has created it). */
async function seed(page, pointsByDaysAgo) {
  await page.evaluate(async (points) => {
    const levels = await Promise.all([1, 2].map(async (n) => (await fetch(`deck/level-0${n}.json`)).json()));
    const items = [...levels[0].slice(0, 50).map((x) => ({ ...x, lv: 1 })), ...levels[1].slice(0, 30).map((x) => ({ ...x, lv: 2 }))];
    const day = (ago) => {
      const d = new Date();
      d.setDate(d.getDate() - ago);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('luecke');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['progress', 'days'], 'readwrite');
    const now = Date.now();
    items.forEach((it, i) => {
      const stage = i % 5;
      tx.objectStore('progress').put({
        id: it.id, lv: it.lv, stage, due: i % 7 === 0 ? now - 1000 : now + (stage + 1) * 86400000,
        correct: stage + 1, wrong: i % 9 === 0 ? 2 : 0, first: now - 3 * 86400000, last: now - (i % 3) * 86400000,
      });
    });
    points.forEach((p, ago) => p && tx.objectStore('days').put({ date: day(ago), points: p, correct: Math.round(p / 6), wrong: 3, learned: 10, reviewed: 5 }));
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  }, pointsByDaysAgo);
}

(async () => {
  const b = await chromium.launch();
  for (const width of [320, 390]) {
    const page = await b.newPage({ viewport: { width, height: 844 }, colorScheme: 'dark' });
    await page.goto(U);
    await page.waitForSelector('.hero');
    // like the owner's screenshot: today 84, yesterday 610 (above the goal), the day before 150
    await seed(page, [84, 610, 150]);
    await page.goto(U + '#/stats');
    await page.reload();
    await page.waitForFunction(() => [...document.querySelectorAll('.chart .col')].some((c) => c.getAttribute('d')));
    const r = await page.evaluate(() => {
      const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const cols = [...document.querySelectorAll('.chart .col')].map((c) => c.getBoundingClientRect()).filter((x) => x.height > 0);
      const texts = [...document.querySelectorAll('.chart svg text')].map((t) => ({ t: t.textContent, box: t.getBoundingClientRect() }));
      return {
        overlaps: texts.filter((x) => cols.some((c) => hit(x.box, c))).map((x) => x.t),
        hscroll: document.documentElement.scrollWidth > innerWidth,
        tiles: [...document.querySelectorAll('.tile')].map((t) => t.innerText.replace(/\n/g, ' ')),
      };
    });
    ok(r.overlaps.length === 0, `${width}px: no chart text on a column${r.overlaps.length ? ' — ' + r.overlaps.join(', ') : ''}`);
    ok(!r.hscroll, `${width}px: no sideways scrolling on Stats`);
    const streakTiles = r.tiles.filter((t) => /streak/.test(t));
    ok(streakTiles.every((t) => !/\b1 days\b|^.*\s1\s+days/.test(t)), `${width}px: streak tiles say "day" for 1 (${streakTiles.join(' | ')})`);
    await page.screenshot({ path: path.join(shots(), `stats-${width}.png`), fullPage: true });
    await page.close();
  }
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
