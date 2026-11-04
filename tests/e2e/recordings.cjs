// Recording bundles: auto-save of the level being played, offline playback from the saved
// bundle, "save all", remove, and removal of the old per-recording cache.
const { chromium } = require('playwright');
const { goOffline, goOnline } = require('./_lib.cjs');
const URL0 = process.argv[2];
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

async function cards(page, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (await page.$('text=Runde geschafft!')) break;
    await page.waitForSelector('.choices', { timeout: 30000 });
    const badge = (await page.textContent('.cloze-card .badge')).trim();
    await page.keyboard.press('1');
    await page.waitForSelector('.feedback');
    await page.waitForTimeout(3000); // label shows the source that actually started playing
    out.push({ badge, src: (await page.textContent('.source')).trim() });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  return out;
}
const opfs = (page) => page.evaluate(async () => {
  try {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('recordings');
    const out = {};
    for await (const [name, h] of d.entries()) out[name] = (await h.getFile()).size;
    return out;
  } catch { return {}; }
});
const levelsSaved = async (page) => {
  await page.goto(URL0 + '#/settings');
  await page.waitForSelector('[data-testid=levels-saved]');
  await page.waitForTimeout(800);
  return (await page.textContent('[data-testid=levels-saved]')).trim();
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());

  // old-style per-recording cache from the previous version
  await page.goto(URL0);
  await page.waitForSelector('.hero');
  await page.evaluate(async () => {
    const c = await caches.open('recordings');
    for (let i = 0; i < 300; i++) await c.put(`audio/${i}.mp3`, new Response('x', { headers: { 'content-type': 'audio/mpeg' } }));
  });
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(3500);
  ok(!(await page.evaluate(() => caches.keys())).includes('recordings'), 'the old per-recording cache is removed on start');

  const man = await page.evaluate(async () => (await fetch('deck/manifest.json')).json());
  const size1 = man.levels[0].packBytes;
  const name1 = man.levels[0].pack;

  // online, level 1 not saved yet: recordings stream from the bundle on the site; the level saves itself
  await page.goto(URL0 + '#/play?kind=new');
  const online = await cards(page, 5);
  ok(online.filter((c) => /Native speaker/.test(c.src)).length >= 3, `online: native recordings play (${online.map((c) => c.src.slice(0, 14)).join(' | ')})`);
  for (let i = 0; i < 40 && (await opfs(page))[name1] !== size1; i++) await page.waitForTimeout(500);
  ok((await opfs(page))[name1] === size1, `level 1 bundle saved automatically (${(size1 / 1e6).toFixed(1)} MB, one file)`);
  ok(!(await page.evaluate(() => caches.keys())).includes('recordings'), 'no per-recording cache entries are created any more');
  ok((await levelsSaved(page)) === '1 / 30 levels saved', 'Settings shows 1 / 30 levels saved');
  // a bundle from an older deck (stale name) is deleted on start
  await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('recordings', { create: true }); const w = await (await d.getFileHandle('level-01.pack', { create: true })).createWritable(); await w.write('old'); await w.close(); });
  await page.goto(URL0 + '#/'); await page.reload(); await page.waitForSelector('.hero'); await page.waitForTimeout(3500);
  ok(!('level-01.pack' in (await opfs(page))) && (name1 in (await opfs(page))), 'outdated bundle from the old deck is deleted, current one kept');

  // offline (server stopped, tatoeba blocked): level 1 recordings still play from the device
  await goOffline(ctx, URL0);
  await page.goto(URL0 + '#/');
  await page.reload();
  await page.waitForSelector('.hero', { timeout: 20000 });
  await page.goto(URL0 + '#/play?kind=new&level=1');
  const offline1 = await cards(page, 4);
  ok(offline1.filter((c) => /Native speaker/.test(c.src)).length >= 3, `offline: saved level plays native recordings (${offline1.map((c) => c.src.slice(0, 14)).join(' | ')})`);
  await page.goto(URL0 + '#/play?kind=new&level=6');
  const offline6 = await cards(page, 3);
  ok(offline6.every((c) => !/Native speaker/.test(c.src)), `offline: unsaved level falls back (${offline6.map((c) => c.src.slice(0, 14)).join(' | ')})`);

  // online again: save all, stop, then save all to the end
  await goOnline(ctx, URL0);
  await page.goto(URL0 + '#/settings');
  await page.waitForSelector('button:has-text("Save all recordings")');
  await page.click('button:has-text("Save all recordings")');
  await page.waitForSelector('text=Saving…');
  await page.waitForTimeout(1500);
  await page.click('button:text("Stop")');
  await page.waitForSelector('button:has-text("Save all recordings")', { timeout: 60000 });
  const partial = Object.keys(await opfs(page)).length;
  ok(partial > 1 && partial < 30, `Stop works (${partial} levels saved)`);
  await page.click('button:has-text("Save all recordings")');
  await page.waitForSelector('text=All recordings are on this device', { timeout: 180000 });
  const files = await opfs(page);
  const sizesOk = man.levels.every((l) => files[l.pack] === l.packBytes);
  ok(Object.keys(files).length === 30 && sizesOk, `all 30 bundles saved with correct sizes (${(Object.values(files).reduce((a, b) => a + b, 0) / 1e6).toFixed(0)} MB)`);
  ok((await page.evaluate(() => caches.keys())).every((n) => n !== 'recordings'), 'still no per-recording cache');

  // remove
  await page.click('button:text("Remove saved recordings")');
  await page.waitForSelector('text=0 / 30 levels saved');
  ok(Object.keys(await opfs(page)).length === 0, 'remove deletes the saved bundles');

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + JSON.stringify(errors) : ''}`);
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
