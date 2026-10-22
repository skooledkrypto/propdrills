import { describe, expect, it } from 'vitest';
import type { Level } from '../types';
import { levelFullName, mergedLevelNotes, nextUnplaced, scoreSlots } from '../levelDrill';

const lv = (id: Level['id'], price: number): Level => ({ id, price, label: `${id} ${price}` });

describe('scoreSlots', () => {
  const targets = [lv('PDH', 23100), lv('PDL', 22950), lv('PC', 23010)];

  it('hits within tolerance, misses outside, unplaced counts as miss', () => {
    const { hits, results } = scoreSlots(targets, [23104, 22900, null], 8);
    expect(hits).toBe(1);
    expect(results[0]).toEqual({ placed: true, hit: true, off: 4 });
    expect(results[1]).toEqual({ placed: true, hit: false, off: 50 });
    expect(results[2]).toEqual({ placed: false, hit: false, off: null });
  });

  it('exact tolerance boundary is a hit', () => {
    const { results } = scoreSlots(targets, [23108, null, null], 8);
    expect(results[0].hit).toBe(true);
  });

  it('each slot scores against its own level — a PDH mark on the PDL price is a miss', () => {
    const { hits } = scoreSlots(targets, [22950, 23100, null], 8);
    expect(hits).toBe(0);
  });
});

describe('nextUnplaced', () => {
  it('advances to the following unplaced slot, wrapping', () => {
    expect(nextUnplaced([1, null, null], 0)).toBe(1);
    expect(nextUnplaced([null, 2, null], 2)).toBe(0);
    expect(nextUnplaced([1, 2, 3], 1)).toBeNull();
  });
});

describe('mergedLevelNotes', () => {
  it('names a drill level that collapsed into another within tolerance', () => {
    const all = [lv('PDH', 23100), lv('PDL', 22950), lv('ONH', 23103)];
    const targets = [lv('PDH', 23100), lv('PDL', 22950)]; // ONH deduped away
    expect(mergedLevelNotes(all, targets, 8)).toEqual(['ONH sits on PDH today — one line covers both']);
  });

  it('is silent when every drill level is a target', () => {
    const all = [lv('PDH', 23100), lv('PDL', 22950)];
    expect(mergedLevelNotes(all, all, 8)).toEqual([]);
  });
});

describe('levelFullName', () => {
  it('spells out the drill levels and falls back to the id', () => {
    expect(levelFullName('PDH')).toBe('Prior-day high');
    expect(levelFullName('VWAP')).toBe('VWAP');
  });
});
