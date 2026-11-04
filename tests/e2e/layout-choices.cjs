// Renders the app's real stylesheet with the deck's longest option words and checks that
// no choice button sticks out of the card, at several phone widths and in both themes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { builtCss, shots } = require('./_lib.cjs');
const css = builtCss(); // run `npm run build` first
const sets = [
  ['Evolutionstheorie', 'Tomatensauce', 'Meeresspiegels', 'Wintermantel'], // from the screenshot
  ['Geschwindigkeitsüberschreitung', 'Weltgesundheitsorganisation', 'Wirtschaftswissenschaften', 'Haftpflichtversicherung'],
  ['Hund', 'Katze', 'Maus', 'Vogel'], // short words keep two columns
];
const card = (opts) => {
  const long = Math.max(...opts.map((o) => o.length)) >= 11 ? 'long' : '';
  return `<form class="card cloze-card"><div class="sentence" lang="de">„Anstieg des <span class="blank" style="width:5ch">&nbsp;</span>“ verboten.</div>
  <div class="choices ${long}">${opts.map((o, i) => `<button type="button" class="choice" lang="de"><span class="kbd">${i + 1}</span><span class="choice-word">${o}</span></button>`).join('')}</div></form>`;
};
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const width of [320, 360, 390, 430, 1000]) {
    for (const theme of ['light', 'dark']) {
      const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
      await p.setContent(`<!doctype html><html lang="en" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
        <body><main class="main">${sets.map(card).join('<div style="height:16px"></div>')}</main></body></html>`);
      const r = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('.cloze-card').forEach((c, ci) => {
          const cr = c.getBoundingClientRect();
          const cols = new Set([...c.querySelectorAll('.choice')].map((x) => Math.round(x.getBoundingClientRect().left))).size;
          c.querySelectorAll('.choice').forEach((x) => {
            const xr = x.getBoundingClientRect();
            const w = x.querySelector('.choice-word');
            if (xr.right > cr.right - 1 || w.scrollWidth > w.clientWidth + 1) out.push(`set ${ci}: "${w.textContent}" overflows`);
          });
          out.push(`cols:${ci}:${cols}`);
        });
        return { out, hscroll: document.documentElement.scrollWidth > window.innerWidth };
      });
      const problems = r.out.filter((x) => !x.startsWith('cols'));
      const cols = r.out.filter((x) => x.startsWith('cols')).map((x) => x.split(':')[2]).join('/');
      console.log(`${String(width).padStart(4)}px ${theme.padEnd(5)} columns per set ${cols}  ${problems.length || r.hscroll ? 'OVERFLOW ' + problems.join('; ') : 'ok'}`);
      if (problems.length || r.hscroll) bad++;
      if (theme === 'dark' && (width === 390 || width === 320)) await p.screenshot({ path: path.join(shots(), `choices-${width}.png`), fullPage: true });
      await p.close();
    }
  }
  console.log(bad ? `${bad} layouts overflow` : 'no overflow anywhere');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
