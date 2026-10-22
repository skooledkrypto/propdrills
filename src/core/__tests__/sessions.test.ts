import { describe, expect, it } from 'vitest';
import { classify, overnightSessions, prevDateNum, rthSessions, sessionInfo, toET } from '../sessions';
import { wallClockToUtc } from '../csv';
import type { Candle } from '../types';

const ET = 'America/New_York';

function mkBar(t: number, p = 21500): Candle {
  return { t, o: p, h: p + 1, l: p - 1, c: p, v: 100 };
}

describe('toET', () => {
  it('converts summer (EDT, UTC-4) correctly', () => {
    const p = toET(Date.UTC(2026, 5, 1, 22, 0)); // 2026-06-01 22:00Z
    expect([p.mo, p.d, p.hh, p.mm]).toEqual([6, 1, 18, 0]);
  });
  it('converts winter (EST, UTC-5) correctly', () => {
    const p = toET(Date.UTC(2026, 0, 15, 23, 0));
    expect([p.mo, p.d, p.hh, p.mm]).toEqual([1, 15, 18, 0]);
  });
  it('handles the 2026 spring-forward boundary', () => {
    const before = toET(Date.UTC(2026, 2, 8, 6, 59)); // 01:59 EST
    const after = toET(Date.UTC(2026, 2, 8, 7, 0)); // 03:00 EDT
    expect([before.hh, before.mm]).toEqual([1, 59]);
    expect([after.hh, after.mm]).toEqual([3, 0]);
  });
});

describe('classify', () => {
  it('maps ET minutes to session tags', () => {
    expect(classify(9 * 60 + 30)).toBe('rth');
    expect(classify(15 * 60 + 59)).toBe('rth');
    expect(classify(16 * 60)).toBe('postrth');
    expect(classify(17 * 60 + 30)).toBe('maintenance');
    expect(classify(18 * 60)).toBe('overnight');
    expect(classify(2 * 60)).toBe('overnight');
  });
});

describe('prevDateNum', () => {
  it('crosses month and year boundaries', () => {
    expect(prevDateNum(20260301)).toBe(20260228);
    expect(prevDateNum(20260101)).toBe(20251231);
  });
});

describe('session grouping', () => {
  it('groups overnight bars after midnight with the prior date key', () => {
    const bars: Candle[] = [
      mkBar(wallClockToUtc(ET, 2026, 6, 1, 18, 0)),
      mkBar(wallClockToUtc(ET, 2026, 6, 1, 23, 59)),
      mkBar(wallClockToUtc(ET, 2026, 6, 2, 0, 0)),
      mkBar(wallClockToUtc(ET, 2026, 6, 2, 9, 29)),
      mkBar(wallClockToUtc(ET, 2026, 6, 2, 9, 30)),
      mkBar(wallClockToUtc(ET, 2026, 6, 2, 15, 59)),
    ];
    const info = sessionInfo(bars);
    expect(info[0].overnightKey).toBe(20260601);
    expect(info[2].overnightKey).toBe(20260601); // past midnight, same session
    expect(info[3].overnightKey).toBe(20260601);
    const on = overnightSessions(info);
    expect(on).toHaveLength(1);
    expect([on[0].from, on[0].to]).toEqual([0, 3]);
    const rth = rthSessions(info);
    expect(rth).toHaveLength(1);
    expect([rth[0].from, rth[0].to]).toEqual([4, 5]);
  });
});
