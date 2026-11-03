import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadManifest, type Item, type Manifest } from './lib/deck';
import { loadAll, saveAnswer, saveSettings } from './lib/db';
import { dayKey, emptyDay, type DayStat } from './lib/scoring';
import { MAX_STAGE, newProgress, review, type Progress } from './lib/srs';
import { DEFAULT_SETTINGS, type Settings } from './lib/settings';
import { piper } from './lib/audio';

export interface AnswerInput {
  item: Item;
  correct: boolean;
  points: number;
  isNew: boolean;
  retry: boolean;
}

interface Store {
  ready: boolean;
  error: string | null;
  manifest: Manifest | null;
  progress: Map<number, Progress>;
  days: Map<string, DayStat>;
  settings: Settings;
  now: number;
  today: string;
  dueCount: number;
  playedPerLevel: Map<number, number>;
  masteredPerLevel: Map<number, number>;
  recordAnswer(a: AnswerInput): Promise<{ before: Progress | null; after: Progress | null }>;
  updateSettings(patch: Partial<Settings>): void;
  reload(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [progress, setProgress] = useState<Map<number, Progress>>(new Map());
  const [days, setDays] = useState<Map<string, DayStat>>(new Map());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [now, setNow] = useState(() => Date.now());
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const daysRef = useRef(days);
  daysRef.current = days;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const reload = useCallback(async () => {
    try {
      const [m, data] = await Promise.all([loadManifest(), loadAll()]);
      setManifest(m);
      setProgress(new Map(data.progress.map((p) => [p.id, p])));
      setDays(new Map(data.days.map((d) => [d.date, d])));
      setSettings(data.settings);
      setReady(true);
      piper.check(data.settings.voice);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [reload]);

  // theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const recordAnswer = useCallback(async (a: AnswerInput) => {
    if (a.retry) return { before: progressRef.current.get(a.item.id) ?? null, after: null };
    const t = Date.now();
    const today = dayKey(t);
    const before = progressRef.current.get(a.item.id) ?? null;
    const after = review(before ?? newProgress(a.item.id, a.item.lv, t), a.correct, t, settingsRef.current.intervals);
    const d0 = daysRef.current.get(today) ?? emptyDay(today);
    const day: DayStat = {
      ...d0,
      points: d0.points + a.points,
      correct: d0.correct + (a.correct ? 1 : 0),
      wrong: d0.wrong + (a.correct ? 0 : 1),
      learned: d0.learned + (a.isNew ? 1 : 0),
      reviewed: d0.reviewed + (a.isNew ? 0 : 1),
    };
    const p = new Map(progressRef.current).set(after.id, after);
    const ds = new Map(daysRef.current).set(today, day);
    progressRef.current = p;
    daysRef.current = ds;
    setProgress(p);
    setDays(ds);
    setNow(t);
    await saveAnswer(after, day);
    return { before, after };
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);

  const derived = useMemo(() => {
    let dueCount = 0;
    const playedPerLevel = new Map<number, number>();
    const masteredPerLevel = new Map<number, number>();
    for (const p of progress.values()) {
      if (p.due <= now) dueCount++;
      playedPerLevel.set(p.lv, (playedPerLevel.get(p.lv) ?? 0) + 1);
      if (p.stage >= MAX_STAGE) masteredPerLevel.set(p.lv, (masteredPerLevel.get(p.lv) ?? 0) + 1);
    }
    return { dueCount, playedPerLevel, masteredPerLevel };
  }, [progress, now]);

  const value: Store = {
    ready,
    error,
    manifest,
    progress,
    days,
    settings,
    now,
    today: dayKey(now),
    ...derived,
    recordAnswer,
    updateSettings,
    reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
