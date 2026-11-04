// A phone that played on the old deck: progress filed under old level numbers (and one sentence
// that no longer exists) gets re-filed under the new levels when the update loads.
const { chromium } = require('playwright');
const U = process.argv[2];
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext()).newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(U); await page.waitForSelector('.hero');
  const ids = await page.evaluate(async () => {
    const lv7 = await (await fetch('deck/level-07.json')).json();
    const lv20 = await (await fetch('deck/level-20.json')).json();
    return { a: lv7[0].id, b: lv20[5].id };
  });
  // write "old deck" state straight into IndexedDB
  await page.evaluate(async ({ a, b }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('luecke', 1); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const tx = db.transaction(['progress', 'kv'], 'readwrite');
    const now = Date.now();
    const rec = (id, lv) => ({ id, lv, stage: 2, due: now - 1000, correct: 2, wrong: 0, first: now - 86400000, last: now - 86400000 });
    tx.objectStore('progress').put(rec(a, 1));          // moved: was level 1, now level 7
    tx.objectStore('progress').put(rec(b, 3));          // moved: was level 3, now level 20
    tx.objectStore('progress').put(rec(999999999, 2));  // no longer in the deck
    tx.objectStore('kv').delete('deckVersion');          // old app never stored it
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  }, ids);
  await page.reload(); await page.waitForSelector('.hero'); await page.waitForTimeout(1500);
  const after = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('luecke', 1); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const r = db.transaction('progress').objectStore('progress').getAll(); r.onsuccess = () => res(r.result); });
    const ver = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('deckVersion'); r.onsuccess = () => res(r.result); });
    db.close();
    return { all: all.map((p) => [p.id, p.lv]), ver };
  });
  const m = new Map(after.all);
  ok(m.get(ids.a) === 7 && m.get(ids.b) === 20, `progress re-filed under the new levels (${JSON.stringify(after.all)})`);
  ok(!m.has(999999999), 'a sentence that left the deck is dropped');
  ok(after.ver === 2, 'deck version remembered (runs only once)');
  ok(/2 due/.test(await page.textContent('.streak-chip[title="Sentences due for review"]')), 'both moved sentences show up as due reviews');
  await page.goto(U + '#/play?kind=review');
  await page.waitForSelector('.choices');
  const id = await page.$eval('.cloze-card', (e) => e.dataset.id);
  ok([String(ids.a), String(ids.b)].includes(id), 'a review round plays the moved sentences');
  await page.goto(U + '#/levels');
  await page.waitForSelector('.level-row');
  const row7 = await page.textContent('a.level-row[href="#/levels/7"]');
  ok(/1\/1,?0\d\d/.test(row7.replace(/\s/g, '')) || /1\/10\d\d/.test(row7), `level 7 counts the moved sentence (${row7.trim().slice(-12)})`);
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await b.close(); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
