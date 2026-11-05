import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { levelIndex, loadManifest, type Item, type Manifest } from './lib/deck';
import { getKv, loadAll, migrateProgress, resetLevel as resetLevelDb, saveAnswer, saveFavorite, saveProgress, saveSettings, setKv } from './lib/db';
import { defaultPinned, homeLevels as homeLevelsOf, levelStats as levelStatsOf, withPinned, type LevelStat } from './lib/levels';
import { currentLevel as currentLevelOf } from './lib/session';
import { dayKey, emptyDay, withGoalChange, type DayStat } from './lib/scoring';
import { isDue, isMastered, markKnown, newProgress, review, unmarkKnown, type Progress } from './lib/srs';
import { DEFAULT_SETTINGS, deviceSettings, onlyDeviceSettings, type Settings } from './lib/settings';
import { piper } from './lib/audio';
import { allChunkIds, mergeFavorites, newer, progressChunk, sumDays, type Favorites } from './lib/sync/core';
import { favoriteIds as favoriteIdsOf, isOftenMissed } from './lib/lists';
import { initSync, markDirty, onSyncApplied } from './lib/sync/engine';
import { afterFirstScreen, mark } from './lib/startup';

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
  /** per-level numbers for the level cards */
  levelStats: Map<number, LevelStat>;
  /** the level you are on (Home "Play" continues here) */
  currentLevel: number;
  /** levels shown on Home, in level order */
  homeLevels: number[];
  /** show or hide levels on Home */
  pinLevels(levels: number[], on: boolean): void;
  /** "Reset level": delete the progress of every sentence in the level (on all synced devices). Returns how many. */
  resetLevel(lv: number): Promise<number>;
  /** favourite sentences (with when they changed, for sync) */
  favorites: Favorites;
  favoriteIds: Set<number>;
  toggleFavorite(id: number, lv: number): void;
  /** how many sentences are in "Often missed" */
  missedCount: number;
  /**
   * Record an answer. The new state is returned right away; `saved` settles when it is
   * stored on the device (the card never waits for it).
   */
  recordAnswer(a: AnswerInput): { before: Progress | null; after: Progress | null; saved: Promise<void> };
  /**
   * Mark a played sentence as known (never reviewed) or put it back into reviews.
   * `restore` brings back an earlier state (undo right after marking).
   */
  setKnown(id: number, known: boolean, restore?: Progress | null): Promise<Progress | null>;
  updateSettings(patch: Partial<Settings>): void;
  reload(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

/** Entries of `a` that are newer than in `b` (so a reset made during a sync isn't forgotten). */
function newerResets(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(a).filter(([c, t]) => t > (b[c] ?? 0)));
}

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
  /** this device's daily stats; `days` below adds the other synced devices */
  const [ownDays, setOwnDays] = useState<Map<string, DayStat>>(new Map());
  const [otherDays, setOtherDays] = useState<Record<string, DayStat[]>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [favorites, setFavorites] = useState<Favorites>({});
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;
  const [now, setNow] = useState(() => Date.now());
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const daysRef = useRef(ownDays);
  daysRef.current = ownDays;
  const deckVersionRef = useRef(1);
  /** "Reset level" times known on this device (progress chunk id → ms) */
  const levelResetsRef = useRef<Record<string, number>>({});
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const reload = useCallback(async () => {
    try {
      let [m, data] = await Promise.all([
        loadManifest().then((x) => (mark('sentences'), x)),
        loadAll().then((x) => (mark('progress'), x)),
      ]);
      // deck updated since last time: re-file progress under the new levels (one time)
      const seen = (await getKv<number>('deckVersion')) ?? 1;
      if (seen !== m.version) {
        if (data.progress.length) {
          await migrateProgress(await levelIndex());
          data = await loadAll();
          markDirty(allChunkIds(m.levels.map((l) => l.n), m.version));
        }
        await setKv('deckVersion', m.version);
      }
      deckVersionRef.current = m.version;
      levelResetsRef.current = data.levelResets;
      setManifest(m);
      setProgress(new Map(data.progress.map((p) => [p.id, p])));
      setOwnDays(new Map(data.days.map((d) => [d.date, d])));
      setOtherDays(data.otherDays);
      setSettings(data.settings);
      setFavorites(data.favorites);
      setReady(true);
      // not needed for the first screen: check the voice once it is up
      afterFirstScreen(() => piper.check(data.settings.voice).then(() => mark('voice')));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload().then(() => afterFirstScreen(() => initSync(), 900));
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [reload]);

  // follow changes that a sync brought in from other devices
  useEffect(
    () =>
      onSyncApplied((r) => {
        if (r.progressPut.length || r.progressDelete.length) {
          const p = new Map(progressRef.current);
          for (const id of r.progressDelete) {
            const cur = p.get(id);
            if (cur && cur.last < Math.max(r.resetAt, r.dropBefore[cur.lv] ?? 0)) p.delete(id);
          }
          for (const x of r.progressPut) {
            const cur = p.get(x.id);
            if (x.last < (levelResetsRef.current[progressChunk(x.lv, deckVersionRef.current)] ?? 0)) continue; // reset meanwhile
            if (!cur || !newer(cur, x)) p.set(x.id, x);
          }
          progressRef.current = p;
          setProgress(p);
        }
        levelResetsRef.current = { ...r.levelResets, ...newerResets(levelResetsRef.current, r.levelResets) };
        if (r.ownDays) {
          const ds = new Map(r.ownDays.map((d) => [d.date, d]));
          daysRef.current = ds;
          setOwnDays(ds);
        }
        setOtherDays(r.otherDays);
        if (r.favorites) {
          const f = mergeFavorites(favoritesRef.current, r.favorites);
          favoritesRef.current = f;
          setFavorites(f);
        }
        if (r.settings) {
          const next = { ...DEFAULT_SETTINGS, ...r.settings.value, ...deviceSettings(settingsRef.current) };
          settingsRef.current = next;
          setSettings(next);
        }
        setNow(Date.now());
      }),
    [],
  );

  // theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const recordAnswer = useCallback((a: AnswerInput) => {
    if (a.retry) return { before: progressRef.current.get(a.item.id) ?? null, after: null, saved: Promise.resolve() };
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
    setOwnDays(ds);
    setNow(t);
    const saved = saveAnswer(after, day).then(() => markDirty([progressChunk(after.lv, deckVersionRef.current), 'days']));
    return { before, after, saved };
  }, []);

  const setKnown = useCallback(async (id: number, known: boolean, restore?: Progress | null) => {
    const cur = progressRef.current.get(id);
    if (!cur) return null;
    const t = Date.now();
    // back into reviews: the exact earlier record (undo), else due now at its own stage
    const next = known ? markKnown(cur, t) : restore ? { ...unmarkKnown(restore, t), due: restore.due } : unmarkKnown(cur, t);
    const p = new Map(progressRef.current).set(id, next);
    progressRef.current = p;
    setProgress(p);
    setNow(t);
    await saveProgress(next);
    markDirty([progressChunk(next.lv, deckVersionRef.current)]);
    return next;
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const cur = settingsRef.current;
    if (patch.dailyGoal !== undefined && patch.dailyGoal !== cur.dailyGoal) {
      patch = { ...patch, goalHistory: withGoalChange(cur.goalHistory, cur.dailyGoal, patch.dailyGoal, dayKey(Date.now())) };
    }
    const next = { ...cur, ...patch };
    settingsRef.current = next;
    setSettings(next);
    // voice, theme and auto-save stay on this device: nothing to sync
    if (onlyDeviceSettings(patch)) saveSettings(next).catch(() => {});
    else saveSettings(next, Date.now()).then(() => markDirty(['settings']), () => {});
  }, []);

  const resetLevel = useCallback(async (lv: number) => {
    const chunk = progressChunk(lv, deckVersionRef.current);
    const t = Date.now();
    const p = new Map(progressRef.current);
    for (const [id, x] of p) if (x.lv === lv) p.delete(id);
    progressRef.current = p;
    levelResetsRef.current = { ...levelResetsRef.current, [chunk]: t };
    setProgress(p);
    setNow(t);
    const removed = await resetLevelDb(lv, chunk, t);
    markDirty([chunk]);
    return removed;
  }, []);

  const toggleFavorite = useCallback((id: number, lv: number) => {
    const on = favoritesRef.current[id]?.[0] !== 1;
    const t = Date.now();
    const f: Favorites = { ...favoritesRef.current, [id]: [on ? 1 : 0, t, lv] };
    favoritesRef.current = f;
    setFavorites(f);
    saveFavorite(id, on, lv, t).then(() => markDirty(['favs']), () => {});
  }, []);
  const favoriteIds = useMemo(() => favoriteIdsOf(favorites), [favorites]);

  const days = useMemo(() => {
    const all = sumDays([[...ownDays.values()], ...Object.values(otherDays)]);
    return new Map(all.map((d) => [d.date, d]));
  }, [ownDays, otherDays]);

  const derived = useMemo(() => {
    let dueCount = 0;
    let missedCount = 0;
    const playedPerLevel = new Map<number, number>();
    const masteredPerLevel = new Map<number, number>();
    for (const p of progress.values()) {
      if (isDue(p, now)) dueCount++;
      if (isOftenMissed(p)) missedCount++;
      playedPerLevel.set(p.lv, (playedPerLevel.get(p.lv) ?? 0) + 1);
      if (isMastered(p)) masteredPerLevel.set(p.lv, (masteredPerLevel.get(p.lv) ?? 0) + 1);
    }
    return { dueCount, missedCount, playedPerLevel, masteredPerLevel, levelStats: levelStatsOf(progress.values(), now) };
  }, [progress, now]);

  const levelCount = manifest?.levels.length ?? 0;
  const current = manifest ? currentLevelOf(derived.playedPerLevel, manifest.levels, settings.currentLevel) : 1;
  const homeLevels = useMemo(
    () => homeLevelsOf(settings.pinnedLevels, derived.levelStats, current, levelCount),
    [settings.pinnedLevels, derived.levelStats, current, levelCount],
  );
  const fallbackPinned = useRef<number[]>([]);
  fallbackPinned.current = defaultPinned(derived.levelStats, current);
  const pinLevels = useCallback(
    (levels: number[], on: boolean) => {
      const next = withPinned(settingsRef.current.pinnedLevels, fallbackPinned.current, levels, on);
      if (next) updateSettings({ pinnedLevels: next });
    },
    [updateSettings],
  );

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
    setKnown,
    updateSettings,
    currentLevel: current,
    homeLevels,
    pinLevels,
    resetLevel,
    favorites,
    favoriteIds,
    toggleFavorite,
    reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
