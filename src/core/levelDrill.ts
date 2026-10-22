import type { Level, LevelId } from './types';

/**
 * Level-marking drill round logic: the drill hands the trader named slots
 * (PDH, PDL, …) to place deliberately, one at a time, instead of anonymous
 * marks. Pure so web and mobile score identically.
 */

/** Plain-language names for the levels the pre-session routine marks. */
export const LEVEL_FULL_NAMES: Partial<Record<LevelId, string>> = {
  PDH: 'Prior-day high',
  PDL: 'Prior-day low',
  PC: 'Prior-day close',
  ONH: 'Overnight high',
  ONL: 'Overnight low',
};

export function levelFullName(id: LevelId): string {
  return LEVEL_FULL_NAMES[id] ?? id;
}

export interface SlotScore {
  placed: boolean;
  hit: boolean;
  /** |mark − target| in points; null when the slot was never placed. */
  off: number | null;
}

/**
 * Score deliberate placements: prices[i] is where the trader put targets[i]
 * (null = never placed, which counts as a miss).
 */
export function scoreSlots(
  targets: Level[],
  prices: (number | null)[],
  tol: number,
): { hits: number; results: SlotScore[] } {
  const results = targets.map((t, i): SlotScore => {
    const p = prices[i];
    if (p === null || p === undefined) return { placed: false, hit: false, off: null };
    const off = Math.abs(t.price - p);
    return { placed: true, hit: off <= tol, off };
  });
  return { hits: results.filter((r) => r.hit).length, results };
}

/**
 * Explains drill levels that are absent from the round's targets because they
 * sit on top of another level today (primaryLevels collapses confluent
 * duplicates). One note per merged level, e.g. "ONH sits on PDH today".
 */
export function mergedLevelNotes(
  allLevels: Level[],
  targets: Level[],
  tol: number,
): string[] {
  const notes: string[] = [];
  for (const id of Object.keys(LEVEL_FULL_NAMES) as LevelId[]) {
    if (targets.some((t) => t.id === id)) continue;
    const lv = allLevels.find((l) => l.id === id);
    if (!lv) continue;
    const host = targets.find((t) => Math.abs(t.price - lv.price) <= tol);
    if (host) notes.push(`${id} sits on ${host.id} today — one line covers both`);
  }
  return notes;
}

/** The next slot to arm after a placement: first unplaced one, else null. */
export function nextUnplaced(prices: (number | null)[], from: number): number | null {
  for (let step = 1; step <= prices.length; step++) {
    const i = (from + step) % prices.length;
    if (prices[i] === null) return i;
  }
  return null;
}
