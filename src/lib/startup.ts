/**
 * Startup timing: marks the main steps of opening the app and keeps the last
 * report (Settings → Startup time), so slow starts on a device can be diagnosed.
 */

const KEY = 'luecke-startup';
const marks: Record<string, number> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export interface StartupReport {
  at: number;
  marks: Record<string, number>;
  page: { fromOfflineCache: boolean; received: number; kind: string };
}

export function mark(name: string) {
  if (!(name in marks)) marks[name] = Math.round(performance.now());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function save() {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const report: StartupReport = {
    at: Date.now(),
    marks: { ...marks },
    page: {
      fromOfflineCache: !!nav && (nav.workerStart > 0 || nav.transferSize === 0),
      received: nav ? Math.round(nav.responseEnd) : 0,
      kind: nav?.type ?? 'navigate',
    },
  };
  try {
    // keep the previous report too, so Settings can show the start that just happened
    localStorage.setItem(KEY, JSON.stringify(report));
  } catch {
    /* ignore */
  }
}

export function lastStartup(): StartupReport | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** Run non-urgent work once the first screen has been painted. */
export function afterFirstScreen(fn: () => void, delay = 600) {
  requestAnimationFrame(() => setTimeout(fn, delay));
}
