import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Attempt,
  BarsetMeta,
  Candle,
  DrillInstance,
  LabelFlag,
  Progress,
} from '../core/types';
import type { EngineConfig } from '../core/config';

/**
 * All user data stays on-device (brief §11): bars, drill library, progress,
 * attempts, flags, settings — IndexedDB only, no network, no accounts.
 */

interface DrillDB extends DBSchema {
  bars: { key: number; value: Candle };
  barsetMeta: { key: string; value: BarsetMeta };
  library: {
    key: string;
    value: DrillInstance;
    indexes: { byPattern: string };
  };
  attempts: { key: number; value: Attempt & { id?: number } };
  flags: { key: string; value: LabelFlag };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<DrillDB>> | null = null;

function db(): Promise<IDBPDatabase<DrillDB>> {
  if (!dbPromise) {
    // DB name predates the PropDrills rebrand; renaming it would orphan
    // existing imported bars and progress in users' browsers.
    dbPromise = openDB<DrillDB>('drillmafia', 1, {
      upgrade(d) {
        d.createObjectStore('bars', { keyPath: 't' });
        d.createObjectStore('barsetMeta', { keyPath: 'id' });
        const lib = d.createObjectStore('library', { keyPath: 'id' });
        lib.createIndex('byPattern', 'patternId');
        d.createObjectStore('attempts', { autoIncrement: true });
        d.createObjectStore('flags', { keyPath: 'instanceId' });
        d.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

/* ---------- bars ---------- */

export async function replaceBars(bars: Candle[], meta: Omit<BarsetMeta, 'id'>): Promise<void> {
  const d = await db();
  const tx = d.transaction(['bars', 'barsetMeta'], 'readwrite');
  await tx.objectStore('bars').clear();
  const store = tx.objectStore('bars');
  for (const b of bars) void store.put(b);
  await tx.objectStore('barsetMeta').clear();
  void tx.objectStore('barsetMeta').put({ ...meta, id: 'active' });
  await tx.done;
}

export async function loadBars(): Promise<Candle[]> {
  const d = await db();
  return d.getAll('bars');
}

export async function getBarsetMeta(): Promise<BarsetMeta | undefined> {
  const d = await db();
  return d.get('barsetMeta', 'active');
}

/* ---------- drill library ---------- */

export async function replaceLibrary(instances: DrillInstance[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('library', 'readwrite');
  await tx.store.clear();
  for (const inst of instances) void tx.store.put(inst);
  await tx.done;
}

export async function libraryCounts(): Promise<Record<string, number>> {
  const d = await db();
  const all = await d.getAll('library');
  const counts: Record<string, number> = {};
  for (const inst of all) counts[inst.patternId] = (counts[inst.patternId] ?? 0) + 1;
  return counts;
}

export async function sampleInstance(
  patternId: string,
  opts: {
    exclude?: Set<string>;
    sessionFilter?: (inst: DrillInstance) => boolean;
    rng?: () => number;
  } = {},
): Promise<DrillInstance | null> {
  const d = await db();
  const all = await d.getAllFromIndex('library', 'byPattern', patternId);
  const flags = new Set((await d.getAllKeys('flags')) as string[]);
  let pool = all.filter((i) => !flags.has(i.id) && !(opts.exclude?.has(i.id) ?? false));
  if (opts.sessionFilter) {
    const filtered = pool.filter(opts.sessionFilter);
    if (filtered.length) pool = filtered; // fall back to any session rather than starving
  }
  if (!pool.length) return null;
  const R = opts.rng ?? Math.random;
  return pool[Math.floor(R() * pool.length)];
}

/* ---------- flags ---------- */

export async function flagInstance(flag: LabelFlag): Promise<void> {
  const d = await db();
  await d.put('flags', flag);
}

export async function flagCount(): Promise<number> {
  const d = await db();
  return d.count('flags');
}

/* ---------- attempts & progress ---------- */

export async function recordAttempt(a: Attempt): Promise<void> {
  const d = await db();
  await d.put('attempts', a);
}

export async function loadAttempts(): Promise<Attempt[]> {
  const d = await db();
  return d.getAll('attempts');
}

/** Backup import: replace the whole attempts log in one transaction. */
export async function replaceAttempts(attempts: Attempt[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('attempts', 'readwrite');
  await tx.store.clear();
  for (const a of attempts) void tx.store.put(a);
  await tx.done;
}

export async function saveProgress(p: Progress): Promise<void> {
  const d = await db();
  await d.put('kv', p, 'progress');
}

export async function loadProgress(): Promise<Progress> {
  const d = await db();
  const p = (await d.get('kv', 'progress')) as Progress | undefined;
  return p ?? { perPattern: {} };
}

/* ---------- settings ---------- */

export async function saveConfig(cfg: EngineConfig): Promise<void> {
  const d = await db();
  await d.put('kv', cfg, 'config');
}

export async function loadConfig(): Promise<Partial<EngineConfig> | null> {
  const d = await db();
  return ((await d.get('kv', 'config')) as EngineConfig | undefined) ?? null;
}

/* ---------- danger zone ---------- */

export async function wipeProgress(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['attempts', 'kv'], 'readwrite');
  await tx.objectStore('attempts').clear();
  await tx.objectStore('kv').delete('progress');
  await tx.done;
}

export async function wipeData(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['bars', 'barsetMeta', 'library', 'flags'], 'readwrite');
  await tx.objectStore('bars').clear();
  await tx.objectStore('barsetMeta').clear();
  await tx.objectStore('library').clear();
  await tx.objectStore('flags').clear();
  await tx.done;
}
