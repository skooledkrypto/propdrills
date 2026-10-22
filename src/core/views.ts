import { toET } from './sessions';
import type { Candle } from './types';

/**
 * Zoom presets shared by the levels drill and the challenge analysis view:
 * how far back the chart looks and the candle timeframe used to keep the bar
 * count drawable. Wide is the default — you can't mark the prior day's high
 * from a 3-hour peephole.
 */
export const VIEWS = [
  { key: '4h', label: '4h · 1m', mins: 240, agg: 1 },
  { key: '12h', label: '12h · 5m', mins: 720, agg: 5 },
  { key: '2d', label: '2d · 15m', mins: 2880, agg: 15 },
] as const;

export type ViewSpec = { mins: number; agg: number };

/**
 * Timeframe that keeps a continuously-zoomed span drawable (~≤ 300 candles).
 * Used by the challenge, where pinch zoom changes the span smoothly and the
 * aggregation follows.
 */
export function aggForSpan(mins: number): number {
  if (mins <= 300) return 1;
  if (mins <= 1500) return 5;
  if (mins <= 4200) return 15;
  return 30;
}

/**
 * Slice `mins` 1-min bars ending at idx and roll them up to `agg`-min candles.
 * Buckets are formed from the WALL CLOCK (ET day + minute-of-day ÷ agg), not
 * by counting bars, so candles stay aligned to :00/:05/:15… across the 17:00
 * halt, weekends, and any data gaps — and a 15m high/low always agrees with
 * the three 5m candles inside it.
 */
export function buildView(bars: Candle[], idx: number, v: ViewSpec): Candle[] {
  const start = Math.max(0, idx + 1 - v.mins);
  const slice = bars.slice(start, idx + 1);
  if (v.agg === 1) return slice;
  const out: Candle[] = [];
  let curKey: number | null = null;
  for (const b of slice) {
    const p = toET(b.t);
    const key = (p.y * 10000 + p.mo * 100 + p.d) * 10000 + Math.floor((p.hh * 60 + p.mm) / v.agg);
    const cur = out[out.length - 1];
    if (curKey === key && cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    } else {
      out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      curKey = key;
    }
  }
  return out;
}
