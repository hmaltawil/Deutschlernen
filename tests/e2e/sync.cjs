// Two (then three) browsers syncing through the Firestore emulator.
const { chromium, devices } = require('playwright');
const path = require('path');
const URL0 = process.argv[2];
const OUT = process.argv[3] || require('./_lib.cjs').shots();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

async function playRound(page, query, n = 10) {
  await page.goto(URL0 + '#/play?' + query);
  for (let i = 0; i < 40; i++) {
    if (await page.$('text=Runde geschafft!')) break;
    await page.waitForSelector('.choices', { timeout: 30000 });
    const id = await page.$eval('.cloze-card', (e) => e.dataset.id);
    const answer = await page.evaluate(async (id) => {
      for (let l = 1; l <= 30; l++) {
        const m = await (await fetch(`deck/level-${String(l).padStart(2, '0')}.json`)).json();
        const x = m.find((x) => String(x.id) === id);
        if (x) return x.a;
      }
    }, id);
    const texts = await page.$$eval('.choice', (bs) => bs.map((b) => b.textContent.slice(1)));
    await page.keyboard.press(String(texts.indexOf(answer) + 1));
    await page.waitForSelector('.feedback');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
  }
  await page.waitForSelector('text=Runde geschafft!');
}
const stat = async (page, label) => {
  await page.goto(URL0 + '#/stats');
  await page.waitForSelector('.tile');
  return page.$eval(`.tile:has(.label:text("${label}")) .value`, (e) => e.textContent.trim());
};
const waitSynced = (page) => page.waitForSelector('[role=status]:has-text("Synced")', { timeout: 30000 });
async function syncNowAndWait(page) {
  await page.click('button:text("Sync now")');
  await page.waitForSelector('[role=status]:has-text("Syncing")', { timeout: 3000 }).catch(() => {});
  await waitSynced(page);
}

(async () => {
  const browser = await browser0();
  async function browser0() { return chromium.launch(); }
  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, ...opts });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    return { ctx, page };
  };
  const A = await mk();
  const B = await mk();

  // A: play a round, turn on sync
  await A.page.goto(URL0);
  await A.page.waitForSelector('.hero');
  await playRound(A.page, 'kind=new');
  const aPlayed = Number(await stat(A.page, 'Sentences played'));
  const aPoints = Number(await stat(A.page, 'Points this week'));
  await A.page.goto(URL0 + '#/settings');
  await A.page.click('button:text("Turn on sync")');
  await waitSynced(A.page);
  await A.page.click('#sync button:text("Show")');
  const code = (await A.page.textContent('[data-testid=sync-code]')).trim();
  ok(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/.test(code), `A turned on sync, code ${code.slice(0, 4)}-…`);
  ok(!!(await A.page.$('.qr svg')), 'QR code shown');
  await A.page.screenshot({ path: path.join(OUT, 's-settings-on.png'), fullPage: true });

  // B: separate progress on level 2, then join with the code
  await B.page.goto(URL0);
  await B.page.waitForSelector('.hero');
  await playRound(B.page, 'kind=new&level=2');
  const bPlayed = Number(await stat(B.page, 'Sentences played'));
  const bPoints = Number(await stat(B.page, 'Points this week'));
  await B.page.goto(URL0 + '#/settings');
  await B.page.click('button:text("I have a sync code")');
  await B.page.fill('#sync-code', code.toLowerCase().replace(/-/g, ' '));
  await B.page.click('button:text("Connect")');
  await waitSynced(B.page);
  ok(true, 'B connected with the code (typed lowercase with spaces)');
  ok(Number(await stat(B.page, 'Sentences played')) === aPlayed + bPlayed, `B now has both devices' sentences (${aPlayed} + ${bPlayed})`);
  ok(Number(await stat(B.page, 'Points this week')) === aPoints + bPoints, `B shows the combined points (${aPoints} + ${bPoints})`);

  // A pulls B's progress
  await A.page.goto(URL0 + '#/settings');
  await syncNowAndWait(A.page);
  ok(Number(await stat(A.page, 'Sentences played')) === aPlayed + bPlayed, 'A received B\'s sentences');
  ok(Number(await stat(A.page, 'Points this week')) === aPoints + bPoints, 'A shows the combined points');

  // settings travel too
  await B.page.goto(URL0 + '#/settings');
  await B.page.selectOption('#goal', '300');
  await B.page.click('#second-try');
  await B.page.click('.seg[aria-label="Theme"] button:has-text("Dark")'); // a device-only setting
  await B.page.waitForTimeout(500);
  await syncNowAndWait(B.page);
  await A.page.goto(URL0 + '#/settings');
  await syncNowAndWait(A.page);
  ok((await A.page.$eval('#goal', (e) => e.value)) === '300', 'daily goal changed on B shows up on A');
  ok(await A.page.isChecked('#second-try'), 'a game option changed on B shows up on A');
  ok((await A.page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark', 'the theme chosen on B stays on B');

  // a round finished on A reaches B automatically (sync at end of round + on focus)
  await playRound(A.page, 'kind=new&level=3', 5);
  await A.page.waitForTimeout(3000);
  await B.page.goto(URL0 + '#/settings');
  await syncNowAndWait(B.page);
  const both = Number(await stat(B.page, 'Sentences played'));
  ok(both > aPlayed + bPlayed, `a new round on A arrived on B automatically (${both} sentences)`);

  // offline answers sync later
  await B.ctx.setOffline(true);
  await playRound(B.page, 'kind=new&level=4', 5);
  const bOffline = Number(await stat(B.page, 'Sentences played'));
  await B.page.goto(URL0 + '#/settings');
  const offShown = await B.page.waitForSelector('#sync [role=status]:has-text("Offline")', { timeout: 5000 }).then(() => true).catch(() => false);
  ok(offShown, `B shows "offline — will sync later"${offShown ? '' : ' (saw: ' + (await B.page.textContent('#sync').catch(() => '?')).slice(0, 120) + ')'}`);
  await B.ctx.setOffline(false);
  await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await B.page.waitForTimeout(2500);
  await A.page.goto(URL0 + '#/settings');
  await syncNowAndWait(A.page);
  ok(Number(await stat(A.page, 'Sentences played')) === bOffline, `answers made offline on B reached A after reconnecting (${bOffline})`);

  // third device joins through the link
  const C = await mk({ ...devices['iPhone 13'] });
  await C.page.goto(URL0 + `#/sync?code=${code}`);
  await C.page.waitForSelector('button:text("Connect")');
  await C.page.screenshot({ path: path.join(OUT, 's-join-phone.png') });
  await C.page.click('button:text("Connect")');
  await waitSynced(C.page);
  ok(Number(await stat(C.page, 'Sentences played')) === bOffline, 'a phone joined via the link and got everything');
  await C.page.goto(URL0 + '#/');
  await C.page.waitForSelector('.hero');
  await C.page.screenshot({ path: path.join(OUT, 's-phone-home.png') });

  // reset on A clears everyone
  await A.page.goto(URL0 + '#/settings');
  await A.page.click('button:text("Reset progress")');
  await A.page.waitForSelector('text=Progress reset.');
  await A.page.waitForSelector('[role=status]:has-text("Syncing")', { timeout: 5000 }).catch(() => {});
  await waitSynced(A.page);
  await B.page.goto(URL0 + '#/settings');
  await syncNowAndWait(B.page);
  ok(Number(await stat(B.page, 'Sentences played')) === 0 && Number(await stat(B.page, 'Points this week')) === 0, 'reset on A cleared progress and points on B');

  // turning sync off keeps local data
  await playRound(B.page, 'kind=new', 5);
  const bAfter = Number(await stat(B.page, 'Sentences played'));
  await B.page.goto(URL0 + '#/settings');
  await B.page.click('button:text("Turn off sync on this device")');
  await B.page.waitForSelector('button:text("Turn on sync")');
  ok(Number(await stat(B.page, 'Sentences played')) === bAfter, 'turning sync off keeps this device\'s progress');

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
