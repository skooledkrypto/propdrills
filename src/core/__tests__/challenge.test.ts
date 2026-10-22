import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_PRESETS,
  MNQ_POINT_VALUE,
  RULE_PRESETS,
  beginCampaignDay,
  bestDayPnl,
  classifyWindow,
  closePosition,
  computeBadges,
  createCampaign,
  createChallenge,
  effectiveProfitTarget,
  openPosition,
  passedStreak,
  pickDayWindow,
  step,
  tradeStats,
  type ChallengeAttempt,
} from '../challenge';
import { sessionInfo } from '../sessions';
import {
  canPickScenario,
  canStartChallenge,
  canUseAccountSize,
  visibleHistoryCount,
} from '../entitlement';
import type { Candle } from '../types';

// 2026-01-05 was a Monday. 15:00 UTC = 10:00 ET (winter, UTC-5) — inside RTH.
const DAY1 = Date.UTC(2026, 0, 5, 15, 0);
const DAY2 = Date.UTC(2026, 0, 6, 15, 0);

function bar(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1000 };
}

/** Flat tape at `px` starting `t0`, one bar per minute. */
function flatBars(t0: number, px: number, n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => bar(t0 + i * 60_000, px, px + 0.5, px - 0.5, px));
}

// target 3000, trailing DD 2000, daily loss 1000 — costs zeroed so the rule
// mechanics stay readable in round numbers; the cost model has its own suite.
const RULES = { ...RULE_PRESETS[50000], commissionPerSide: 0, slippageTicks: 0 };

describe('challenge rules engine', () => {
  it('passes when the profit target is hit without a breach', () => {
    const s = createChallenge(50000, RULES);
    step(s, bar(DAY1, 21000, 21001, 20999, 21000));
    openPosition(s, 'long', 5, 21000, DAY1);
    // +300 pts × $2 × 5 = +$3000 = exactly the target
    step(s, bar(DAY1 + 60_000, 21000, 21300, 21000, 21300));
    expect(s.status).toBe('passed');
    expect(s.equity).toBe(53000);
    expect(s.position).toBeNull(); // auto-flattened on pass
    expect(s.trades).toHaveLength(1);
  });

  it('fails immediately on a trailing-drawdown breach and updates the HWM first', () => {
    const s = createChallenge(50000, RULES);
    openPosition(s, 'long', 5, 21000, DAY1);
    // run equity up +$1500 → HWM 51500
    step(s, bar(DAY1, 21000, 21150, 21000, 21150));
    expect(s.hwm).toBe(51500);
    expect(s.status).toBe('active');
    // give back $2000 from the HWM (equity 49500) → trailing breach,
    // even though the loss vs start is only $500 (< daily loss limit)
    step(s, bar(DAY1 + 60_000, 21150, 21150, 20950, 20950));
    expect(s.status).toBe('failed');
    expect(s.failReason).toBe('trailing-drawdown');
  });

  it('fails on the daily-loss limit and resets the day anchor on an ET day roll', () => {
    // Daily loss should measure from the day's starting equity, not overall start.
    const s = createChallenge(50000, RULES);
    openPosition(s, 'long', 2, 21000, DAY1);
    step(s, bar(DAY1, 21000, 21200, 21000, 21200)); // day1 +$800, equity 50800
    closePosition(s, 21200, DAY1 + 60_000, 'manual');

    step(s, bar(DAY2, 21200, 21201, 21199, 21200)); // new ET day → dayStart 50800
    openPosition(s, 'short', 2, 21200, DAY2);
    // price rises 240 pts against the short: -$960 on the day (< $1000, survives)
    step(s, bar(DAY2 + 60_000, 21200, 21440, 21200, 21440));
    expect(s.status).toBe('active');
    // another 15 pts: day loss $1020 ≥ $1000 → fail, even though equity
    // is still just below start+0 territory from day 1's gain
    step(s, bar(DAY2 + 120_000, 21440, 21455, 21440, 21455));
    expect(s.status).toBe('failed');
    expect(s.failReason).toBe('daily-loss');
  });

  it('keeps the high-water-mark trailing: a later smaller dip does not fail', () => {
    const s = createChallenge(50000, RULES);
    openPosition(s, 'long', 1, 21000, DAY1);
    step(s, bar(DAY1, 21000, 21500, 21000, 21500)); // +$1000, hwm 51000
    step(s, bar(DAY1 + 60_000, 21500, 21500, 21100, 21100)); // -$800 from hwm — fine
    expect(s.status).toBe('active');
    step(s, bar(DAY1 + 120_000, 21100, 21600, 21100, 21600)); // new hwm 51200
    expect(s.hwm).toBe(51200);
  });

  it('fills the stop intrabar, and prefers the stop when stop and target are both touched', () => {
    const s = createChallenge(50000, RULES);
    step(s, flatBars(DAY1, 21000, 1)[0]);
    openPosition(s, 'long', 3, 21000, DAY1, { stop: 20990, target: 21020 });
    // wide bar touches both sides — conservative fill = stop
    step(s, bar(DAY1 + 60_000, 21000, 21030, 20985, 21010));
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].reason).toBe('stop');
    expect(s.trades[0].pnl).toBe(-10 * MNQ_POINT_VALUE * 3);
    expect(s.trades[0].r).toBe(-1);
  });

  it('fills the target and reports a correct R-multiple', () => {
    const s = createChallenge(50000, RULES);
    openPosition(s, 'short', 2, 21000, DAY1, { stop: 21010, target: 20970 });
    step(s, bar(DAY1, 21000, 21005, 20960, 20965));
    expect(s.trades[0].reason).toBe('target');
    expect(s.trades[0].pnl).toBe(30 * MNQ_POINT_VALUE * 2);
    expect(s.trades[0].r).toBe(3);
  });

  it('rejects stops/targets on the wrong side of entry', () => {
    const s = createChallenge(50000, RULES);
    expect(openPosition(s, 'long', 1, 21000, DAY1, { stop: 21010 })).toBe(false);
    expect(openPosition(s, 'long', 1, 21000, DAY1, { target: 20990 })).toBe(false);
    expect(openPosition(s, 'short', 1, 21000, DAY1, { stop: 20990 })).toBe(false);
    expect(s.position).toBeNull();
  });

  it('honors minTradingDays before granting a pass', () => {
    const s = createChallenge(50000, { ...RULES, id: 'x', minTradingDays: 2 });
    openPosition(s, 'long', 5, 21000, DAY1);
    step(s, bar(DAY1, 21000, 21300, 21000, 21300)); // target-sized gain, day 1 only
    expect(s.status).toBe('active');
    closePosition(s, 21300, DAY1 + 60_000, 'manual');
    step(s, bar(DAY2, 21300, 21301, 21299, 21300));
    openPosition(s, 'long', 1, 21300, DAY2, { stop: 21290 });
    closePosition(s, 21301, DAY2 + 60_000, 'manual'); // second traded day
    step(s, bar(DAY2 + 120_000, 21301, 21302, 21300, 21301));
    expect(s.status).toBe('passed');
  });

  it('raises the effective target when one day exceeds the consistency cap', () => {
    const s = createChallenge(50000, { ...RULES, id: 'x', consistencyPct: 0.5 });
    // day 1: +$2000 realized — over the $1500 cap (50% of $3000 target)
    openPosition(s, 'long', 5, 21000, DAY1);
    step(s, bar(DAY1, 21000, 21200, 21000, 21200));
    closePosition(s, 21200, DAY1 + 60_000, 'manual');
    expect(bestDayPnl(s)).toBe(2000);
    expect(effectiveProfitTarget(s)).toBe(4000); // 2000 / 0.5
    // day 2: another +$1000 → profit $3000 ≥ old target but < raised target
    step(s, bar(DAY2, 21200, 21201, 21199, 21200));
    openPosition(s, 'long', 5, 21200, DAY2);
    step(s, bar(DAY2 + 60_000, 21200, 21300, 21200, 21300));
    expect(s.status).toBe('active');
    // +$1000 more on day 2 → profit $4000 = raised target → pass
    step(s, bar(DAY2 + 120_000, 21300, 21400, 21300, 21400));
    expect(s.status).toBe('passed');
  });

  it('counts open-position P&L toward today for the consistency rule', () => {
    const s = createChallenge(50000, { ...RULES, id: 'x', consistencyPct: 0.5 });
    openPosition(s, 'long', 5, 21000, DAY1);
    // +$2500 unrealized would clear the $3000 target's worth? No: best day
    // 2500 raises the target to 5000, so the run must stay active.
    step(s, bar(DAY1, 21000, 21250, 21000, 21250));
    expect(s.status).toBe('active');
    expect(effectiveProfitTarget(s)).toBe(5000);
  });

  it('computes trade stats (expectancy, win rate, profit factor)', () => {
    const s = createChallenge(50000, RULES);
    openPosition(s, 'long', 1, 21000, DAY1, { stop: 20990 });
    closePosition(s, 21020, DAY1 + 1, 'manual'); // +$40, R2
    openPosition(s, 'long', 1, 21020, DAY1 + 2, { stop: 21010 });
    closePosition(s, 21010, DAY1 + 3, 'stop'); // -$20, R-1
    const st = tradeStats(s.trades);
    expect(st.n).toBe(2);
    expect(st.winRate).toBe(0.5);
    expect(st.totalPnl).toBe(20);
    expect(st.expectancy).toBe(10);
    expect(st.avgR).toBe(0.5);
    expect(st.profitFactor).toBe(2);
  });
});

describe('trading costs (commission + slippage)', () => {
  // Presets: commissionPerSide 0.74, slippageTicks 1 (= 0.25 pt, $0.50/contract).

  it('ships cost defaults on every preset', () => {
    for (const size of [25000, 50000, 100000] as const) {
      expect(RULE_PRESETS[size].commissionPerSide).toBe(0.74);
      expect(RULE_PRESETS[size].slippageTicks).toBe(1);
      expect(CAMPAIGN_PRESETS[size].commissionPerSide).toBe(0.74);
      expect(CAMPAIGN_PRESETS[size].slippageTicks).toBe(1);
    }
  });

  it('slips market entries one tick against the trader', () => {
    const l = createChallenge(50000);
    openPosition(l, 'long', 1, 21000, DAY1);
    expect(l.position!.entry).toBe(21000.25);
    const sh = createChallenge(50000);
    openPosition(sh, 'short', 1, 21000, DAY1);
    expect(sh.position!.entry).toBe(20999.75);
  });

  it('slips manual exits and nets round-trip commission out of pnl', () => {
    const s = createChallenge(50000);
    openPosition(s, 'long', 3, 21000, DAY1); // fills 21000.25
    const tr = closePosition(s, 21010, DAY1 + 60_000, 'manual')!; // fills 21009.75
    expect(tr.exit).toBe(21009.75);
    expect(tr.fees).toBeCloseTo(4.44, 6); // 0.74 × 2 sides × 3 contracts
    expect(tr.pnl).toBeCloseTo(9.5 * MNQ_POINT_VALUE * 3 - 4.44, 6);
    expect(s.realized).toBeCloseTo(tr.pnl, 6);
  });

  it('slips stop fills (market once triggered) but never target fills (limit)', () => {
    const st = createChallenge(50000);
    openPosition(st, 'long', 1, 21000, DAY1, { stop: 20990 }); // entry 21000.25
    step(st, bar(DAY1, 21000, 21005, 20985, 20995));
    expect(st.trades[0].reason).toBe('stop');
    expect(st.trades[0].exit).toBe(20989.75); // one tick through the stop
    expect(st.trades[0].pnl).toBeCloseTo(-10.5 * MNQ_POINT_VALUE - 1.48, 6);

    const tg = createChallenge(50000);
    openPosition(tg, 'short', 2, 21000, DAY1, { target: 20970 }); // entry 20999.75
    step(tg, bar(DAY1, 21000, 21005, 20960, 20965));
    expect(tg.trades[0].reason).toBe('target');
    expect(tg.trades[0].exit).toBe(20970); // exact limit fill
    expect(tg.trades[0].pnl).toBeCloseTo(29.75 * MNQ_POINT_VALUE * 2 - 2.96, 6);
  });

  it('leaves rules objects without cost fields frictionless (saved-campaign compat)', () => {
    const legacy = { id: 'old', name: 'old', profitTarget: 3000, trailingMaxDrawdown: 2000, dailyLossLimit: 1000 };
    const s = createChallenge(50000, legacy);
    openPosition(s, 'long', 2, 21000, DAY1);
    expect(s.position!.entry).toBe(21000);
    const tr = closePosition(s, 21010, DAY1 + 60_000, 'manual')!;
    expect(tr.exit).toBe(21010);
    expect(tr.fees).toBe(0);
    expect(tr.pnl).toBe(10 * MNQ_POINT_VALUE * 2);
  });

  it('totals fees in tradeStats', () => {
    const s = createChallenge(50000);
    openPosition(s, 'long', 1, 21000, DAY1);
    closePosition(s, 21010, DAY1 + 1, 'manual');
    openPosition(s, 'short', 2, 21010, DAY1 + 2);
    closePosition(s, 21000, DAY1 + 3, 'manual');
    expect(tradeStats(s.trades).totalFees).toBeCloseTo(1.48 + 2.96, 6);
  });
});

describe('scenario classifier', () => {
  const t0 = DAY1;
  it('tags a steady climb as trend', () => {
    const bars = Array.from({ length: 60 }, (_, i) =>
      bar(t0 + i * 60_000, 21000 + i * 2, 21002 + i * 2, 20999 + i * 2, 21002 + i * 2),
    );
    expect(classifyWindow(bars)).toBe('trend');
  });
  it('tags a flat oscillation as chop', () => {
    const bars = Array.from({ length: 60 }, (_, i) =>
      bar(t0 + i * 60_000, 21000 + (i % 2), 21001.5, 20999.5, 21000 + ((i + 1) % 2)),
    );
    expect(classifyWindow(bars)).toBe('chop');
  });
  it('tags one huge bar as news-spike', () => {
    const bars = flatBars(t0, 21000, 59);
    bars.push(bar(t0 + 59 * 60_000, 21000, 21090, 20980, 21080));
    expect(classifyWindow(bars)).toBe('news-spike');
  });
  it('tags up-then-down as reversal', () => {
    const up = Array.from({ length: 30 }, (_, i) =>
      bar(t0 + i * 60_000, 21000 + i * 3, 21003 + i * 3, 20999 + i * 3, 21003 + i * 3),
    );
    const dn = Array.from({ length: 30 }, (_, i) =>
      bar(t0 + (30 + i) * 60_000, 21090 - i * 3, 21091 - i * 3, 21086 - i * 3, 21087 - i * 3),
    );
    expect(classifyWindow([...up, ...dn])).toBe('reversal');
  });
});

describe('day windows & campaigns', () => {
  // deterministic rng
  const lcg = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  it('picks full RTH sessions with context, honors exclusions', () => {
    const bars = [...flatBars(DAY1, 21000, 300), ...flatBars(DAY2, 21050, 300)];
    const info = sessionInfo(bars);
    const w = pickDayWindow(bars, info, { rng: lcg(7), contextBars: 400 });
    expect(w).not.toBeNull();
    const dayOf = (i: number) => Math.floor(bars[i].t / 86_400_000);
    expect(dayOf(w!.start)).toBe(dayOf(w!.end - 1));
    // full session: spans the whole RTH run of that day (fixtures are 300 bars/day)
    expect(w!.end - w!.start).toBe(300);
    // context precedes the day (clamped to series start)
    expect(w!.contextStart).toBeLessThanOrEqual(w!.start);
    expect(w!.contextStart).toBe(Math.max(0, w!.start - 400));

    const w2 = pickDayWindow(bars, info, { rng: lcg(7), excludeDayKeys: [w!.dayKey] });
    expect(w2).not.toBeNull();
    expect(w2!.dayKey).not.toBe(w!.dayKey);

    // all days excluded → still serves a (repeat) window rather than null
    const w3 = pickDayWindow(bars, info, {
      rng: lcg(7),
      excludeDayKeys: [w!.dayKey, w2!.dayKey],
    });
    expect(w3).not.toBeNull();
  });

  it('creates campaigns on campaign presets and records played days', () => {
    const c = createCampaign(50000, 123);
    expect(c.state.rules.id).toBe('camp-50k');
    expect(c.state.rules.minTradingDays).toBe(2);
    expect(c.state.rules.consistencyPct).toBe(0.5);
    expect(CAMPAIGN_PRESETS[50000].profitTarget).toBe(RULE_PRESETS[50000].profitTarget);

    beginCampaignDay(c, { start: 0, end: 200, scenario: 'trend', dayKey: 20260105, contextStart: 0 });
    beginCampaignDay(c, { start: 300, end: 500, scenario: 'chop', dayKey: 20260106, contextStart: 100 });
    expect(c.day).toBe(2);
    expect(c.usedDayKeys).toEqual([20260105, 20260106]);
    expect(c.scenarios).toEqual(['trend', 'chop']);
  });
});

describe('badges & streaks', () => {
  const attempt = (result: 'passed' | 'failed', size: 25000 | 50000 | 100000 = 50000): ChallengeAttempt => ({
    id: String(Math.random()),
    t: 1,
    accountSize: size,
    rulesId: 'x',
    scenario: 'trend',
    result,
    failReason: null,
    barsPlayed: 100,
    finalEquity: 0,
    startEquity: 0,
    stats: tradeStats([]),
    trades: [],
  });

  it('counts the trailing passed streak', () => {
    expect(passedStreak([attempt('failed'), attempt('passed'), attempt('passed')])).toBe(2);
    expect(passedStreak([attempt('passed'), attempt('failed')])).toBe(0);
  });

  it('awards run and size badges', () => {
    const hist = [attempt('passed', 25000), attempt('passed', 50000), attempt('passed', 100000)];
    const badges = Object.fromEntries(computeBadges(hist).map((b) => [b.id, b.earned]));
    expect(badges['first-pass']).toBe(true);
    expect(badges['hat-trick']).toBe(true);
    expect(badges['all-sizes']).toBe(true);
  });
});

describe('entitlement gating', () => {
  it('limits free challenge attempts', () => {
    expect(canStartChallenge(false, 0).allowed).toBe(true);
    expect(canStartChallenge(false, 1).allowed).toBe(true);
    expect(canStartChallenge(false, 2)).toEqual({ allowed: false, reason: 'attempt-limit' });
    expect(canStartChallenge(true, 99).allowed).toBe(true);
  });
  it('locks account sizes and scenario picking for free users', () => {
    expect(canUseAccountSize(false, 50000).allowed).toBe(true);
    expect(canUseAccountSize(false, 100000).allowed).toBe(false);
    expect(canPickScenario(false, null).allowed).toBe(true);
    expect(canPickScenario(false, 'trend').allowed).toBe(false);
    expect(canPickScenario(true, 'trend').allowed).toBe(true);
  });
  it('caps visible history for free users', () => {
    expect(visibleHistoryCount(false, 10)).toBe(3);
    expect(visibleHistoryCount(true, 10)).toBe(10);
  });
});
