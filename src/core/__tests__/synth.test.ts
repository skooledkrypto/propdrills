import { describe, expect, it } from 'vitest';
import { BUILDERS, generateSampleSeries, mirror, mulberry32, synthDrill } from '../synth';
import { PATTERN_ORDER } from '../patterns';
import { classify, toET } from '../sessions';

describe('pattern builders', () => {
  const R = mulberry32(42);

  it('every builder produces geometrically valid candles', () => {
    for (const id of PATTERN_ORDER) {
      const scn = BUILDERS[id](R);
      for (const k of scn.candles) {
        expect(k.h).toBeGreaterThanOrEqual(Math.max(k.o, k.c));
        expect(k.l).toBeLessThanOrEqual(Math.min(k.o, k.c));
      }
      expect(scn.hl[0]).toBeGreaterThanOrEqual(0);
      expect(scn.hl[1]).toBeLessThan(scn.candles.length);
    }
  });

  it('engulfing builder: green body engulfs prior red body', () => {
    const scn = BUILDERS.engulf(mulberry32(7));
    const prev = scn.candles[scn.candles.length - 2];
    const cur = scn.candles[scn.candles.length - 1];
    expect(prev.c).toBeLessThan(prev.o); // red
    expect(cur.c).toBeGreaterThan(cur.o); // green
    expect(cur.o).toBeLessThanOrEqual(prev.c);
    expect(cur.c).toBeGreaterThanOrEqual(prev.o);
  });

  it('pin builder: rejection wick at least 2x body', () => {
    const scn = BUILDERS.pin(mulberry32(7));
    const pin = scn.candles[scn.candles.length - 1];
    const body = Math.abs(pin.c - pin.o);
    const lowerWick = Math.min(pin.o, pin.c) - pin.l;
    expect(lowerWick).toBeGreaterThanOrEqual(2 * body);
  });

  it('inside builder: bar sits inside mother bar', () => {
    const scn = BUILDERS.inside(mulberry32(7));
    const mother = scn.candles[scn.candles.length - 2];
    const ins = scn.candles[scn.candles.length - 1];
    expect(ins.h).toBeLessThan(mother.h);
    expect(ins.l).toBeGreaterThan(mother.l);
  });

  it('fvg builder leaves a visible 3-candle gap', () => {
    const scn = BUILDERS.fvg(mulberry32(7));
    const cs = scn.candles;
    const gapIdx = cs.length - 4; // candle C of the displacement
    expect(cs[gapIdx - 2].h).toBeLessThan(cs[gapIdx].l);
  });

  it('mirror flips bias and preserves geometry validity', () => {
    const scn = BUILDERS.sweep(mulberry32(9));
    const m = mirror(scn);
    expect(m.bias).toBe('short');
    for (const k of m.candles) {
      expect(k.h).toBeGreaterThanOrEqual(Math.max(k.o, k.c));
      expect(k.l).toBeLessThanOrEqual(Math.min(k.o, k.c));
    }
  });
});

describe('synthDrill', () => {
  it('produces a complete instance with level and outcome', () => {
    const d = synthDrill('sweep', { difficulty: 'hard', rng: mulberry32(3) });
    expect(d.bars.length).toBeGreaterThan(10);
    expect(d.outcomeBars.length).toBeGreaterThan(0);
    expect(d.levelSet.levels).toHaveLength(1);
    expect(d.levelHit).not.toBeNull();
    expect(d.source).toBe('synthetic');
    // timestamps strictly increasing across bars + outcome
    const all = [...d.bars, ...d.outcomeBars];
    for (let i = 1; i < all.length; i++) expect(all[i].t).toBeGreaterThan(all[i - 1].t);
  });
  it("'no' drill has no level hit and bias none", () => {
    const d = synthDrill('no', { difficulty: 'easy', rng: mulberry32(4) });
    expect(d.bias).toBe('none');
    expect(d.levelHit).toBeNull();
  });
});

describe('generateSampleSeries', () => {
  const bars = generateSampleSeries(7, 123, toET);

  it('creates a non-trivial, strictly ordered series', () => {
    expect(bars.length).toBeGreaterThan(3000);
    for (let i = 1; i < bars.length; i++) expect(bars[i].t).toBeGreaterThan(bars[i - 1].t);
  });

  it('never emits bars in the maintenance hour or weekend close', () => {
    for (const b of bars) {
      const p = toET(b.t);
      const m = p.hh * 60 + p.mm;
      expect(classify(m)).not.toBe('maintenance');
      const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
      expect(wd).not.toBe(6); // never Saturday
      if (wd === 0) expect(m).toBeGreaterThanOrEqual(18 * 60); // Sunday only after reopen
    }
  });

  it('keeps prices on the 0.25 tick grid', () => {
    for (const b of bars.slice(0, 500)) {
      for (const x of [b.o, b.h, b.l, b.c]) expect((x * 4) % 1).toBe(0);
    }
  });
});
