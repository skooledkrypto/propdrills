import { describe, expect, it } from 'vitest';
import { clusterLevels, computeLevels, nearestLevel, primaryLevels } from '../levels';
import { sessionInfo } from '../sessions';
import { wallClockToUtc } from '../csv';
import { DEFAULT_CONFIG } from '../config';
import type { Candle } from '../types';

const ET = 'America/New_York';

/** Fixture: Mon 2026-06-01 RTH (PDH 21560 / PDL 21500 / PC 21530), then overnight. */
function fixture(): Candle[] {
  const bars: Candle[] = [];
  const push = (h: number, m: number, o: number, hi: number, lo: number, c: number) =>
    bars.push({ t: wallClockToUtc(ET, 2026, 6, 1, h, m), o, h: hi, l: lo, c, v: 100 });
  // RTH 09:30–15:59
  for (let i = 0; i < 390; i++) {
    const hh = Math.floor((570 + i) / 60);
    const mm = (570 + i) % 60;
    if (i === 100) push(hh, mm, 21550, 21560, 21545, 21548); // session high
    else if (i === 200) push(hh, mm, 21510, 21512, 21500, 21505); // session low
    else if (i === 389) push(hh, mm, 21528, 21532, 21526, 21530); // close
    else push(hh, mm, 21520, 21522, 21518, 21520);
  }
  // Overnight 18:00–20:00
  for (let i = 0; i <= 120; i++) {
    const total = 18 * 60 + i;
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    if (i === 30) push(hh, mm, 21535, 21540, 21532, 21536); // ON high
    else if (i === 60) push(hh, mm, 21515, 21517, 21510, 21514); // ON low
    else push(hh, mm, 21525, 21527, 21523, 21525);
  }
  return bars;
}

describe('computeLevels', () => {
  const bars = fixture();
  const info = sessionInfo(bars);
  const set = computeLevels(bars, info, bars.length - 1, DEFAULT_CONFIG);
  const get = (id: string) => set.levels.find((l) => l.id === id);

  it('finds PDH / PDL / prior close from the completed RTH session', () => {
    expect(get('PDH')?.price).toBe(21560);
    expect(get('PDL')?.price).toBe(21500);
    expect(get('PC')?.price).toBe(21530);
  });

  it('finds overnight high/low so far (no lookahead)', () => {
    expect(get('ONH')?.price).toBe(21540);
    expect(get('ONL')?.price).toBe(21510);
    // anchor before the ON low bar must not see it yet
    const early = computeLevels(bars, info, 390 + 40, DEFAULT_CONFIG);
    expect(early.levels.find((l) => l.id === 'ONL')?.price).toBeGreaterThan(21510);
  });

  it('emits round numbers within the window, tagging 100-multiples', () => {
    const rounds = set.levels.filter((l) => l.id === 'R50' || l.id === 'R100');
    const prices = rounds.map((r) => r.price);
    expect(prices).toContain(21500);
    expect(prices).toContain(21550);
    expect(rounds.find((r) => r.price === 21500)?.id).toBe('R100');
    for (const p of prices) expect(Math.abs(p - 21525)).toBeLessThanOrEqual(DEFAULT_CONFIG.roundWindow);
  });

  it('computes VWAP within the session price range', () => {
    expect(set.vwap).not.toBeNull();
    expect(set.vwap!).toBeGreaterThan(21500);
    expect(set.vwap!).toBeLessThan(21560);
  });

  it('clusters PDL with the 21500 round number (confluence)', () => {
    const cluster = set.clusters.find((c) => Math.abs(c.price - 21500) <= 5);
    expect(cluster).toBeDefined();
    expect(cluster!.members).toContain('PDL');
    expect(cluster!.members.some((m) => m === 'R100')).toBe(true);
  });

  it('primaryLevels returns the pre-session marking routine list', () => {
    const prim = primaryLevels(set, 2);
    const ids = prim.map((p) => p.id);
    expect(ids).toContain('PDH');
    expect(ids).toContain('PDL');
    expect(ids).toContain('ONH');
  });
});

describe('nearestLevel / clusterLevels', () => {
  it('nearestLevel respects tolerance', () => {
    const set = {
      levels: [{ id: 'PDH' as const, price: 21550, label: 'PDH' }],
      clusters: [],
      vwap: null,
    };
    expect(nearestLevel(set, 21548, 15)?.id).toBe('PDH');
    expect(nearestLevel(set, 21500, 15)).toBeNull();
  });
  it('clusterLevels groups within tolerance only', () => {
    const clusters = clusterLevels(
      [
        { id: 'PDH', price: 21550, label: '' },
        { id: 'ONH', price: 21556, label: '' },
        { id: 'PC', price: 21400, label: '' },
      ],
      15,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.sort()).toEqual(['ONH', 'PDH']);
  });
});
