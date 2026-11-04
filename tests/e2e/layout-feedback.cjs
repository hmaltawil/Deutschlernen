const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { builtCss, shots } = require('./_lib.cjs');
const css = builtCss(); // run `npm run build` first
const W = 'Geschwindigkeitsüberschreitung';
const html = `<main class="main">
<form class="card cloze-card">
  <div class="sentence" lang="de">Tom wurde wegen <span class="filled bad">${W}</span> angehalten.</div>
  <div class="feedback stack">
    <div class="spread"><span class="verdict bad">✕ Not quite — it’s <span lang="de">“${W}”</span></span></div>
    <div class="small">You wrote <span class="struck">Geschwindigkeitsueberschreitungg</span></div>
  </div>
</form>
<form class="card cloze-card"><div class="sentence" lang="de">Tom wurde wegen <span class="blank-wrap"><input class="blank-input" size="1" value="${W}"><span class="blank-sizer">${W}</span><span class="blank-sizer">${W}​</span></span> angehalten.</div></form>
<section class="card"><ul class="summary-list"><li><span>✓</span><div><div lang="de" style="font-family:var(--serif);font-size:1.05rem">Tom wurde wegen <strong>${W}</strong> angehalten.</div><div class="small muted">Tom was stopped for speeding.</div></div></li></ul></section>
</main>`;
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const width of [320, 360, 390]) {
    const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    await p.setContent(`<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`);
    const r = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const over = [...document.querySelectorAll('.card *')].filter((e) => { const c = e.closest('.card').getBoundingClientRect(); return e.getBoundingClientRect().right > c.right + 1; }).map((e) => e.tagName + '.' + e.className);
      return { over: [...new Set(over)], hscroll: document.documentElement.scrollWidth > vw };
    });
    console.log(width + 'px', r.over.length || r.hscroll ? 'OVERFLOW ' + JSON.stringify(r) : 'ok');
    if (r.over.length || r.hscroll) bad++;
    if (width === 320) await p.screenshot({ path: path.join(shots(), 'feedback-320.png'), fullPage: true });
    await p.close();
  }
  console.log(bad ? 'problems found' : 'no overflow'); await b.close();
  process.exit(bad ? 1 : 0);
})();
