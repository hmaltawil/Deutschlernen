// Shared helpers for the browser test suites (see README.md).
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

/** Folder for screenshots (git-ignored). */
function shots() {
  const dir = path.join(__dirname, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const isLocal = (url) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname);

async function waitUp(url) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

/**
 * Really offline: for a local preview the server is stopped (so the service worker can't
 * quietly fetch); for the live site its host is blocked. tatoeba.org is blocked too.
 */
async function goOffline(ctx, url) {
  const u = new URL(url);
  if (isLocal(url)) {
    try {
      execSync(`pkill -f "vite.*previe[w] --port ${u.port}"`);
    } catch {}
  } else {
    await ctx.route((r) => r.hostname === u.hostname, (route) => route.abort('internetdisconnected'));
  }
  await ctx.setOffline(true);
  await ctx.route(/tatoeba\.org/, (r) => r.abort('internetdisconnected'));
}

async function goOnline(ctx, url) {
  const u = new URL(url);
  if (isLocal(url)) {
    spawn('npx', ['vite', 'preview', '--port', u.port, '--strictPort'], {
      cwd: ROOT,
      env: { ...process.env, BASE_PATH: u.pathname },
      detached: true,
      stdio: 'ignore',
    }).unref();
    await waitUp(url);
  } else {
    await ctx.unroute((r) => r.hostname === u.hostname);
  }
  await ctx.unroute(/tatoeba\.org/);
  await ctx.setOffline(false);
}

/** The built app stylesheet (run `npm run build` first). */
function builtCss() {
  const dir = path.join(ROOT, 'dist', 'assets');
  const file = fs.readdirSync(dir).find((f) => /^index-.*\.css$/.test(f));
  if (!file) throw new Error('no dist/assets/index-*.css – run npm run build first');
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

module.exports = { ROOT, shots, isLocal, waitUp, goOffline, goOnline, builtCss };
