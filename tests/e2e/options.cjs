// Settings → "While you answer": speaker before answering, colour hint, box size, ä ö ü ß buttons,
// strict umlauts and second try for small typos.
const { chromium } = require('playwright');
const { shots } = require('./_lib.cjs');
const path = require('path');

const U = process.argv[2];
let failed = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`), c || failed++);
const fold = (s) => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    window.__plays = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays++;
      return orig.call(this);
    };
    if (window.speechSynthesis) {
      const sp = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = (u) => (window.__plays++, sp(u));
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(U);
  await page.waitForSelector('.hero');
  const deck = await page.evaluate(async () => {
    const m = await (await fetch('deck/manifest.json')).json();
    const out = {};
    for (const l of m.levels) out[l.n] = (await (await fetch('deck/' + l.file)).json()).map((it) => ({ id: it.id, a: it.a }));
    return out;
  });
  const answerOf = {};
  for (const items of Object.values(deck)) for (const it of items) answerOf[it.id] = it.a;
  const speaker = () => page.$eval('button[aria-label^="Play sentence audio"]', (e) => getComputedStyle(e).visibility);
  const plays = () => page.evaluate(() => window.__plays);
  const toggle = async (id, on) => {
    await page.goto(U + '#/settings');
    await page.waitForSelector(`#${id}`);
    if ((await page.isChecked(`#${id}`)) !== on) await page.click(`#${id}`);
  };

  // 1. Choose: the speaker is hidden until you answer, and R does nothing
  await page.goto(U + '#/play?kind=new');
  await page.waitForSelector('.cloze-card');
  ok((await speaker()) === 'hidden', 'Choose: no speaker button before answering');
  await page.click('.sentence'); // first tap: the app plays a moment of silence to unlock audio (iPhone)
  await page.waitForTimeout(500);
  const p0 = await plays();
  await page.keyboard.press('r');
  await page.waitForTimeout(500);
  ok((await plays()) === p0, 'Choose: R does not play the sentence before answering');
  await page.keyboard.press('1');
  await page.waitForSelector('.feedback');
  ok((await speaker()) === 'visible', 'Choose: speaker button is back after answering');
  await page.click('button[aria-label="Quit round"]');

  // 2. the setting brings it back before answering
  await toggle('audio-before', true);
  await page.goto(U + '#/play?kind=new');
  await page.waitForSelector('.cloze-card');
  ok((await speaker()) === 'visible', 'with "Speaker button before answering" on, it shows before answering');
  const p1 = await plays();
  await page.click('button[aria-label^="Play sentence audio"]');
  await page.waitForTimeout(800);
  ok((await plays()) > p1, '…and plays the sentence');
  await page.click('button[aria-label="Quit round"]');
  await toggle('audio-before', false);

  // 3. Type mode with colour hint, same-size box, strict umlauts and second try
  for (const id of ['typing-color', 'strict-umlauts', 'second-try']) await toggle(id, true);
  await toggle('fit-box', false);
  await page.goto(U + '#/');
  await page.click('.seg button:has-text("Type")');
  // a level whose first 10 sentences have an umlaut answer (not the first) and a first answer of 5+ letters without one
  const um = (a) => /[äöüßÄÖÜ]/.test(a);
  let lv = 0;
  let umIndex = -1;
  for (const [n, items] of Object.entries(deck)) {
    const i = items.slice(1, 10).findIndex((it) => um(it.a) && it.a.length >= 3);
    if (i >= 0 && items[0].a.length >= 5 && !um(items[0].a)) {
      lv = Number(n);
      umIndex = i + 1;
      break;
    }
  }
  ok(lv > 0, `found level ${lv} with an umlaut answer at card ${umIndex + 1}`);
  await page.goto(U + `#/play?kind=new&level=${lv}`);
  await page.waitForSelector('.blank-input');
  const card = async () => answerOf[Number(await page.$eval('.cloze-card', (e) => e.dataset.id))];

  // card 1: box size, colour hint, second try
  let a = await card();
  ok(!(await page.$('.umlauts')), 'no ä ö ü ß buttons by default');
  ok(!!(await page.$('.blank-wrap.same-size')), `same-size box for "${a}" (sizes are checked in layout-typing.cjs)`);
  await page.fill('.blank-input', a.slice(0, 2).toLowerCase());
  ok(await page.$eval('.blank-input', (e) => e.classList.contains('on-track')), 'colour hint: green while the start matches');
  await page.fill('.blank-input', a.slice(0, 2) + 'qx');
  ok(await page.$eval('.blank-input', (e) => e.classList.contains('off-track')), 'colour hint: red once it does not');
  await page.screenshot({ path: path.join(shots(), 'options-typing.png') });
  const typo = a.slice(0, -1) + (a.endsWith('x') ? 'y' : 'x');
  await page.fill('.blank-input', typo);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok((await page.$('.try-again')) && !(await page.$('.feedback')), `second try: "${typo}" gets "try again", not a wrong answer`);
  await page.screenshot({ path: path.join(shots(), 'options-second-try.png') });
  await page.fill('.blank-input', a);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.feedback');
  const verdict = (await page.textContent('.verdict')).trim();
  const pts = await page.textContent('.pts-pop').catch(() => '');
  ok(/Richtig/.test(verdict) && pts.trim() === '+4', `fixed answer counts as right for half points (${verdict}, ${pts})`);
  await page.waitForTimeout(400);
  await page.click('.next-bar button');

  // cards until the umlaut one: answer right
  for (let i = 1; i < umIndex; i++) {
    await page.waitForSelector('.blank-input');
    await page.fill('.blank-input', await card());
    await page.keyboard.press('Enter');
    await page.waitForSelector('.feedback');
    await page.waitForTimeout(400);
    await page.click('.next-bar button');
  }
  // the umlaut card: ae/oe/ue/ss is not accepted when strict
  await page.waitForSelector('.blank-input');
  a = await card();
  await page.fill('.blank-input', fold(a));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok(!!(await page.$('.try-again')), `strict umlauts: "${fold(a)}" for "${a}" is a near miss (second try offered)`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.feedback');
  ok(/Almost/.test(await page.textContent('.verdict')), 'strict umlauts: the same spelling again counts as wrong ("Almost")');

  // 4. defaults restored: ae spelling accepted again
  await page.click('button[aria-label="Quit round"]');
  await toggle('strict-umlauts', false);
  await toggle('second-try', false);
  await toggle('fit-box', true);
  await toggle('umlaut-buttons', true);
  await page.goto(U + `#/play?kind=review`); // the umlaut sentence answered wrong is due again
  await page.waitForSelector('.blank-input');
  a = await card();
  ok((await page.$$('.umlauts button')).length === 4, 'the ä ö ü ß buttons come back with the option');
  await page.click('.umlauts button:has-text("ü")');
  ok((await page.inputValue('.blank-input')) === 'ü', '…and type into the box');
  await page.fill('.blank-input', '');
  ok(!(await page.$('.blank-wrap.same-size')) && !!(await page.$('.blank-wrap')), 'box fits the word again when the option is on');
  for (let i = 0; i < 6 && !um(a); i++) {
    await page.fill('.blank-input', a);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.feedback');
    await page.waitForTimeout(400);
    await page.click('.next-bar button');
    await page.waitForSelector('.blank-input');
    a = await card();
  }
  await page.fill('.blank-input', fold(a));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.feedback');
  ok(um(a) && /Richtig/.test(await page.textContent('.verdict')), `without strict umlauts "${fold(a)}" is accepted for "${a}"`);

  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
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
