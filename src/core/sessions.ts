import type { BarSessionInfo, Candle, SessionTag } from './types';

/**
 * Session math for CME equity-index futures, DST-safe via Intl.
 *
 *   RTH:          09:30–16:00 ET
 *   post-RTH:     16:00–17:00 ET (still tradeable)
 *   maintenance:  17:00–18:00 ET (no bars expected)
 *   overnight:    18:00 ET reopen -> next day 09:30 ET
 *
 * All timestamps are UTC epoch ms; we only ever *render* in ET/PT.
 */

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export interface ETParts {
  y: number;
  mo: number;
  d: number;
  hh: number;
  mm: number;
}

const etCache = new Map<number, ETParts>();

export function toET(utcMs: number): ETParts {
  // Bars land on minute boundaries; cache by minute to make full-dataset scans cheap.
  const key = Math.floor(utcMs / 60000);
  const hit = etCache.get(key);
  if (hit) return hit;
  const parts = etFormatter.formatToParts(utcMs);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const res: ETParts = {
    y: get('year'),
    mo: get('month'),
    d: get('day'),
    hh: get('hour') % 24, // Intl can emit "24" for midnight
    mm: get('minute'),
  };
  if (etCache.size > 600000) etCache.clear();
  etCache.set(key, res);
  return res;
}

export function etDateNum(p: ETParts): number {
  return p.y * 10000 + p.mo * 100 + p.d;
}

/** Previous calendar date (yyyymmdd) — safe across month/year boundaries. */
export function prevDateNum(dateNum: number): number {
  const y = Math.floor(dateNum / 10000);
  const mo = Math.floor((dateNum % 10000) / 100);
  const d = dateNum % 100;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

export const RTH_OPEN_MIN = 9 * 60 + 30;
export const RTH_CLOSE_MIN = 16 * 60;
export const MAINT_START_MIN = 17 * 60;
export const GLOBEX_OPEN_MIN = 18 * 60;

export function classify(etMinutes: number): SessionTag {
  if (etMinutes >= RTH_OPEN_MIN && etMinutes < RTH_CLOSE_MIN) return 'rth';
  if (etMinutes >= RTH_CLOSE_MIN && etMinutes < MAINT_START_MIN) return 'postrth';
  if (etMinutes >= MAINT_START_MIN && etMinutes < GLOBEX_OPEN_MIN) return 'maintenance';
  return 'overnight';
}

/** Per-bar session info for a whole series. O(n), computed once per dataset. */
export function sessionInfo(bars: Candle[]): BarSessionInfo[] {
  return bars.map((b) => {
    const p = toET(b.t);
    const etMinutes = p.hh * 60 + p.mm;
    const etDate = etDateNum(p);
    const tag = classify(etMinutes);
    // Overnight session key = the ET date of its 18:00 open.
    let overnightKey = 0;
    if (tag === 'overnight') {
      overnightKey = etMinutes >= GLOBEX_OPEN_MIN ? etDate : prevDateNum(etDate);
    }
    const rthKey = tag === 'rth' ? etDate : 0;
    return { etMinutes, etDate, tag, overnightKey, rthKey };
  });
}

export interface SessionRange {
  key: number;
  from: number;
  to: number; // inclusive bar indexes
}

/** Contiguous RTH sessions as index ranges, in time order. */
export function rthSessions(info: BarSessionInfo[]): SessionRange[] {
  const out: SessionRange[] = [];
  for (let i = 0; i < info.length; i++) {
    if (info[i].tag !== 'rth') continue;
    const key = info[i].rthKey;
    if (out.length && out[out.length - 1].key === key) out[out.length - 1].to = i;
    else out.push({ key, from: i, to: i });
  }
  return out;
}

/** Overnight sessions (18:00 ET -> next 09:30 ET) as index ranges. */
export function overnightSessions(info: BarSessionInfo[]): SessionRange[] {
  const out: SessionRange[] = [];
  for (let i = 0; i < info.length; i++) {
    if (info[i].tag !== 'overnight') continue;
    const key = info[i].overnightKey;
    if (out.length && out[out.length - 1].key === key) out[out.length - 1].to = i;
    else out.push({ key, from: i, to: i });
  }
  return out;
}

/**
 * Does the bar at `idx` pass the user's session filter?
 * 'evening' = first `eveningHours` hours after the 18:00 ET reopen.
 */
export function passesSessionFilter(
  info: BarSessionInfo[],
  idx: number,
  filter: 'any' | 'rth' | 'evening' | 'overnight',
  eveningHours: number,
): boolean {
  const bi = info[idx];
  switch (filter) {
    case 'any':
      return bi.tag !== 'maintenance';
    case 'rth':
      return bi.tag === 'rth';
    case 'overnight':
      return bi.tag === 'overnight';
    case 'evening': {
      if (bi.tag !== 'overnight') return false;
      const sinceOpen =
        bi.etMinutes >= GLOBEX_OPEN_MIN
          ? bi.etMinutes - GLOBEX_OPEN_MIN
          : bi.etMinutes + 24 * 60 - GLOBEX_OPEN_MIN;
      return sinceOpen < eveningHours * 60;
    }
  }
}
