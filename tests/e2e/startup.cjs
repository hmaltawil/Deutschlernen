// Time app startup in different states, with the CPU slowed down 6x (roughly a phone).
const { chromium } = require('playwright');
const U = process.argv[2];
const INIT = () => {
  window.__perf = { long: [], t0: performance.now() };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  new MutationObserver((_, o) => {
    if (document.querySelector('.hero')) { window.__perf.hero = performance.now(); o.disconnect(); }
  }).observe(document, { childList: true, subtree: true });
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(INIT);
  let page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const measure = async (label) => {
    await page.close();
    page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const t = Date.now();
    await page.goto(U, { waitUntil: 'load' });
    await page.waitForSelector('.hero', { timeout: 60000 });
    const wall = Date.now() - t;
    await page.waitForTimeout(4000);
    const p = await page.evaluate(() => window.__perf);
    const longSum = p.long.reduce((a, b) => a + b, 0);
    console.log(`${label.padEnd(44)} home visible after ${Math.round(p.hero)} ms (wall ${wall} ms) | long tasks: ${p.long.length}, ${longSum} ms total, biggest ${Math.max(0, ...p.long)} ms`);
    const rep = await page.evaluate(() => JSON.parse(localStorage.getItem('luecke-startup') || 'null'));
    if (rep) console.log('   readout:', JSON.stringify(rep.marks), 'page', rep.page.received, 'ms', rep.page.fromOfflineCache ? '(offline copy)' : '(network)');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  };
  await page.goto(U); await page.waitForSelector('.hero');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(3000);
  await measure('1. plain (app cached, nothing else)');
  // like the user: voice downloaded
  await page.click('.banner button:has-text("Download")');
  await page.waitForSelector('.banner', { state: 'detached', timeout: 180000 });
  await page.waitForTimeout(3000);
  await measure('2. + neural voice downloaded');
  // + all recordings saved (30 bundles)
  await page.goto(U + '#/settings');
  await page.click('button:has-text("Save all recordings")');
  await page.waitForSelector('text=All recordings are on this device', { timeout: 300000 });
  await measure('3. + all recordings saved (30 bundles)');
  // + sync on
  await page.goto(U + '#/settings');
  await page.click('button:text("Turn on sync")');
  await page.waitForSelector('[role=status]:has-text("Synced")', { timeout: 30000 });
  await measure('4. + sync turned on');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
