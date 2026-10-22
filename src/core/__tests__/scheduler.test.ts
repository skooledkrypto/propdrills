import { describe, expect, it } from 'vitest';
import { applyResult, dueCount, ensureProgress, nextPattern, overdueFactor } from '../scheduler';
import { DAY_MS } from '../config';
import type { Progress } from '../types';

const now = 1_800_000_000_000;

function fresh(): Progress {
  return ensureProgress({ perPattern: {} });
}

describe('Leitner box movement', () => {
  it('promotes on correct, resets to box 1 on wrong', () => {
    const p = fresh();
    applyResult(p, 'sweep', true, now);
    expect(p.perPattern.sweep.box).toBe(1);
    applyResult(p, 'sweep', true, now);
    expect(p.perPattern.sweep.box).toBe(2);
    applyResult(p, 'sweep', true, now);
    expect(p.perPattern.sweep.box).toBe(3);
    applyResult(p, 'sweep', false, now);
    expect(p.perPattern.sweep.box).toBe(1);
    expect(p.perPattern.sweep.streak).toBe(0);
  });

  it('caps at box 5 and sets dueAt by interval', () => {
    const p = fresh();
    for (let i = 0; i < 8; i++) applyResult(p, 'pin', true, now);
    expect(p.perPattern.pin.box).toBe(5);
    expect(p.perPattern.pin.dueAt).toBe(now + 14 * DAY_MS);
  });
});

describe('overdue and due counts', () => {
  it('unseen patterns are prioritized and count as due', () => {
    const p = fresh();
    expect(overdueFactor(p.perPattern.sweep, now)).toBeGreaterThan(1);
    expect(dueCount(p, now)).toBeGreaterThan(0);
  });
  it('a freshly promoted pattern is not due before its interval', () => {
    const p = fresh();
    applyResult(p, 'sweep', true, now);
    applyResult(p, 'sweep', true, now); // box 2, due in 1 day
    expect(overdueFactor(p.perPattern.sweep, now + DAY_MS / 2)).toBe(0);
    expect(overdueFactor(p.perPattern.sweep, now + 2 * DAY_MS)).toBeGreaterThan(0);
  });
});

describe('nextPattern sampler', () => {
  it('honors the no-setup rate at the extremes', () => {
    const p = fresh();
    expect(nextPattern(p, now, { noSetupRate: 1, rng: () => 0.5 })).toBe('no');
    expect(nextPattern(p, now, { noSetupRate: 0, rng: () => 0.99 })).not.toBe('no');
  });

  it('focus mode serves the focused pattern', () => {
    const p = fresh();
    expect(nextPattern(p, now, { noSetupRate: 0, focus: 'engulf', rng: () => 0.7 })).toBe('engulf');
  });

  it('weights weak patterns above strong ones', () => {
    const p = fresh();
    // sweep: strong (20/20, box 5, not due). pin: weak (2/10, overdue).
    for (let i = 0; i < 20; i++) applyResult(p, 'sweep', true, now - DAY_MS);
    for (let i = 0; i < 10; i++) applyResult(p, 'pin', i < 2, now - 5 * DAY_MS);
    // make everything else "seen recently" so the comparison is sweep vs pin
    for (const id of Object.keys(p.perPattern)) {
      if (id !== 'sweep' && id !== 'pin') {
        for (let i = 0; i < 5; i++) applyResult(p, id as never, true, now - 1000);
      }
    }
    let pinCount = 0;
    let sweepCount = 0;
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 500; i++) {
      const pick = nextPattern(p, now, { noSetupRate: 0, rng });
      if (pick === 'pin') pinCount++;
      if (pick === 'sweep') sweepCount++;
    }
    expect(pinCount).toBeGreaterThan(sweepCount * 2);
  });
});
