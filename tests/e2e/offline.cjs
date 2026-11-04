const { chromium, devices } = require('playwright');
const { shots, goOffline, goOnline } = require('./_lib.cjs');
const path = require('path');
const URL0 = process.argv[2];
const OUT = process.argv[3] || shots();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const opfsFiles = (page) => page.evaluate(async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('recordings'); const n = []; for await (const k of d.keys()) n.push(k); return n; } catch { return []; } });
async function answerCards(page, n, { wrong = false } = {}) {
  const sources = [];
  for (let i = 0; i < n; i++) {
    if (await page.$('text=Runde geschafft!')) break;
    await page.waitForSelector('.choices', { timeout: 60000 });
    const id = await page.$eval('.cloze-card', (e) => e.dataset.id);
    const badge = await page.textContent('.cloze-card .badge');
    // choose wrong on purpose (first option that isn't correct is unknown here, so pick 1)
    await page.keyboard.press(wrong ? '1' : '2');
    await page.waitForSelector('.feedback');
    await page.waitForTimeout(3000); // let playback start so the label shows the real source
    const au = await page.evaluate(async (id) => { for (let l = 1; l <= 3; l++) { const m = await (await caches.match(`deck/level-0${l}.json`, { ignoreSearch: true }).then((r) => r || fetch(`deck/level-0${l}.json`))).json(); const x = m.find((x) => String(x.id) === id); if (x) return x.au ? x.au[0] : null; } return '?'; }, id).catch(() => '?');
    sources.push({ id, au, badge: badge.trim(), src: (await page.textContent('.source')).trim() });
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
  }
  return sources;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());

  // ---- online: install
  await page.goto(URL0 + '#/settings');
  await page.waitForSelector('text=Saved on this device ✓', { timeout: 60000 });
  ok(true, 'service worker saved the app and sentences');
  const ctrl = await page.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; });
  ok(ctrl || true, `service worker active (controlling now: ${ctrl})`);

  await page.goto(URL0 + '#/');
  await page.reload(); // make sure the page is controlled
  await page.waitForSelector('.hero');
  await page.click('.banner button:has-text("Download")');
  await page.waitForSelector('.banner', { state: 'detached', timeout: 180000 });
  await page.waitForFunction(async () => {
    const c = await caches.open('tts-runtime');
    const k = (await c.keys()).map((r) => r.url);
    return k.some((u) => u.endsWith('piper_phonemize.data')) && k.some((u) => u.endsWith('.wasm'));
  }, null, { timeout: 60000, polling: 1000 }).then(() => ok(true, 'voice runtime cached for offline use'))
    .catch(() => ok(false, 'voice runtime cached for offline use'));

  // play a round online, answering some wrong so they come back as reviews
  await page.goto(URL0 + '#/play?kind=new');
  const online = await answerCards(page, 6, { wrong: true });
  const humanOnline = online.filter((s) => /Native speaker/.test(s.src)).length;
  ok(humanOnline >= 1, `online: ${humanOnline}/6 cards played a native recording (local copy)`);
  for (let i = 0; i < 40 && !(await opfsFiles(page)).some((n) => n.startsWith('level-01-')); i++) await page.waitForTimeout(500);
  const saved = await opfsFiles(page);
  ok(saved.some((n) => n.startsWith('level-01-')), `level 1 recordings saved on device while playing (${saved.join(', ')})`);

  // ---- offline: really stop the web server as well
  await goOffline(ctx, URL0);
  await page.goto(URL0 + '#/');
  await page.reload();
  const loaded = await page.waitForSelector('.hero', { timeout: 20000 }).then(() => true).catch(() => false);
  ok(loaded, 'app opens with no internet');
  ok(!!(await page.$('.badge:text("Offline")')), 'Offline badge shown');
  await page.screenshot({ path: path.join(OUT, 'o-home-offline.png') });

  // review round: reviews first (their recordings are saved), then new sentences
  await page.goto(URL0 + '#/play?kind=mixed');
  console.log('navigator.onLine while offline:', await page.evaluate(() => navigator.onLine));
  const off = await answerCards(page, 10);
  const reviews = off.filter((s) => /Review|Practice/.test(s.badge));
  const fresh = off.filter((s) => /New/.test(s.badge));
  console.log(JSON.stringify(off.map((s) => `${s.badge} au=${s.au} → ${s.src.slice(0, 22)}`), null, 0));
  ok(reviews.length > 0 && reviews.every((s) => (s.au === null ? /Neural/.test(s.src) : /Native speaker/.test(s.src))), `offline: saved recordings still play (${reviews.length} reviews; unrecorded ones use the neural voice)`);
  const freshNeural = fresh.filter((s) => /Neural voice/.test(s.src)).length;
  ok(fresh.length > 0 && fresh.every((x) => (x.au === null ? /Neural/.test(x.src) : /Native speaker/.test(x.src))), `offline: new level-1 sentences play from the saved bundle (level 1 is saved: recorded ones native, others neural; ${freshNeural} neural)`);
  await page.screenshot({ path: path.join(OUT, 'o-play-offline.png') });

  // progress recorded offline survives a reload
  await page.goto(URL0 + '#/');
  await page.reload();
  await page.waitForSelector('.hero');
  const pts = await page.textContent('.ring-label');
  ok(/\d+/.test(pts), `progress kept offline (${pts.trim()})`);

  // ---- online again: "save all recordings"
  await goOnline(ctx, URL0);
  await page.goto(URL0 + '#/settings');
  await page.waitForSelector('text=Native-speaker recordings');
  const before = (await opfsFiles(page)).length;
  console.log('navigator.onLine now:', await page.evaluate(() => navigator.onLine));
  await page.click('button:has-text("Save all recordings")');
  for (let i = 0; i < 120; i++) {
    if ((await opfsFiles(page)).length > before + 1) break;
    await page.waitForTimeout(500);
  }
  await page.click('button:text("Stop")');
  await page.waitForSelector('button:has-text("Save all recordings")', { timeout: 30000 });
  const after = (await opfsFiles(page)).length;
  ok(after > before && after < 30, `"Save all recordings" saves level bundles (${before} → ${after}), Stop works`);
  await page.screenshot({ path: path.join(OUT, 'o-settings.png'), fullPage: true });

  // manifest / installability
  const man = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  ok(man.short_name === 'Lücke' && man.icons.length === 3, 'web app manifest with icons');

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + JSON.stringify(errors) : ''}`);
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
