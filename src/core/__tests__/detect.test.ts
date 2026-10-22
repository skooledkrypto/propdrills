import { describe, expect, it } from 'vitest';
import { detect } from '../detect';
import { generateSampleSeries } from '../synth';
import { toET } from '../sessions';
import { wallClockToUtc } from '../csv';
import { DEFAULT_CONFIG } from '../config';
import type { Candle } from '../types';

const ET = 'America/New_York';

/** Hand-built fixture: flat day 1 with PDL 21500, then an overnight sweep of it. */
function sweepFixture(): { bars: Candle[]; sweepT: number } {
  const bars: Candle[] = [];
  const push = (h: number, m: number, o: number, hi: number, lo: number, c: number) =>
    bars.push({ t: wallClockToUtc(ET, 2026, 6, 1, h, m), o, h: hi, l: lo, c, v: 200 });
  // Day-1 RTH: drifts in a band; low of day exactly 21500 once
  for (let i = 0; i < 390; i++) {
    const hh = Math.floor((570 + i) / 60);
    const mm = (570 + i) % 60;
    const wob = (i % 7) - 3; // ±3 wobble so bodies aren't degenerate
    if (i === 180) push(hh, mm, 21512, 21514, 21500, 21511);
    else push(hh, mm, 21520 + wob, 21523 + wob, 21517 + wob, 21521 + wob);
  }
  // Overnight from 18:00: hovers well above the PDL...
  let sweepT = 0;
  for (let i = 0; i <= 150; i++) {
    const total = 18 * 60 + i;
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    const wob = (i % 5) - 2;
    if (i === 120) {
      // ...then one bar sweeps 21500 (low 21493 = 7 pts through) and reclaims (close 21509)
      const t = wallClockToUtc(ET, 2026, 6, 1, hh, mm);
      bars.push({ t, o: 21506, h: 21510, l: 21493, c: 21509, v: 800 });
      sweepT = t;
    } else push(hh, mm, 21512 + wob, 21515 + wob, 21509 + wob, 21513 + wob);
  }
  return { bars, sweepT };
}

describe('detect — hand-built sweep', () => {
  it('finds the liquidity sweep of the prior-day low at the exact bar', () => {
    const { bars, sweepT } = sweepFixture();
    const instances = detect(bars, { ...DEFAULT_CONFIG, outcomeBars: 15 });
    const sweeps = instances.filter((d) => d.patternId === 'sweep');
    const hit = sweeps.find((d) => d.bars[d.bars.length - 1].t === sweepT);
    expect(hit).toBeDefined();
    expect(hit!.bias).toBe('long');
    expect(hit!.levelHit).not.toBeNull();
    // the swept level is the PDL zone (PDL 21500, confluent with round 21500)
    expect(Math.abs(hit!.levelHit!.price - 21500)).toBeLessThanOrEqual(DEFAULT_CONFIG.tol);
    expect(hit!.sessionTag).toBe('overnight');
  });
});

describe('detect — sample series sweep-through', () => {
  const bars = generateSampleSeries(10, 7, toET);
  const instances = detect(bars, DEFAULT_CONFIG);

  it('emits instances of several patterns without lookahead violations', () => {
    expect(instances.length).toBeGreaterThan(0);
    for (const d of instances) {
      expect(d.bars).toHaveLength(DEFAULT_CONFIG.leadInBars + 1);
      expect(d.outcomeBars).toHaveLength(DEFAULT_CONFIG.outcomeBars);
      // outcome strictly follows the decision bar
      expect(d.outcomeBars[0].t).toBeGreaterThan(d.bars[d.bars.length - 1].t);
      if (d.patternId !== 'no') {
        expect(d.levelHit).not.toBeNull();
        expect(d.bias === 'long' || d.bias === 'short').toBe(true);
        expect(d.realizedMove).toBeDefined();
      }
    }
  });

  it('respects the per-pattern dedupe gap', () => {
    const byPattern = new Map<string, number[]>();
    for (const d of instances) {
      const t = d.bars[d.bars.length - 1].t;
      const arr = byPattern.get(d.patternId) ?? [];
      arr.push(t);
      byPattern.set(d.patternId, arr);
    }
    for (const [, times] of byPattern) {
      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        // gap counted in bars, but bars are >= 1 min apart, so ms gap must be >= gapBars minutes
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(DEFAULT_CONFIG.dedupeGapBars * 60000);
      }
    }
  });
});
