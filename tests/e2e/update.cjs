// A new version of the app must not reload the page in the middle of a round:
// it waits until you leave the round (Quit/Home) or start the next one ("Next round").
// Local preview only: it simulates a deploy by changing dist/sw.js (same length, so the
// preview server keeps serving it correctly) and asking the browser to check for updates.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, isLocal } = require('./_lib.cjs');

const U = process.argv[2];
let failed = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`), c || failed++);

const swFile = path.join(ROOT, 'dist', 'sw.js');
const original = fs.existsSync(swFile) ? fs.readFileSync(swFile, 'utf8') : '';
let deploys = 0;
/** Simulate a deploy: flip one character of a precache revision (keeps the file size). */
function deploy() {
  deploys++;
  const s = fs.readFileSync(swFile, 'utf8');
  const m = s.match(/url:"manifest\.webmanifest",revision:"([0-9a-f])/);
  const i = m.index + m[0].length - 1;
  const next = s[i] === 'a' ? 'b' : 'a';
  fs.writeFileSync(swFile, s.slice(0, i) + next + s.slice(i + 1));
}

(async () => {
  if (!isLocal(U)) {
    console.log('skipped: needs the local preview (it changes dist/sw.js)');
    return;
  }
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(U);
  await page.waitForSelector('.hero');
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  /** Trigger an update check and wait until the new version has taken over. */
  const newVersion = async () => {
    deploy();
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          navigator.serviceWorker.getRegistration().then((r) => r.update());
          setTimeout(resolve, 20000);
        }),
    );
    await page.waitForTimeout(1500); // a reload would have happened by now
  };
  const answerOne = async () => {
    await page.keyboard.press('1');
    await page.waitForSelector('.feedback');
    await page.waitForTimeout(400);
    await page.click('.next-bar button');
  };

  // 1. update arrives during a round → no reload until you quit
  await page.goto(U + '#/play?kind=new');
  await page.waitForSelector('.cloze-card');
  await answerOne();
  await page.evaluate(() => (window.__sameRound = true));
  await newVersion();
  ok(await page.evaluate(() => window.__sameRound === true), 'no reload while a round is being played');
  await answerOne();
  ok(await page.$('.cloze-card'), 'the round goes on normally');
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('button[aria-label="Quit round"]')]);
  await page.waitForSelector('.hero');
  ok(await page.evaluate(() => window.__sameRound === undefined), 'leaving the round loads the new version');

  // 2. update during a round → applied when you tap "Next round"
  await page.goto(U + '#/settings');
  await page.selectOption('#round', '5');
  await page.goto(U + '#/play?kind=new');
  await page.waitForSelector('.cloze-card');
  await page.evaluate(() => (window.__sameRound = true));
  await newVersion();
  for (let i = 0; i < 12 && !(await page.$('.summary-list')); i++) await answerOne();
  ok(await page.evaluate(() => window.__sameRound === true), 'still no reload at the end of the round');
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('button:has-text("Next round")')]);
  await page.waitForSelector('.cloze-card');
  ok(await page.evaluate(() => window.__sameRound === undefined), '"Next round" starts the next round in the new version');

  // 3. update while on Home → reloads right away (as before)
  await page.goto(U + '#/');
  await page.waitForSelector('.hero');
  await page.evaluate(() => (window.__sameRound = true));
  const reloaded = page.waitForEvent('load', { timeout: 20000 }).then(() => true, () => false);
  await newVersion();
  ok(await reloaded, 'on Home the new version loads right away');

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await b.close();
})()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    if (deploys && original) fs.writeFileSync(swFile, original);
    console.log(failed ? 'FAILED' : 'ALL PASSED');
    process.exit(failed ? 1 : 0);
  });
