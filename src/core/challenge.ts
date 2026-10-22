import type { BarSessionInfo, Candle } from './types';
import { etDateNum, toET } from './sessions';

/**
 * Challenge Mode — a SIMULATED prop-firm-style evaluation. Educational and
 * hypothetical only: no real money, no brokerage or prop-firm connection, and
 * the rule presets are generic (not modelled on, or affiliated with, any real
 * firm). The engine is pure TS with no platform dependencies so web and
 * mobile share it, mirroring the rest of src/core.
 *
 * Mutation style follows scheduler.applyResult: functions mutate the state
 * object they are given; UI layers copy or version-tick as they see fit.
 */

/** $ per index point per contract (MNQ). */
export const MNQ_POINT_VALUE = 2;

/** Minimum price increment (MNQ). */
export const MNQ_TICK = 0.25;

export const ACCOUNT_SIZES = [25000, 50000, 100000] as const;
export type AccountSize = (typeof ACCOUNT_SIZES)[number];

export interface ChallengeRules {
  id: string;
  name: string;
  /** $ of profit that passes the evaluation. */
  profitTarget: number;
  /** $ below the equity high-water-mark that fails it (trailing). */
  trailingMaxDrawdown: number;
  /** $ lost within one ET trading day that fails it. */
  dailyLossLimit: number;
  /** Distinct ET days with at least one closed trade required before a pass. */
  minTradingDays?: number;
  /**
   * Consistency rule (Topstep-style): the best single day's realized P&L must
   * stay ≤ this fraction of the profit target. Exceeding it does not fail the
   * run — it raises the effective target to bestDay / pct, so one spike day
   * can never pass alone.
   */
  consistencyPct?: number;
  /**
   * $ commission + fees charged per side per contract, deducted from each
   * trade's P&L. Absent/0 = frictionless (all rules objects saved before this
   * field existed, so in-progress campaigns and old backups are unaffected).
   */
  commissionPerSide?: number;
  /**
   * Ticks of adverse slippage on market fills — entries, manual/end exits,
   * and triggered stops (a stop is a market order once touched). Target fills
   * are limit orders and never slip.
   */
  slippageTicks?: number;
}

/**
 * Generic evaluation presets per account size. To add a preset, add an entry
 * here (or pass custom rules straight into createChallenge — nothing else
 * reads this table).
 */
/** Typical MNQ all-in costs; applied to every preset so new runs feel live. */
export const DEFAULT_COMMISSION_PER_SIDE = 0.74;
export const DEFAULT_SLIPPAGE_TICKS = 1;
const COSTS = { commissionPerSide: DEFAULT_COMMISSION_PER_SIDE, slippageTicks: DEFAULT_SLIPPAGE_TICKS };

export const RULE_PRESETS: Record<AccountSize, ChallengeRules> = {
  25000: { id: 'eval-25k', name: '$25k Evaluation', profitTarget: 1500, trailingMaxDrawdown: 1000, dailyLossLimit: 500, ...COSTS },
  50000: { id: 'eval-50k', name: '$50k Evaluation', profitTarget: 3000, trailingMaxDrawdown: 2000, dailyLossLimit: 1000, ...COSTS },
  100000: { id: 'eval-100k', name: '$100k Evaluation', profitTarget: 6000, trailingMaxDrawdown: 3000, dailyLossLimit: 2000, ...COSTS },
};

/**
 * Multi-day campaign presets: same limits as RULE_PRESETS plus the two rules
 * that make a pass feel earned — a 2-trading-day minimum and a 50% best-day
 * consistency cap. RULE_PRESETS stays as-is for single-session sims (web).
 */
export const CAMPAIGN_PRESETS: Record<AccountSize, ChallengeRules> = {
  25000: { ...RULE_PRESETS[25000], id: 'camp-25k', minTradingDays: 2, consistencyPct: 0.5 },
  50000: { ...RULE_PRESETS[50000], id: 'camp-50k', minTradingDays: 2, consistencyPct: 0.5 },
  100000: { ...RULE_PRESETS[100000], id: 'camp-100k', minTradingDays: 2, consistencyPct: 0.5 },
};

export type Side = 'long' | 'short';
export type ExitReason = 'stop' | 'target' | 'manual' | 'end';
export type ChallengeStatus = 'active' | 'passed' | 'failed';
export type FailReason = 'trailing-drawdown' | 'daily-loss';

export interface OpenPosition {
  side: Side;
  qty: number;
  entry: number;
  /** Initial protective stop — also the denominator for the trade's R. */
  stop: number | null;
  target: number | null;
  entryT: number;
}

export interface SimTrade {
  side: Side;
  qty: number;
  entry: number;
  exit: number;
  entryT: number;
  exitT: number;
  /** Realized $ P&L including point value and quantity, NET of `fees`. */
  pnl: number;
  /** Round-trip commission $ deducted from pnl (absent on pre-cost records). */
  fees?: number;
  /** Signed R-multiple vs the initial stop; null when no stop was set. */
  r: number | null;
  reason: ExitReason;
}

export interface ChallengeState {
  accountSize: AccountSize;
  rules: ChallengeRules;
  startEquity: number;
  /** Realized (closed-trade) $ P&L. */
  realized: number;
  /** Realized + open P&L, marked at the last seen close. */
  equity: number;
  /** Trailing high-water-mark of `equity`. */
  hwm: number;
  /** ET date (yyyymmdd) the current session day belongs to. */
  dayKey: number;
  dayStartEquity: number;
  /** Distinct ET days on which at least one trade was closed. */
  tradedDays: number[];
  position: OpenPosition | null;
  trades: SimTrade[];
  equityCurve: { t: number; equity: number }[];
  status: ChallengeStatus;
  failReason: FailReason | null;
  lastPrice: number;
  lastT: number;
}

export function createChallenge(accountSize: AccountSize, rules?: ChallengeRules): ChallengeState {
  const r = rules ?? RULE_PRESETS[accountSize];
  return {
    accountSize,
    rules: r,
    startEquity: accountSize,
    realized: 0,
    equity: accountSize,
    hwm: accountSize,
    dayKey: 0,
    dayStartEquity: accountSize,
    tradedDays: [],
    position: null,
    trades: [],
    equityCurve: [],
    status: 'active',
    failReason: null,
    lastPrice: 0,
    lastT: 0,
  };
}

function pointPnl(side: Side, entry: number, price: number): number {
  return side === 'long' ? price - entry : entry - price;
}

/** Points of adverse slippage a market fill suffers under these rules. */
function slipPts(rules: ChallengeRules): number {
  return (rules.slippageTicks ?? 0) * MNQ_TICK;
}

export function openPnl(s: ChallengeState, price = s.lastPrice): number {
  if (!s.position) return 0;
  return pointPnl(s.position.side, s.position.entry, price) * MNQ_POINT_VALUE * s.position.qty;
}

export function openPosition(
  s: ChallengeState,
  side: Side,
  qty: number,
  price: number,
  t: number,
  opts: { stop?: number | null; target?: number | null } = {},
): boolean {
  if (s.status !== 'active' || s.position || qty < 1) return false;
  const stop = opts.stop ?? null;
  const target = opts.target ?? null;
  // market entry fills against the trader
  const fill = side === 'long' ? price + slipPts(s.rules) : price - slipPts(s.rules);
  // reject stops/targets on the wrong side of the fill — they'd fill instantly
  if (stop !== null && (side === 'long' ? stop >= fill : stop <= fill)) return false;
  if (target !== null && (side === 'long' ? target <= fill : target >= fill)) return false;
  s.position = { side, qty, entry: fill, stop, target, entryT: t };
  return true;
}

export function closePosition(s: ChallengeState, price: number, t: number, reason: ExitReason): SimTrade | null {
  const p = s.position;
  if (!p) return null;
  // targets are limit fills; everything else is a market fill and slips
  const slip = reason === 'target' ? 0 : slipPts(s.rules);
  const fill = p.side === 'long' ? price - slip : price + slip;
  const pts = pointPnl(p.side, p.entry, fill);
  const fees = (s.rules.commissionPerSide ?? 0) * 2 * p.qty;
  const pnl = pts * MNQ_POINT_VALUE * p.qty - fees;
  const riskPts = p.stop !== null ? Math.abs(p.entry - p.stop) : 0;
  const trade: SimTrade = {
    side: p.side,
    qty: p.qty,
    entry: p.entry,
    exit: fill,
    entryT: p.entryT,
    exitT: t,
    pnl,
    fees,
    r: riskPts > 0 ? pts / riskPts : null,
    reason,
  };
  s.trades.push(trade);
  s.realized += pnl;
  s.position = null;
  const dk = etDateNum(toET(t));
  if (!s.tradedDays.includes(dk)) s.tradedDays.push(dk);
  return trade;
}

/** Realized $ P&L per ET day (keyed by yyyymmdd of the exit). */
export function dayRealizedPnls(trades: SimTrade[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of trades) {
    const dk = etDateNum(toET(t.exitT));
    m.set(dk, (m.get(dk) ?? 0) + t.pnl);
  }
  return m;
}

/**
 * Best single-day P&L, floored at 0 (loss days never "lead"). Open-position
 * P&L is marked to the current day so a big unrealized winner raises the bar
 * live instead of only after it is closed.
 */
export function bestDayPnl(s: ChallengeState): number {
  const days = dayRealizedPnls(s.trades);
  if (s.position) days.set(s.dayKey, (days.get(s.dayKey) ?? 0) + openPnl(s));
  let best = 0;
  for (const v of days.values()) best = Math.max(best, v);
  return best;
}

/**
 * The profit target after the consistency rule: exceeding the best-day cap
 * raises the target to bestDay / consistencyPct (Topstep's escalation), so
 * the cap is re-satisfied only by earning more on other days.
 */
export function effectiveProfitTarget(s: ChallengeState): number {
  const target = s.rules.profitTarget;
  const pct = s.rules.consistencyPct;
  if (!pct) return target;
  const best = bestDayPnl(s);
  return best > pct * target ? Math.ceil(best / pct) : target;
}

/** Everything a challenge HUD needs, derived — nothing extra to persist. */
export interface ChallengeProgress {
  /** equity − startEquity (incl. open P&L). */
  profit: number;
  target: number;
  effectiveTarget: number;
  toTarget: number;
  bestDay: number;
  /** $ cap for any single day's realized P&L; null when no consistency rule. */
  consistencyCap: number | null;
  daysTraded: number;
  minDays: number;
  /** $ of trailing drawdown left before a fail. */
  ddRoom: number;
  /** $ of daily loss left before a fail. */
  dayRoom: number;
  /** Equity levels at which each rule fails (for on-chart lines). */
  ddFailEquity: number;
  dayFailEquity: number;
}

export function challengeProgress(s: ChallengeState): ChallengeProgress {
  const effectiveTarget = effectiveProfitTarget(s);
  const pct = s.rules.consistencyPct;
  const profit = s.equity - s.startEquity;
  return {
    profit,
    target: s.rules.profitTarget,
    effectiveTarget,
    toTarget: Math.max(0, effectiveTarget - profit),
    bestDay: bestDayPnl(s),
    consistencyCap: pct ? pct * effectiveTarget : null,
    daysTraded: s.tradedDays.length,
    minDays: s.rules.minTradingDays ?? 0,
    ddRoom: s.rules.trailingMaxDrawdown - (s.hwm - s.equity),
    dayRoom: s.rules.dailyLossLimit - (s.dayStartEquity - s.equity),
    ddFailEquity: s.hwm - s.rules.trailingMaxDrawdown,
    dayFailEquity: s.dayStartEquity - s.rules.dailyLossLimit,
  };
}

/**
 * Advance the sim by one bar: roll the ET day, fill stop/target intrabar
 * (stop wins when both are touched — conservative), mark to market at the
 * close, then enforce the rules. Breaches are checked before the profit
 * target so a bar that does both is a fail.
 */
export function step(s: ChallengeState, bar: Candle): void {
  if (s.status !== 'active') return;
  s.lastPrice = bar.c;
  s.lastT = bar.t;

  const dk = etDateNum(toET(bar.t));
  if (dk !== s.dayKey) {
    s.dayKey = dk;
    s.dayStartEquity = s.equity;
  }

  const p = s.position;
  if (p) {
    const stopHit = p.stop !== null && (p.side === 'long' ? bar.l <= p.stop : bar.h >= p.stop);
    const targetHit = p.target !== null && (p.side === 'long' ? bar.h >= p.target : bar.l <= p.target);
    if (stopHit) closePosition(s, p.stop as number, bar.t, 'stop');
    else if (targetHit) closePosition(s, p.target as number, bar.t, 'target');
  }

  s.equity = s.startEquity + s.realized + openPnl(s, bar.c);
  s.equityCurve.push({ t: bar.t, equity: s.equity });
  if (s.equity > s.hwm) s.hwm = s.equity;

  if (s.hwm - s.equity >= s.rules.trailingMaxDrawdown) {
    fail(s, 'trailing-drawdown', bar);
    return;
  }
  if (s.dayStartEquity - s.equity >= s.rules.dailyLossLimit) {
    fail(s, 'daily-loss', bar);
    return;
  }
  if (
    s.equity - s.startEquity >= effectiveProfitTarget(s) &&
    (!s.rules.minTradingDays || s.tradedDays.length >= s.rules.minTradingDays)
  ) {
    if (s.position) closePosition(s, bar.c, bar.t, 'end');
    s.equity = s.startEquity + s.realized;
    s.status = 'passed';
  }
}

function fail(s: ChallengeState, reason: FailReason, bar: Candle): void {
  if (s.position) closePosition(s, bar.c, bar.t, 'end');
  s.equity = s.startEquity + s.realized;
  s.status = 'failed';
  s.failReason = reason;
}

/** Flatten and freeze an unfinished run (user quit / data ran out). */
export function finishChallenge(s: ChallengeState): void {
  if (s.position) closePosition(s, s.lastPrice, s.lastT, 'end');
  s.equity = s.startEquity + s.realized;
}

// ---------------------------------------------------------------------------
// Stats

export interface TradeStats {
  n: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  /** Mean $ per trade. */
  expectancy: number;
  /** Mean R over trades that had a stop. */
  avgR: number | null;
  profitFactor: number | null;
  /** Total round-trip commissions paid (0 on pre-cost records). */
  totalFees: number;
}

export function tradeStats(trades: SimTrade[]): TradeStats {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const rs = trades.filter((t) => t.r !== null);
  const grossWin = trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
  return {
    n,
    wins,
    winRate: n ? wins / n : 0,
    totalPnl,
    expectancy: n ? totalPnl / n : 0,
    avgR: rs.length ? rs.reduce((a, t) => a + (t.r as number), 0) / rs.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    totalFees: trades.reduce((a, t) => a + (t.fees ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Scenario tagging

export type ScenarioType = 'trend' | 'chop' | 'news-spike' | 'reversal';
export const SCENARIO_TYPES: ScenarioType[] = ['trend', 'chop', 'news-spike', 'reversal'];

export const SCENARIO_LABEL: Record<ScenarioType, string> = {
  trend: 'Trend day',
  chop: 'Chop day',
  'news-spike': 'News spike',
  reversal: 'Reversal',
};

/** Classify a bar window by shape. Thresholds are heuristics, not science. */
export function classifyWindow(bars: Candle[]): ScenarioType {
  const n = bars.length;
  if (n < 20) return 'chop';
  const ranges = bars.map((b) => b.h - b.l).sort((a, b) => a - b);
  const median = ranges[Math.floor(n / 2)] || 0.25;
  const maxRange = Math.max(...bars.map((b) => b.h - b.l));
  if (maxRange >= 8 * median && maxRange > 10) return 'news-spike';

  const half = Math.floor(n / 2);
  const net1 = bars[half - 1].c - bars[0].o;
  const net2 = bars[n - 1].c - bars[half].o;
  const net = bars[n - 1].c - bars[0].o;
  const swing = median * Math.sqrt(n) * 2;
  if (Math.sign(net1) !== Math.sign(net2) && Math.abs(net1) > swing * 0.6 && Math.abs(net2) > swing * 0.6) {
    return 'reversal';
  }
  if (Math.abs(net) > swing) return 'trend';
  return 'chop';
}

export interface ChallengeWindow {
  start: number;
  end: number; // exclusive
  scenario: ScenarioType;
}

/**
 * Sample a replay window from a series, optionally hunting for a wanted
 * scenario type. Windows overlapping the daily maintenance halt are skipped
 * so the tape never freezes mid-run. Falls back to whatever it found last if
 * the wanted type never shows up.
 */
export function pickChallengeWindow(
  bars: Candle[],
  info: BarSessionInfo[],
  opts: { scenario?: ScenarioType | null; windowBars?: number; rng?: () => number } = {},
): ChallengeWindow | null {
  const size = opts.windowBars ?? 180;
  const rng = opts.rng ?? Math.random;
  if (bars.length < size + 10) return null;
  let fallback: ChallengeWindow | null = null;
  for (let tries = 0; tries < 240; tries++) {
    const start = 1 + Math.floor(rng() * (bars.length - size - 2));
    const end = start + size;
    let maint = 0;
    for (let i = start; i < end; i++) if (info[i]?.tag === 'maintenance') maint++;
    if (maint > 0) continue;
    const scenario = classifyWindow(bars.slice(start, end));
    const w = { start, end, scenario };
    if (!opts.scenario || scenario === opts.scenario) return w;
    fallback = w;
  }
  return fallback;
}

export interface DayWindow extends ChallengeWindow {
  /** ET date (yyyymmdd) every bar in the window belongs to. */
  dayKey: number;
  /**
   * Index where display-only context begins (prior day + overnight tape for
   * pre-market analysis). Trading — and the engine — starts at `start`.
   */
  contextStart: number;
}

/**
 * Pick a FULL RTH session (9:30–16:00 ET) as a campaign "trading day", so the
 * day maps 1:1 to the engine's daily-loss roll and the trader plays the whole
 * session, not a random slice of it. `contextBars` of prior tape are attached
 * for pre-market analysis (charts only — never fed to the engine). Days
 * already played can be excluded; falls back to a repeat day, then to an
 * off-scenario day, rather than returning null on a stocked tape.
 */
export function pickDayWindow(
  bars: Candle[],
  info: BarSessionInfo[],
  opts: {
    scenario?: ScenarioType | null;
    excludeDayKeys?: number[];
    rng?: () => number;
    contextBars?: number;
    /** Sessions shorter than this (series edges, holidays) are skipped. */
    minDayBars?: number;
  } = {},
): DayWindow | null {
  const rng = opts.rng ?? Math.random;
  const ctx = Math.max(0, opts.contextBars ?? 0);
  const minDay = opts.minDayBars ?? 200;
  const excluded = new Set(opts.excludeDayKeys ?? []);

  // contiguous RTH runs, one per ET day
  const sessions: { from: number; to: number }[] = [];
  let cur: { from: number; to: number; key: number } | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (info[i]?.tag !== 'rth') continue;
    const key = etDateNum(toET(bars[i].t));
    if (cur && cur.key === key) cur.to = i;
    else {
      if (cur) sessions.push({ from: cur.from, to: cur.to });
      cur = { from: i, to: i, key };
    }
  }
  if (cur) sessions.push({ from: cur.from, to: cur.to });

  const candidates = sessions.filter((s) => s.to - s.from + 1 >= minDay);
  if (!candidates.length) return null;

  // visit sessions in rng order so repeat days vary
  const order = candidates.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  let offScenario: DayWindow | null = null;
  let repeatDay: DayWindow | null = null;
  for (const idx of order) {
    const s = candidates[idx];
    const start = s.from;
    const end = s.to + 1;
    const dayKey = etDateNum(toET(bars[start].t));
    const scenario = classifyWindow(bars.slice(start, end));
    const w: DayWindow = { start, end, scenario, dayKey, contextStart: Math.max(0, start - ctx) };
    if (excluded.has(dayKey)) {
      repeatDay = repeatDay ?? w;
      continue;
    }
    if (!opts.scenario || scenario === opts.scenario) return w;
    offScenario = offScenario ?? w;
  }
  return offScenario ?? repeatDay;
}

// ---------------------------------------------------------------------------
// Campaign: one evaluation spanning multiple replay "days"

/**
 * A persistable multi-day evaluation: the engine state plus which tape days
 * have been played. Plain data, safe to JSON round-trip.
 */
export interface Campaign {
  state: ChallengeState;
  /** Trading days started (also the current day number while playing). */
  day: number;
  /** ET dates already played, excluded from future window picks. */
  usedDayKeys: number[];
  /** Scenario of each day played, in order. */
  scenarios: ScenarioType[];
  barsPlayedTotal: number;
  startedAt: number;
  /** User-drawn analysis levels (prices), kept across days until reset. */
  keyLevels?: number[];
  /** Optional user-given names aligned with keyLevels ('' = unnamed). */
  keyLevelNames?: string[];
}

export function createCampaign(accountSize: AccountSize, t: number, rules?: ChallengeRules): Campaign {
  return {
    state: createChallenge(accountSize, rules ?? CAMPAIGN_PRESETS[accountSize]),
    day: 0,
    usedDayKeys: [],
    scenarios: [],
    barsPlayedTotal: 0,
    startedAt: t,
  };
}

/** Record a picked day window against the campaign before replaying it. */
export function beginCampaignDay(c: Campaign, w: DayWindow): void {
  c.day += 1;
  if (!c.usedDayKeys.includes(w.dayKey)) c.usedDayKeys.push(w.dayKey);
  c.scenarios.push(w.scenario);
}

// ---------------------------------------------------------------------------
// Persistence payloads + badges

export type AttemptResult = 'passed' | 'failed' | 'abandoned';

export interface ChallengeAttempt {
  id: string;
  t: number;
  accountSize: AccountSize;
  rulesId: string;
  scenario: ScenarioType;
  result: AttemptResult;
  failReason: FailReason | null;
  barsPlayed: number;
  finalEquity: number;
  startEquity: number;
  stats: TradeStats;
  /** Kept small — enough for review lists, not full tick replay. */
  trades: SimTrade[];
}

export function attemptFromState(
  s: ChallengeState,
  meta: { id: string; t: number; scenario: ScenarioType; barsPlayed: number },
): ChallengeAttempt {
  return {
    id: meta.id,
    t: meta.t,
    accountSize: s.accountSize,
    rulesId: s.rules.id,
    scenario: meta.scenario,
    result: s.status === 'active' ? 'abandoned' : s.status,
    failReason: s.failReason,
    barsPlayed: meta.barsPlayed,
    finalEquity: s.equity,
    startEquity: s.startEquity,
    stats: tradeStats(s.trades),
    trades: s.trades.slice(-60),
  };
}

/** Consecutive passes counting back from the most recent attempt. */
export function passedStreak(attempts: ChallengeAttempt[]): number {
  let streak = 0;
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i].result === 'passed') streak++;
    else break;
  }
  return streak;
}

export interface Badge {
  id: string;
  name: string;
  desc: string;
  earned: boolean;
}

/** Badges are derived from history — nothing extra to store or migrate. */
export function computeBadges(attempts: ChallengeAttempt[]): Badge[] {
  const passed = attempts.filter((a) => a.result === 'passed');
  const sizesPassed = new Set(passed.map((a) => a.accountSize));
  return [
    { id: 'first-pass', name: 'First Pass', desc: 'Pass your first evaluation.', earned: passed.length >= 1 },
    { id: 'back-to-back', name: 'Back-to-Back', desc: 'Pass two evaluations in a row.', earned: passedStreak(attempts) >= 2 || hasRun(attempts, 2) },
    { id: 'hat-trick', name: 'Hat Trick', desc: 'Pass three evaluations in a row.', earned: hasRun(attempts, 3) },
    { id: 'all-sizes', name: 'Full Stack', desc: 'Pass at every account size.', earned: ACCOUNT_SIZES.every((s) => sizesPassed.has(s)) },
    {
      id: 'clean-pass',
      name: 'Clean Pass',
      desc: 'Pass without a single stop-out.',
      earned: passed.some((a) => a.trades.length > 0 && a.trades.every((t) => t.reason !== 'stop')),
    },
    {
      id: 'positive-r',
      name: 'Positive Expectancy',
      desc: 'Pass with average R above +0.5.',
      earned: passed.some((a) => (a.stats.avgR ?? 0) > 0.5),
    },
  ];
}

function hasRun(attempts: ChallengeAttempt[], len: number): boolean {
  let run = 0;
  for (const a of attempts) {
    run = a.result === 'passed' ? run + 1 : 0;
    if (run >= len) return true;
  }
  return false;
}
