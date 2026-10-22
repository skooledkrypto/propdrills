import type { BarSessionInfo, Candle, Level, LevelCluster, LevelId, LevelSet } from './types';
import type { EngineConfig } from './config';
import { GLOBEX_OPEN_MIN, RTH_OPEN_MIN, overnightSessions, rthSessions } from './sessions';

function label(id: LevelId, price: number): Level {
  return { id, price, label: `${id} ${price.toFixed(price >= 1000 ? 0 : 2)}` };
}

/**
 * Compute the key-level set as it would have looked AT the anchor bar
 * (no lookahead: overnight high/low and VWAP only use bars up to anchorIdx).
 */
export interface PrecomputedSessions {
  rth: { key: number; from: number; to: number }[];
  on: { key: number; from: number; to: number }[];
}

export function computeLevels(
  bars: Candle[],
  info: BarSessionInfo[],
  anchorIdx: number,
  cfg: EngineConfig,
  pre?: PrecomputedSessions,
): LevelSet {
  const levels: Level[] = [];
  const anchor = bars[anchorIdx];

  // --- Prior RTH session: PDH / PDL / prior close ---
  const rth = pre?.rth ?? rthSessions(info);
  // Last RTH session that ENDED strictly before the anchor bar.
  let prior: { from: number; to: number } | null = null;
  for (const s of rth) {
    if (s.to < anchorIdx) prior = s;
    else break;
  }
  if (prior) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = prior.from; i <= prior.to; i++) {
      hi = Math.max(hi, bars[i].h);
      lo = Math.min(lo, bars[i].l);
    }
    levels.push(label('PDH', hi), label('PDL', lo), label('PC', bars[prior.to].c));
  }

  // --- Overnight so far: ONH / ONL ---
  const on = pre?.on ?? overnightSessions(info);
  let onRange: { from: number; to: number } | null = null;
  for (const s of on) {
    if (s.from <= anchorIdx) onRange = { from: s.from, to: Math.min(s.to, anchorIdx) };
    else break;
  }
  // Only meaningful if the anchor is inside it or in the RTH it leads into.
  if (onRange && anchorIdx - onRange.to <= 6.5 * 60 + 30) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = onRange.from; i <= onRange.to; i++) {
      hi = Math.max(hi, bars[i].h);
      lo = Math.min(lo, bars[i].l);
    }
    if (hi > -Infinity) levels.push(label('ONH', hi), label('ONL', lo));
  }

  // --- Round numbers (50s; 100-multiples get their own id) ---
  const base = Math.floor((anchor.c - cfg.roundWindow) / 50) * 50;
  for (let r = base; r <= anchor.c + cfg.roundWindow; r += 50) {
    if (Math.abs(r - anchor.c) > cfg.roundWindow) continue;
    levels.push(label(r % 100 === 0 ? 'R100' : 'R50', r));
  }

  // --- VWAP (anchored, no lookahead) ---
  const { value: vwap, series } = vwapAt(bars, info, anchorIdx, cfg.vwapAnchor);
  if (vwap !== null) levels.push(label('VWAP', vwap));

  // --- Recent swing pivots (secondary) ---
  for (const s of swingLevels(bars, anchorIdx, cfg)) levels.push(label('SWING', s));

  // --- Confluence clusters ---
  const clusters = clusterLevels(levels, cfg.confluenceTol);

  return { levels, clusters, vwap, vwapSeries: series };
}

/** Anchored VWAP up to and including barIdx. Returns null if no anchor found. */
export function vwapAt(
  bars: Candle[],
  info: BarSessionInfo[],
  barIdx: number,
  anchor: 'rth' | 'globex',
): { value: number | null; series: { t: number; value: number }[] } {
  const openMin = anchor === 'rth' ? RTH_OPEN_MIN : GLOBEX_OPEN_MIN;
  // Walk back to the most recent session open boundary.
  let start = -1;
  for (let i = barIdx; i >= 0; i--) {
    const m = info[i].etMinutes;
    const prevM = i > 0 ? info[i - 1].etMinutes : -1;
    if (m >= openMin && (prevM < openMin || prevM > m)) {
      start = i;
      break;
    }
    if (barIdx - i > 26 * 60) break; // > a full day back: give up
  }
  if (start < 0) return { value: null, series: [] };
  let pv = 0;
  let vol = 0;
  const series: { t: number; value: number }[] = [];
  for (let i = start; i <= barIdx; i++) {
    const b = bars[i];
    const tp = (b.h + b.l + b.c) / 3;
    const v = b.v > 0 ? b.v : 1; // synthetic data may carry zero volume
    pv += tp * v;
    vol += v;
    series.push({ t: b.t, value: pv / vol });
  }
  return { value: vol > 0 ? pv / vol : null, series };
}

/** Most recent significant swing pivots before the anchor (secondary levels). */
export function swingLevels(bars: Candle[], anchorIdx: number, cfg: EngineConfig): number[] {
  const k = cfg.swingStrength;
  const from = Math.max(k, anchorIdx - cfg.swingLookback);
  const out: number[] = [];
  for (let i = anchorIdx - k - 1; i >= from; i--) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i || j < 0 || j > anchorIdx) continue;
      if (bars[j].h >= bars[i].h) isHigh = false;
      if (bars[j].l <= bars[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push(bars[i].h);
    if (isLow) out.push(bars[i].l);
    if (out.length >= 4) break;
  }
  return out;
}

export function clusterLevels(levels: Level[], tol: number): LevelCluster[] {
  const sorted = levels
    .filter((l) => l.id !== 'SWING') // swings are secondary; don't let them mint clusters alone
    .slice()
    .sort((a, b) => a.price - b.price);
  const clusters: LevelCluster[] = [];
  let group: Level[] = [];
  const flush = () => {
    if (group.length >= 2) {
      clusters.push({
        price: group.reduce((s, l) => s + l.price, 0) / group.length,
        members: group.map((l) => l.id),
      });
    }
    group = [];
  };
  for (const l of sorted) {
    // span-limited: a cluster is a zone at most `tol` wide, not an open-ended chain
    if (!group.length || l.price - group[0].price <= tol) group.push(l);
    else {
      flush();
      group = [l];
    }
  }
  flush();
  return clusters;
}

/** Nearest level to a price, or null if none within `tol`. */
export function nearestLevel(set: LevelSet, price: number, tol: number): Level | null {
  let best: Level | null = null;
  let bestD = Infinity;
  for (const l of set.levels) {
    const d = Math.abs(l.price - price);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best && bestD <= tol ? best : null;
}

export function isConfluent(set: LevelSet, price: number, tol: number): boolean {
  return set.clusters.some((c) => Math.abs(c.price - price) <= tol);
}

/**
 * Primary levels for the level-marking drill: the ones the routine says to mark
 * before every session. Deduped within tolerance (confluent duplicates collapse).
 */
export function primaryLevels(set: LevelSet, tol: number): Level[] {
  const wanted: LevelId[] = ['PDH', 'PDL', 'PC', 'ONH', 'ONL'];
  const picked: Level[] = [];
  for (const id of wanted) {
    const l = set.levels.find((x) => x.id === id);
    if (!l) continue;
    if (picked.some((p) => Math.abs(p.price - l.price) <= tol)) continue;
    picked.push(l);
  }
  return picked;
}
