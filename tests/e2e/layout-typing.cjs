// The typing box fits the missing word: every letter visible (nothing scrolled away) and not
// much wider than the word, for short/long and narrow/wide words, on phones and a desktop.
// With "Box fits the missing word" off, every box has the same size and grows while typing.
const { chromium } = require('playwright');
const path = require('path');
const { shots } = require('./_lib.cjs');

const U = process.argv[2];
let failed = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`), c || failed++);

/** In the page: how well the text in the box fits it. */
function measure() {
  const el = document.querySelector('.blank-input');
  const cs = getComputedStyle(el);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = ctx.measureText(el.value).width;
  const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const card = el.closest('.card').getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const wrap = el.parentElement;
  const atMin = Math.abs(wrap.getBoundingClientRect().width - parseFloat(getComputedStyle(wrap).minWidth)) < 1;
  return {
    atMin, // very short words get a minimum size, so the box stays easy to tap
    width: Math.round(box.width),
    clipped: el.scrollWidth > el.clientWidth + 1 || text > inner + 0.5,
    slackEm: (inner - text) / parseFloat(cs.fontSize),
    outside: box.right > card.right + 1 || box.left < card.left - 1,
  };
}

(async () => {
  const b = await chromium.launch();
  for (const width of [320, 390, 1000]) {
    const page = await b.newPage({ viewport: { width, height: 844 }, colorScheme: 'dark' });
    await page.goto(U);
    await page.waitForSelector('.hero');
    const answerOf = await page.evaluate(async () => {
      const m = await (await fetch('deck/manifest.json')).json();
      const out = {};
      for (const l of m.levels) for (const it of await (await fetch('deck/' + l.file)).json()) out[it.id] = it.a;
      return out;
    });
    await page.click('.seg button:has-text("Type")');
    const card = async () => answerOf[Number(await page.$eval('.cloze-card', (e) => e.dataset.id))];
    const bad = [];
    let worstSlack = 0;
    let n = 0;
    for (const lv of [1, 6, 15, 30]) {
      await page.goto(U + `#/play?kind=new&level=${lv}`);
      for (let i = 0; i < 6; i++) {
        await page.waitForSelector('.blank-input');
        const a = await card();
        await page.fill('.blank-input', a);
        const m = await page.evaluate(measure);
        n++;
        if (!m.atMin) worstSlack = Math.max(worstSlack, m.slackEm);
        if (m.clipped || m.outside || (m.slackEm > 0.6 && !m.atMin)) bad.push(`${a} (${m.clipped ? 'cut off' : m.outside ? 'sticks out' : `+${m.slackEm.toFixed(2)}em`})`);
        if (width === 390 && lv === 1 && i === 0) await page.screenshot({ path: path.join(shots(), 'typing-box-390.png') });
        await page.keyboard.press('Enter');
        await page.waitForSelector('.feedback');
        await page.waitForTimeout(380);
        await page.click('.next-bar button');
      }
      await page.click('button[aria-label="Quit round"]');
      await page.waitForSelector('.hero');
    }
    ok(bad.length === 0, `${width}px: ${n} words fit their box (largest gap ${worstSlack.toFixed(2)}em)${bad.length ? ' — ' + bad.join(', ') : ''}`);

    // same-size box
    await page.goto(U + '#/settings');
    await page.click('#fit-box');
    const widths = [];
    await page.goto(U + `#/play?kind=new&level=9`);
    for (let i = 0; i < 3; i++) {
      await page.waitForSelector('.blank-input');
      widths.push((await page.evaluate(measure)).width);
      await page.fill('.blank-input', await card());
      await page.keyboard.press('Enter');
      await page.waitForSelector('.feedback');
      await page.waitForTimeout(380);
      await page.click('.next-bar button');
    }
    ok(new Set(widths).size === 1, `${width}px: same-size box for every word (${widths.join(', ')} px)`);
    await page.waitForSelector('.blank-input');
    await page.fill('.blank-input', 'Geschwindigkeitsbegrenzung');
    const long = await page.evaluate(measure);
    ok(long.width > widths[0] && !long.outside, `${width}px: it grows while typing a long word and stays inside the card (${long.width} px)`);
    await page.goto(U + '#/settings');
    await page.click('#fit-box');
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
