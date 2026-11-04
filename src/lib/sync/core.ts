/**
 * Sync core (pure, backend-agnostic).
 *
 * Remote layout — one sync space per code, made of small "chunk" documents:
 *   meta      { versions: {chunkId: version}, resetAt }
 *   p1 … p30  progress of one deck level: [[id, stage, due, correct, wrong, first, last], …]
 *   days      daily stats per device: { deviceId: [[date, points, correct, wrong, learned, reviewed], …] }
 *   settings  { updated, value }
 *
 * Merge rules
 *   progress  per sentence, the most recently answered record wins
 *   days      each device owns its own entry; totals are the sum over devices
 *   settings  the most recently changed copy wins (device-only settings are never taken from it)
 *   reset     "reset progress" stores resetAt; anything older is dropped everywhere
 *   level     "reset level" stores levelResets[chunk]; older answers in that level are dropped
 */
import type { DayStat } from '../scoring';
import { deviceSettings, type Settings } from '../settings';
import type { Progress } from '../srs';

export const FORMAT = 1;

export interface Chunk {
  v: number;
  data: string;
  updated: number;
}

export interface RemoteTx {
  get(id: string): Promise<Chunk | null>;
  set(id: string, chunk: Chunk): void;
}

interface Meta {
  versions: Record<string, number>;
  resetAt: number;
  /** "Reset level": progress chunk id → time; answers in that level from before it are dropped everywhere */
  levelResets?: Record<string, number>;
}

export interface LocalState {
  deviceId: string;
  /** deck version (manifest.version) */
  deck?: number;
  levels: number[];
  progress: Progress[];
  ownDays: DayStat[];
  otherDays: Record<string, DayStat[]>;
  settings: Settings;
  settingsUpdated: number;
  resetAt: number;
  /** level resets this device knows about (progress chunk id → time) */
  levelResets?: Record<string, number>;
  lastSeen: Record<string, number>;
  dirty: string[];
}

export interface SyncResult {
  progressPut: Progress[];
  progressDelete: number[];
  /** replacement for this device's own days (only after a reset elsewhere) */
  ownDays: DayStat[] | null;
  otherDays: Record<string, DayStat[]>;
  /** newer settings from another device */
  settings: { value: Settings; updated: number } | null;
  resetAt: number;
  /** every level reset known after this sync (progress chunk id → time) */
  levelResets: Record<string, number>;
  /** per level of the current deck: answers from before this time were reset (delete them) */
  dropBefore: Record<number, number>;
  lastSeen: Record<string, number>;
  wrote: string[];
}

/** Progress chunk id; from deck v2 on the id carries the deck version, so levels of different decks never mix. */
export const progressChunk = (lv: number, deck = 1) => (deck > 1 ? `v${deck}p${lv}` : `p${lv}`);

/* ---------- encoding (canonical, so equal data gives equal strings) ---------- */

type PRow = [number, number, number, number, number, number, number] | [number, number, number, number, number, number, number, 1];

export function encodeProgress(list: Progress[]): string {
  const rows: PRow[] = [...list]
    .sort((a, b) => a.id - b.id)
    .map((p): PRow => (p.known ? [p.id, p.stage, p.due, p.correct, p.wrong, p.first, p.last, 1] : [p.id, p.stage, p.due, p.correct, p.wrong, p.first, p.last]));
  return JSON.stringify(rows);
}

export function decodeProgress(data: string, lv: number): Progress[] {
  return (JSON.parse(data) as PRow[]).map(([id, stage, due, correct, wrong, first, last, known]) => ({
    id,
    lv,
    stage,
    due,
    correct,
    wrong,
    first,
    last,
    ...(known ? { known: true } : {}),
  }));
}

type DRow = [string, number, number, number, number, number];

export function encodeDays(byDevice: Record<string, DayStat[]>): string {
  const out: Record<string, DRow[]> = {};
  for (const dev of Object.keys(byDevice).sort()) {
    const rows = [...byDevice[dev]]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d): DRow => [d.date, d.points, d.correct, d.wrong, d.learned, d.reviewed]);
    if (rows.length) out[dev] = rows;
  }
  return JSON.stringify(out);
}

export function decodeDays(data: string): Record<string, DayStat[]> {
  const raw = JSON.parse(data) as Record<string, DRow[]>;
  const out: Record<string, DayStat[]> = {};
  for (const [dev, rows] of Object.entries(raw)) {
    out[dev] = rows.map(([date, points, correct, wrong, learned, reviewed]) => ({ date, points, correct, wrong, learned, reviewed }));
  }
  return out;
}

/* ---------- merging ---------- */

/** True if `a` should replace `b` (a is the more recent answer). */
export function newer(a: Progress, b: Progress): boolean {
  if (a.last !== b.last) return a.last > b.last;
  const na = a.correct + a.wrong;
  const nb = b.correct + b.wrong;
  if (na !== nb) return na > nb;
  return a.stage > b.stage;
}

export function sameProgress(a: Progress, b: Progress): boolean {
  return (
    a.id === b.id && a.stage === b.stage && a.due === b.due && a.correct === b.correct && a.wrong === b.wrong && a.first === b.first && a.last === b.last && !!a.known === !!b.known
  );
}

export function mergeProgress(local: Progress[], remote: Progress[], resetAt: number): Progress[] {
  const out = new Map<number, Progress>();
  for (const p of [...local, ...remote]) {
    if (p.last < resetAt) continue;
    const cur = out.get(p.id);
    if (!cur || newer(p, cur)) out.set(p.id, { ...p, first: cur ? Math.min(cur.first, p.first) : p.first });
    else if (p.first < cur.first) out.set(p.id, { ...cur, first: p.first });
  }
  return [...out.values()];
}

/** Sum daily stats over devices. */
export function sumDays(lists: DayStat[][]): DayStat[] {
  const by = new Map<string, DayStat>();
  for (const list of lists) {
    for (const d of list) {
      const cur = by.get(d.date);
      if (!cur) by.set(d.date, { ...d });
      else {
        cur.points += d.points;
        cur.correct += d.correct;
        cur.wrong += d.wrong;
        cur.learned += d.learned;
        cur.reviewed += d.reviewed;
      }
    }
  }
  return [...by.values()];
}

/* ---------- one sync pass (runs inside a remote transaction; must not mutate `local`) ---------- */

export async function syncOnce(local: LocalState, tx: RemoteTx, now: number): Promise<SyncResult> {
  const metaChunk = await tx.get('meta');
  const meta: Meta = metaChunk ? JSON.parse(metaChunk.data) : { versions: {}, resetAt: 0 };
  const resetAt = Math.max(meta.resetAt ?? 0, local.resetAt);
  const remoteReset = (meta.resetAt ?? 0) > local.resetAt;
  const localReset = local.resetAt > (meta.resetAt ?? 0);

  // level resets: newest per level wins (kept on each device too, so a device on an older
  // version that rewrites meta without them can't bring the old answers back for good)
  const remoteLR = meta.levelResets ?? {};
  const localLR = local.levelResets ?? {};
  const levelResets: Record<string, number> = { ...remoteLR };
  for (const [c, t] of Object.entries(localLR)) if (t > (levelResets[c] ?? 0)) levelResets[c] = t;
  const levelResetDiffers = (c: string) => (localLR[c] ?? 0) !== (remoteLR[c] ?? 0);
  const metaMissesLevelResets = Object.entries(levelResets).some(([c, t]) => (remoteLR[c] ?? 0) !== t);

  const progressIds = local.levels.map((lv) => progressChunk(lv, local.deck));
  const all = [...progressIds, 'days', 'settings'];
  const dirty = new Set(local.dirty);
  const changedRemotely = (c: string) => (meta.versions[c] ?? 0) !== (local.lastSeen[c] ?? 0);
  const toRead = all.filter((c) => remoteReset || localReset || dirty.has(c) || changedRemotely(c) || levelResetDiffers(c));

  // all reads first (transaction rule)
  const chunks = await Promise.all(toRead.map((c) => tx.get(c)));
  const remote = new Map(toRead.map((c, i) => [c, chunks[i]]));

  const result: SyncResult = {
    progressPut: [],
    progressDelete: [],
    ownDays: null,
    otherDays: local.otherDays,
    settings: null,
    resetAt,
    levelResets,
    dropBefore: {},
    lastSeen: { ...meta.versions },
    wrote: [],
  };
  const writes: [string, string][] = [];

  // progress, level by level
  const byLevel = new Map<number, Progress[]>();
  for (const p of local.progress) {
    const list = byLevel.get(p.lv);
    if (list) list.push(p);
    else byLevel.set(p.lv, [p]);
  }
  for (const lv of local.levels) {
    const id = progressChunk(lv, local.deck);
    const before = Math.max(resetAt, levelResets[id] ?? 0);
    if (before > resetAt) result.dropBefore[lv] = before;
    if (!remote.has(id)) continue;
    const mine = byLevel.get(lv) ?? [];
    const theirsChunk = remote.get(id) ?? null;
    const theirs = theirsChunk ? decodeProgress(theirsChunk.data, lv) : [];
    const merged = mergeProgress(mine, theirs, before);
    const mineById = new Map(mine.map((p) => [p.id, p]));
    const mergedIds = new Set<number>();
    for (const p of merged) {
      mergedIds.add(p.id);
      const m = mineById.get(p.id);
      if (!m || !sameProgress(m, p)) result.progressPut.push(p);
    }
    for (const m of mine) if (!mergedIds.has(m.id)) result.progressDelete.push(m.id);
    const enc = encodeProgress(merged);
    if (theirsChunk ? theirsChunk.data !== enc : merged.length > 0 || localReset) writes.push([id, enc]);
  }

  // daily stats
  if (remote.has('days')) {
    const theirsChunk = remote.get('days') ?? null;
    const theirs = theirsChunk ? decodeDays(theirsChunk.data) : {};
    let own = local.ownDays;
    if (remoteReset) {
      own = [];
      result.ownDays = [];
    }
    const others: Record<string, DayStat[]> = {};
    if (!localReset) for (const [dev, list] of Object.entries(theirs)) if (dev !== local.deviceId) others[dev] = list;
    result.otherDays = others;
    const enc = encodeDays({ ...others, [local.deviceId]: own });
    if (theirsChunk ? theirsChunk.data !== enc : own.length > 0 || localReset) writes.push(['days', enc]);
  } else if (remoteReset) {
    result.ownDays = [];
    result.otherDays = {};
  }

  // settings (device-only ones — voice, theme, auto-save — are never taken from another device)
  if (remote.has('settings')) {
    const theirsChunk = remote.get('settings') ?? null;
    const theirs = theirsChunk ? (JSON.parse(theirsChunk.data) as { updated: number; value: Settings }) : null;
    if (theirs && theirs.updated > local.settingsUpdated) {
      result.settings = { updated: theirs.updated, value: { ...theirs.value, ...deviceSettings(local.settings) } };
    } else if (!theirs || local.settingsUpdated > theirs.updated) {
      // still uploaded in full, so devices on an older version don't reset their own voice/theme
      writes.push(['settings', JSON.stringify({ updated: local.settingsUpdated, value: local.settings })]);
    }
  }

  // write changed chunks and the new versions
  if (writes.length || localReset || metaMissesLevelResets) {
    const versions = { ...meta.versions };
    for (const [id, data] of writes) {
      const ver = Math.max(now, (versions[id] ?? 0) + 1);
      versions[id] = ver;
      tx.set(id, { v: FORMAT, data, updated: ver });
      result.wrote.push(id);
    }
    tx.set('meta', { v: FORMAT, data: JSON.stringify({ versions, resetAt, levelResets } satisfies Meta), updated: now });
    result.lastSeen = versions;
  }
  return result;
}

export const allChunkIds = (levels: number[], deck = 1) => [...levels.map((lv) => progressChunk(lv, deck)), 'days', 'settings'];

/** Apply a sync result to a local snapshot (pure; the app applies the same changes to IndexedDB). */
export function applyResult(local: LocalState, r: SyncResult, synced: string[]): LocalState {
  const map = new Map(local.progress.map((p) => [p.id, p]));
  for (const id of r.progressDelete) map.delete(id);
  for (const p of r.progressPut) {
    const cur = map.get(p.id);
    if (!cur || !newer(cur, p)) map.set(p.id, p);
  }
  return {
    ...local,
    progress: [...map.values()],
    ownDays: r.ownDays ?? local.ownDays,
    otherDays: r.otherDays,
    settings: r.settings ? r.settings.value : local.settings,
    settingsUpdated: r.settings ? r.settings.updated : local.settingsUpdated,
    resetAt: r.resetAt,
    levelResets: r.levelResets,
    lastSeen: r.lastSeen,
    dirty: local.dirty.filter((c) => !synced.includes(c)),
  };
}
