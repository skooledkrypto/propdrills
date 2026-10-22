import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCOUNT_SIZES,
  CAMPAIGN_PRESETS,
  MNQ_POINT_VALUE,
  SCENARIO_LABEL,
  SCENARIO_TYPES,
  attemptFromState,
  beginCampaignDay,
  challengeProgress,
  closePosition,
  computeBadges,
  createCampaign,
  dayRealizedPnls,
  openPnl,
  openPosition,
  passedStreak,
  pickDayWindow,
  step,
  type AccountSize,
  type Campaign,
  type ChallengeAttempt,
  type ChallengeState,
  type ScenarioType,
} from '../core/challenge';
import {
  FREE_CHALLENGE_ATTEMPTS,
  canPickScenario,
  canStartChallenge,
  canUseAccountSize,
  visibleHistoryCount,
} from '../core/entitlement';
import type { BarSessionInfo, Candle } from '../core/types';
import { sessionInfo, toET } from '../core/sessions';
import { generateSampleSeries } from '../core/synth';
import { buildView } from '../core/views';
import { loadBars } from '../storage/db';
import { useApp } from '../state/store';
import { CandleChart, type TradeLine, type TradeMarker, type UserMark } from '../chart/CandleChart';
import { ProUpsellCard } from './ProUpsell';
import { useEntitlement } from './purchases';

/**
 * Multi-day campaign Challenge — full parity with mobile's ChallengeScreen
 * (analysis stage, named key levels, mid-day timeframes, 1×–32× speeds) plus
 * web-only extras: single-bar stepping and keyboard shortcuts (Space = play /
 * pause, → = step one bar while paused).
 */

/** Prior tape attached for pre-market analysis (~4½ prior days + overnight). */
const CONTEXT_BARS = 6300;
/** Sim-chart candle timeframes, switchable mid-day like a real platform. */
const TFS = [
  { label: '1m', agg: 1 },
  { label: '5m', agg: 5 },
  { label: '15m', agg: 15 },
] as const;
/** Visible-span bounds: 35–400 candles — a browser canvas can afford the top end. */
const spanBounds = (agg: number): [number, number] => [agg * 35, agg * 400];
const SPAN_RATIO = 1.3; // per zoom-button step
/** Pre-market analysis look-back presets (span only — timeframe follows). */
const ANA_PRESETS = [
  { key: '4h', mins: 240 },
  { key: '12h', mins: 720 },
  { key: '2d', mins: 2880 },
  { key: '4d', mins: 5760 },
] as const;
const ANA_SPAN_MIN = 60;
const ANA_SPAN_MAX = CONTEXT_BARS;
/**
 * Analysis timeframe when set to Auto: the finest of 1/5/15/30m that keeps the
 * span under ~1200 candles. A browser canvas draws that easily, so 4 days
 * genuinely renders as twice the candles of 2 days instead of re-aggregating
 * both down to the same bar count (which made the presets look identical).
 */
const ANA_TFS = [0, 1, 5, 15] as const; // 0 = Auto
const anaAutoAgg = (mins: number): number => [1, 5, 15, 30].find((a) => mins / a <= 1200) ?? 30;
/** Deliberate 1× so every bar can be read; wide ladder for the impatient. */
const SPEEDS = [
  { label: '1×', ms: 2400 },
  { label: '2×', ms: 1200 },
  { label: '4×', ms: 600 },
  { label: '8×', ms: 300 },
  { label: '16×', ms: 150 },
  { label: '32×', ms: 75 },
] as const;
/** Quick names for user levels — the vocabulary we want drilled into memory. */
const LEVEL_NAMES = ['PDH', 'PDL', 'ONH', 'ONL', 'PC', 'HOD', 'LOD', 'VWAP', 'SUP', 'RES'] as const;

const fmtUsd = (n: number, signed = false) =>
  `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Desktop workspace breakpoint — must match .simgrid in styles.css. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1001px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1001px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const roomColor = (frac: number) => (frac > 0.5 ? 'var(--good)' : frac > 0.25 ? 'var(--gold)' : 'var(--bad)');

type Stage = 'setup' | 'analysis' | 'sim' | 'day-end' | 'result';

interface RunMeta {
  /** The trading day's bars — the only bars the engine ever sees. */
  bars: Candle[];
  /** Display-only prior tape (prior days + overnight) for analysis and lead-in. */
  context: Candle[];
  scenario: ScenarioType;
  dayKey: number;
}

/**
 * Replay tape: the imported real dataset when one exists, otherwise the
 * deterministic synthetic month. Cached per page load — a fresh import lands
 * on the next reload, same as the drill library.
 */
interface Dataset {
  bars: Candle[];
  info: BarSessionInfo[];
}

let datasetCache: Dataset | null = null;

async function getDataset(): Promise<Dataset> {
  if (datasetCache) return datasetCache;
  let bars: Candle[] = [];
  try {
    bars = await loadBars();
  } catch {
    bars = [];
  }
  if (bars.length < 20_000) bars = generateSampleSeries(30, 20260801, toET);
  datasetCache = { bars, info: sessionInfo(bars) };
  return datasetCache;
}

function EquityCurve({ points, start, height = 70 }: { points: { equity: number }[]; start: number; height?: number }) {
  if (points.length < 2) return null;
  const w = 640;
  const pad = 4;
  const eqs = points.map((p) => p.equity);
  const min = Math.min(...eqs, start);
  const max = Math.max(...eqs, start);
  const range = max - min || 1;
  const yOf = (v: number) => pad + (height - 2 * pad) * (1 - (v - min) / range);
  const pts = eqs
    .map((v, i) => `${(pad + (i / (eqs.length - 1)) * (w - 2 * pad)).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ');
  const last = eqs[eqs.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', display: 'block', marginTop: 8 }} role="img" aria-label="equity curve">
      <line x1={0} x2={w} y1={yOf(start)} y2={yOf(start)} style={{ stroke: 'var(--line)' }} strokeDasharray="4 4" />
      <polyline points={pts} fill="none" style={{ stroke: last >= start ? 'var(--good)' : 'var(--bad)' }} strokeWidth={1.8} />
    </svg>
  );
}

/** Objective/limit bar: label · fill · value. Self-explanatory at a glance. */
function Meter({ label, frac, text, color }: { label: string; frac: number; text: string; color: string }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
      <span className="muted" style={{ fontSize: 9.5, width: 66, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>
        {label}
      </span>
      <div className="bar" style={{ flex: 1 }}>
        <i style={{ width: `${f * 100}%`, background: color }} />
      </div>
      <b style={{ fontSize: 11.5, whiteSpace: 'nowrap', minWidth: 88, textAlign: 'right' }}>{text}</b>
    </div>
  );
}

/** Time-to-next-bar strip: ET clock + bar-close countdown, TradingView-style. */
function BarCountdown({ msPerBar, playing, cursor, lastT }: { msPerBar: number; playing: boolean; cursor: number; lastT: number }) {
  const [frac, setFrac] = useState(0);
  useEffect(() => {
    if (!playing) {
      setFrac(0);
      return;
    }
    const t0 = Date.now();
    setFrac(0);
    const iv = setInterval(() => setFrac(Math.min(1, (Date.now() - t0) / msPerBar)), 125);
    return () => clearInterval(iv);
  }, [playing, cursor, msPerBar]);
  const p = toET(lastT);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span className="muted" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
        {String(p.hh).padStart(2, '0')}:{String(p.mm).padStart(2, '0')} ET
      </span>
      <div className="bar" style={{ flex: 1, height: 3 }}>
        <i style={{ width: `${(playing ? frac : 0) * 100}%`, background: 'var(--info)' }} />
      </div>
      <span className="muted" style={{ fontSize: 10 }}>next bar</span>
    </div>
  );
}

/** The key-levels menu: name, place, and manage user levels. */
function LevelEditor({
  levels,
  names,
  sel,
  onSelect,
  onAdd,
  addDisabled,
  onRemove,
  onRename,
  onDone,
}: {
  levels: number[];
  names: string[];
  sel: number | null;
  onSelect: (i: number) => void;
  onAdd: () => void;
  addDisabled: boolean;
  onRemove: () => void;
  onRename: (name: string) => void;
  onDone?: () => void;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b style={{ fontSize: 13 }}>Key levels</b>
        <span className="muted small">{levels.length}/8</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
        {levels.map((p, i) => (
          <button
            key={i}
            className={sel === i ? 'nextbtn' : 'ghostbtn'}
            style={{ marginTop: 0, padding: '6px 10px' }}
            onClick={() => onSelect(i)}
          >
            {names[i]?.trim() || `L${i + 1}`} · {p.toFixed(0)}
          </button>
        ))}
        <button className="ghostbtn" onClick={onAdd} disabled={addDisabled} style={{ padding: '6px 10px' }}>
          ＋ Add
        </button>
      </div>
      {levels.length === 0 && (
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          Click the chart where a level belongs — the line drops right there.
        </p>
      )}
      {sel !== null && sel < levels.length && (
        <div className="reveal" style={{ marginTop: 8 }}>
          <p className="muted small" style={{ margin: '0 0 6px' }}>
            Name it — what is {names[sel]?.trim() || `L${sel + 1}`} at {levels[sel].toFixed(2)}?
          </p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {LEVEL_NAMES.map((n) => (
              <button
                key={n}
                className={names[sel]?.trim() === n ? 'nextbtn' : 'ghostbtn'}
                style={{ marginTop: 0, padding: '5px 9px' }}
                onClick={() => onRename(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={names[sel] ?? ''}
              onChange={(e) => onRename(e.target.value.slice(0, 8).toUpperCase())}
              placeholder="Custom name"
              maxLength={8}
              style={{ flex: 1 }}
            />
            <button className="ghostbtn danger" onClick={onRemove}>🗑</button>
          </div>
        </div>
      )}
      <p className="muted small" style={{ margin: '7px 0 0' }}>
        Click the chart to drop a level, click a line or chip to select, drag the selected line to
        fine-tune. Levels and names stay for the whole evaluation.
      </p>
      {onDone && (
        <button className="nextbtn" style={{ marginTop: 8 }} onClick={onDone}>
          Done
        </button>
      )}
    </div>
  );
}

const Disclaimer = (
  <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 11, lineHeight: 1.5 }}>
    Simulated, hypothetical trading for education only — no real money, no brokerage connection,
    not financial advice. Simulated results do not reflect real trading. Generic evaluation rules;
    not affiliated with any prop trading firm.
  </p>
);

export function Challenge() {
  const { challengeAttempts, addChallengeAttempt, campaign, saveCampaign, openPaywall } = useApp();
  const isPro = useEntitlement();
  const wide = useWide();

  const [stage, setStage] = useState<Stage>('setup');
  const [size, setSize] = useState<AccountSize>(50000);
  const [scenario, setScenario] = useState<ScenarioType | null>(null);
  const [loading, setLoading] = useState(false);

  const campRef = useRef<Campaign | null>(null);
  const runRef = useRef<RunMeta | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [tfIdx, setTfIdx] = useState(0); // sim candle timeframe (1m/5m/15m)
  const [spanMins, setSpanMins] = useState(110); // sim visible span
  const [anaSpan, setAnaSpan] = useState(2880); // analysis look-back
  const [anaTf, setAnaTf] = useState<(typeof ANA_TFS)[number]>(0); // analysis TF, 0 = Auto
  const [, setTick] = useState(0); // engine mutates in place; tick forces render

  const [qty, setQty] = useState(2);
  const [stopPts, setStopPts] = useState(10);
  const [targetPts, setTargetPts] = useState(20);
  const [lastAttempt, setLastAttempt] = useState<ChallengeAttempt | null>(null);

  // user-drawn analysis levels (+ names) — live on the campaign so they
  // survive reloads
  const [keyLevels, setKeyLevels] = useState<number[]>([]);
  const [keyNames, setKeyNames] = useState<string[]>([]);
  const [selLevel, setSelLevel] = useState<number | null>(null);
  const [editLevels, setEditLevels] = useState(false);

  const attemptsUsed = challengeAttempts.length;

  const syncLevels = useCallback((levels: number[], names: string[]) => {
    setKeyLevels(levels);
    setKeyNames(names);
    if (campRef.current) {
      campRef.current.keyLevels = levels;
      campRef.current.keyLevelNames = names;
    }
  }, []);

  // ---- campaign day lifecycle -------------------------------------------

  const startDay = useCallback(async () => {
    let camp: Campaign;
    if (campaign) {
      // resume: work on a clone so an interrupted day replays from its start
      camp = clone(campaign);
    } else {
      const gate = canStartChallenge(isPro, attemptsUsed);
      if (!gate.allowed) {
        openPaywall();
        return;
      }
      camp = createCampaign(size, Date.now());
    }
    setLoading(true);
    const ds = await getDataset();
    const w = pickDayWindow(ds.bars, ds.info, {
      scenario,
      contextBars: CONTEXT_BARS,
      excludeDayKeys: camp.usedDayKeys,
    });
    setLoading(false);
    if (!w) return;
    beginCampaignDay(camp, w);
    saveCampaign(clone(camp)); // day-start snapshot survives a reload
    runRef.current = {
      bars: ds.bars.slice(w.start, w.end),
      context: ds.bars.slice(w.contextStart, w.start),
      scenario: w.scenario,
      dayKey: w.dayKey,
    };
    campRef.current = camp;
    setKeyLevels(camp.keyLevels ?? []);
    setKeyNames(camp.keyLevelNames ?? []);
    setSelLevel(null);
    setEditLevels(false);
    setCursor(0);
    setPlaying(false);
    setStage('analysis');
  }, [attemptsUsed, campaign, isPro, openPaywall, saveCampaign, scenario, size]);

  /** Leave the pre-market analysis view; the tape waits for ▶ Play. */
  const startTrading = useCallback(() => {
    if (campRef.current) saveCampaign(clone(campRef.current));
    setSelLevel(null);
    setEditLevels(false);
    setPlaying(false);
    setStage('sim');
  }, [saveCampaign]);

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  /** Campaign is over (passed/failed/reset): record the attempt, clear it. */
  const terminal = useCallback(
    (camp: Campaign, abandoned = false) => {
      const eng = camp.state;
      setPlaying(false);
      if (eng.position) closePosition(eng, eng.lastPrice, eng.lastT, 'end');
      eng.equity = eng.startEquity + eng.realized;
      const attempt = attemptFromState(eng, {
        id: `ch-${Date.now().toString(36)}`,
        t: Date.now(),
        scenario: camp.scenarios[camp.scenarios.length - 1] ?? 'chop',
        barsPlayed: camp.barsPlayedTotal,
      });
      if (abandoned && attempt.result !== 'passed' && attempt.result !== 'failed') attempt.result = 'abandoned';
      addChallengeAttempt(attempt);
      setLastAttempt(attempt);
      campRef.current = null;
      saveCampaign(null);
      setStage('result');
    },
    [addChallengeAttempt, saveCampaign],
  );

  /** Flatten and close out the current replay day; campaign continues. */
  const endDay = useCallback(() => {
    const camp = campRef.current;
    if (!camp) return;
    const eng = camp.state;
    setPlaying(false);
    if (eng.position) {
      closePosition(eng, eng.lastPrice, eng.lastT, 'end');
      // re-mark + re-check rules — the forced flat can still breach a limit
      step(eng, { t: eng.lastT, o: eng.lastPrice, h: eng.lastPrice, l: eng.lastPrice, c: eng.lastPrice, v: 0 });
    }
    camp.barsPlayedTotal += Math.max(0, cursorRef.current);
    if (eng.status !== 'active') {
      terminal(camp);
      return;
    }
    saveCampaign(camp);
    setStage('day-end');
  }, [saveCampaign, terminal]);

  const resetCampaign = useCallback(() => {
    if (!window.confirm('Reset challenge?\n\nThis abandons the current evaluation. If you placed any trades it is recorded as an abandoned attempt.')) return;
    const camp = campRef.current ?? (campaign ? clone(campaign) : null);
    if (camp && camp.state.trades.length > 0) {
      camp.barsPlayedTotal += stage === 'sim' ? Math.max(0, cursorRef.current) : 0;
      terminal(camp, true);
      return;
    }
    campRef.current = null;
    saveCampaign(null);
    setPlaying(false);
    setStage('setup');
  }, [campaign, saveCampaign, stage, terminal]);

  // ---- replay loop -------------------------------------------------------

  /** Advance exactly one bar — shared by the interval and the ⏭ step button. */
  const advanceBar = useCallback(() => {
    const camp = campRef.current;
    const run = runRef.current;
    if (!camp || !run) return;
    const eng = camp.state;
    const i = cursorRef.current;
    if (i >= run.bars.length) {
      endDay();
      return;
    }
    step(eng, run.bars[i]);
    setCursor(i + 1);
    setTick((t) => t + 1);
    if (eng.status !== 'active') {
      camp.barsPlayedTotal += i + 1;
      terminal(camp);
    }
  }, [endDay, terminal]);

  useEffect(() => {
    if (stage !== 'sim' || !playing) return;
    const iv = setInterval(advanceBar, SPEEDS[speedIdx].ms);
    return () => clearInterval(iv);
  }, [stage, playing, speedIdx, advanceBar]);

  // web extra: keyboard shortcuts — Space play/pause, → steps one bar
  useEffect(() => {
    if (stage !== 'sim') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === 'ArrowRight' && !playing) {
        e.preventDefault();
        advanceBar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, playing, advanceBar]);

  // ---- trading actions ---------------------------------------------------

  const eng: ChallengeState | null = campRef.current ? campRef.current.state : null;
  const run = runRef.current;
  const price = eng?.lastPrice ?? 0;

  const enter = (side: 'long' | 'short') => {
    // cursor 0 = no bar replayed yet, so the engine has no price to fill at
    if (!eng || eng.status !== 'active' || eng.position || cursorRef.current === 0) return;
    const stop = stopPts > 0 ? (side === 'long' ? price - stopPts : price + stopPts) : null;
    const target = targetPts > 0 ? (side === 'long' ? price + targetPts : price - targetPts) : null;
    openPosition(eng, side, qty, price, eng.lastT, { stop, target });
    setTick((t) => t + 1);
  };

  const flatten = () => {
    if (!eng?.position) return;
    closePosition(eng, price, eng.lastT, 'manual');
    step(eng, { t: eng.lastT, o: price, h: price, l: price, c: price, v: 0 }); // re-mark + re-check rules
    setTick((t) => t + 1);
  };

  // ---- zoom + timeframe --------------------------------------------------

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const [lo, hi] = spanBounds(TFS[tfIdx].agg);
      setSpanMins((s) => Math.min(hi, Math.max(lo, dir > 0 ? s / SPAN_RATIO : s * SPAN_RATIO)));
    },
    [tfIdx],
  );

  const pickTf = (i: number) => {
    // switching timeframe keeps the candle COUNT (the visual zoom level), with
    // a 180-candle floor so higher TFs come up slim with plenty of context —
    // 1m → 5m shows ≥5× more time, never the same span as a few huge bars
    const count = Math.max(180, spanMins / TFS[tfIdx].agg);
    setTfIdx(i);
    const [lo, hi] = spanBounds(TFS[i].agg);
    setSpanMins(Math.min(hi, Math.max(lo, count * TFS[i].agg)));
  };

  const anaZoom = (dir: 1 | -1) =>
    setAnaSpan((s) => Math.min(ANA_SPAN_MAX, Math.max(ANA_SPAN_MIN, dir > 0 ? s / SPAN_RATIO : s * SPAN_RATIO)));

  // ---- key-level helpers shared by the analysis and sim stages ----------

  const addLevelAt = (p: number) => {
    if (keyLevels.length >= 8) return;
    syncLevels([...keyLevels, Math.round(p * 4) / 4], [...keyNames, '']);
    setSelLevel(keyLevels.length);
  };

  /** Click near an existing level selects it; anywhere else drops a new one. */
  const tapLevel = (viewBars: Candle[]) => (p: number) => {
    if (!viewBars.length) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of viewBars) {
      lo = Math.min(lo, b.l);
      hi = Math.max(hi, b.h);
    }
    const tol = Math.max((hi - lo) * 0.04, 2);
    let best = -1;
    let bestD = tol;
    keyLevels.forEach((v, i) => {
      const d = Math.abs(v - p);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) setSelLevel(best);
    else addLevelAt(p);
  };

  const removeSelLevel = () => {
    if (selLevel === null) return;
    syncLevels(
      keyLevels.filter((_, i) => i !== selLevel),
      keyNames.filter((_, i) => i !== selLevel),
    );
    setSelLevel(null);
  };

  const renameSelLevel = (name: string) => {
    if (selLevel === null) return;
    const names = [...keyNames];
    while (names.length < keyLevels.length) names.push('');
    names[selLevel] = name;
    syncLevels(keyLevels, names);
  };

  const levelMarks: UserMark[] = keyLevels.map((p, i) => ({
    price: p,
    label: `${keyNames[i]?.trim() || `L${i + 1}`} ${p.toFixed(0)}`,
  }));

  // ---- SETUP -------------------------------------------------------------

  if (stage === 'setup') {
    const badges = computeBadges(challengeAttempts);
    const streak = passedStreak(challengeAttempts);
    const visible = visibleHistoryCount(isPro, challengeAttempts.length);
    const history = challengeAttempts.slice(-visible).reverse();
    const resume = campaign;
    const rules = resume ? resume.state.rules : CAMPAIGN_PRESETS[size];
    const cap = rules.consistencyPct ? rules.consistencyPct * rules.profitTarget : null;
    const resumeProg = resume ? challengeProgress(resume.state) : null;

    return (
      <section>
        {resume && resumeProg && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <h2>Evaluation in progress — Day {resume.day} played</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <div className="stat"><div className="n">{fmtUsd(resume.state.equity)}</div><div className="l">Equity</div></div>
              <div className="stat gold"><div className="n">{fmtUsd(resumeProg.toTarget)}</div><div className="l">To target</div></div>
              <div className="stat"><div className="n">{`${resumeProg.daysTraded}/${resumeProg.minDays}`}</div><div className="l">Days traded</div></div>
            </div>
            {resumeProg.effectiveTarget > resumeProg.target && (
              <p className="muted small" style={{ color: 'var(--gold)' }}>
                Consistency rule raised your target to {fmtUsd(resumeProg.effectiveTarget)} (best day{' '}
                {fmtUsd(resumeProg.bestDay)} is over the {fmtUsd(resumeProg.consistencyCap ?? 0)} cap).
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className="nextbtn" style={{ flex: 1, marginTop: 0 }} onClick={() => void startDay()} disabled={loading}>
                {loading ? 'Loading tape…' : `▶ Trade day ${resume.day + 1}`}
              </button>
              <button className="ghostbtn danger" onClick={resetCampaign}>Reset</button>
            </div>
          </div>
        )}

        <div className="card">
          <h2>{resume ? 'Evaluation rules' : 'Challenge Mode — simulated evaluation'}</h2>
          <p className="muted small">
            A prop-style evaluation over multiple replayed trading days. One rule: never breach a
            loss limit. Two objectives: hit the target, and build it consistently.
          </p>

          {!resume && (
            <>
              <div className="field"><div className="lab">Account size</div></div>
              <div className="chips">
                {ACCOUNT_SIZES.map((s) => {
                  const locked = !canUseAccountSize(isPro, s).allowed;
                  return (
                    <button
                      key={s}
                      className={size === s ? 'chipbtn active' : 'chipbtn'}
                      onClick={() => {
                        if (locked) {
                          openPaywall();
                          return;
                        }
                        setSize(s);
                      }}
                    >
                      ${s / 1000}k{locked ? ' 🔒' : ''}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <div className="lab">Next day's tape{isPro ? '' : ' (Pro picks the tape)'}</div>
          </div>
          <div className="chips">
            <button className={scenario === null ? 'chipbtn active' : 'chipbtn'} onClick={() => setScenario(null)}>
              Any
            </button>
            {SCENARIO_TYPES.map((sc) => (
              <button
                key={sc}
                className={scenario === sc ? 'chipbtn active' : 'chipbtn'}
                onClick={() => {
                  if (!canPickScenario(isPro, sc).allowed) {
                    openPaywall();
                    return;
                  }
                  setScenario(sc);
                }}
              >
                {SCENARIO_LABEL[sc]}{isPro ? '' : ' 🔒'}
              </button>
            ))}
          </div>

          <div className="reveal" style={{ marginTop: 14 }}>
            <b>{rules.name}</b>
            <div className="muted small" style={{ marginTop: 4 }}>
              ⛔ Trailing max drawdown {fmtUsd(rules.trailingMaxDrawdown)} · daily loss limit{' '}
              {fmtUsd(rules.dailyLossLimit)}
            </div>
            <div className="muted small">
              🎯 Profit target {fmtUsd(rules.profitTarget)}
              {cap !== null ? ` · best day ≤ ${fmtUsd(cap)}` : ''}
              {rules.minTradingDays ? ` · ${rules.minTradingDays}+ trading days` : ''}
            </div>
            {(rules.commissionPerSide ?? 0) > 0 && (
              <div className="muted small">
                💸 Live-market friction: ${(rules.commissionPerSide ?? 0).toFixed(2)}/side commission ·{' '}
                {rules.slippageTicks ?? 0}-tick slippage on market fills
              </div>
            )}
            <div className="muted small" style={{ marginTop: 4, fontSize: 11 }}>
              A big day doesn't fail you — it raises your target until the rest of your trading
              backs it up. Play one day at a time; your account carries over. Reset any time.
            </div>
          </div>

          {!isPro && (
            <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
              Free preview: {Math.max(0, FREE_CHALLENGE_ATTEMPTS - attemptsUsed)} of{' '}
              {FREE_CHALLENGE_ATTEMPTS} evaluations left · $50k size only.
            </p>
          )}
          {!resume && (
            <div style={{ marginTop: 12 }}>
              <button className="nextbtn" onClick={() => void startDay()} disabled={loading}>
                {loading ? 'Loading tape…' : 'Start evaluation'}
              </button>
            </div>
          )}
          {Disclaimer}
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>History</h2>
            <span className={streak > 0 ? 'pill gold' : 'pill'}>pass streak {streak}</span>
          </div>
          <div className="chips" style={{ margin: '10px 0 6px' }}>
            {badges.map((b) => (
              <span key={b.id} className={b.earned ? 'chip gold' : 'chip'} title={b.desc}>
                {b.earned ? '🏅 ' : ''}{b.name}
              </span>
            ))}
          </div>
          {history.length === 0 && <p className="muted">No attempts yet — your results and badges land here.</p>}
          {history.map((a) => (
            <div key={a.id} className="attempt-row">
              <span
                style={{
                  color: a.result === 'passed' ? 'var(--good)' : a.result === 'failed' ? 'var(--bad)' : 'var(--muted)',
                  fontWeight: 700,
                }}
              >
                {a.result === 'passed' ? '✓ PASS' : a.result === 'failed' ? '✗ FAIL' : '– QUIT'}
              </span>
              <span className="muted">
                {'  '}${a.accountSize / 1000}k · {SCENARIO_LABEL[a.scenario]}
                {a.failReason ? ` · ${a.failReason === 'daily-loss' ? 'daily loss' : 'trailing DD'}` : ''}
              </span>
              <div className="muted small">
                {new Date(a.t).toLocaleDateString()} · {a.stats.n} trades · {fmtUsd(a.finalEquity - a.startEquity, true)}
                {a.stats.avgR !== null ? ` · avg ${a.stats.avgR.toFixed(2)}R` : ''}
              </div>
            </div>
          ))}
          {!isPro && challengeAttempts.length > visible && (
            <button className="ghostbtn" style={{ marginTop: 10 }} onClick={openPaywall}>
              Unlock full history ({challengeAttempts.length} attempts) — Pro
            </button>
          )}
        </div>
        <ProUpsellCard />
      </section>
    );
  }

  // ---- PRE-MARKET ANALYSIS ----------------------------------------------

  if (stage === 'analysis' && eng && run && campRef.current) {
    const camp = campRef.current;
    const prog = challengeProgress(eng);
    const ctx = run.context;
    const anaMins = Math.round(anaSpan);
    const anaAgg = anaTf === 0 ? anaAutoAgg(anaMins) : anaTf;
    const viewBars = ctx.length ? buildView(ctx, ctx.length - 1, { mins: anaMins, agg: anaAgg }) : [];
    const lastCtxClose = ctx.length ? ctx[ctx.length - 1].c : 0;
    const p0 = toET(run.bars[0].t);

    return (
      <section>
        <div className="card">
          <h2>Day {camp.day} — pre-market prep</h2>
          <p className="muted small">
            The session opens {String(p0.hh).padStart(2, '0')}:{String(p0.mm).padStart(2, '0')} ET.
            Study the prior days and overnight tape, mark your key levels, then start the day.
            You'll trade the full session — open to close.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div className="stat"><div className="n">{fmtUsd(eng.equity)}</div><div className="l">Equity</div></div>
            <div className="stat gold"><div className="n">{fmtUsd(prog.toTarget)}</div><div className="l">To target</div></div>
            <div className="stat"><div className="n">{`${prog.daysTraded}/${prog.minDays}`}</div><div className="l">Days traded</div></div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {ANA_PRESETS.map((v) => (
              <button
                key={v.key}
                className={Math.abs(anaSpan - v.mins) < 1 ? 'nextbtn' : 'ghostbtn'}
                style={{ marginTop: 0, padding: '6px 14px' }}
                onClick={() => setAnaSpan(v.mins)}
              >
                {v.key}
              </button>
            ))}
            <button className="ghostbtn" style={{ padding: '6px 10px' }} onClick={() => anaZoom(-1)}>🔍−</button>
            <button className="ghostbtn" style={{ padding: '6px 10px' }} onClick={() => anaZoom(1)}>🔍+</button>
            <span style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
              {ANA_TFS.map((tf) => (
                <button
                  key={tf}
                  className={anaTf === tf ? 'nextbtn' : 'ghostbtn'}
                  style={{ marginTop: 0, padding: '6px 10px' }}
                  onClick={() => setAnaTf(tf)}
                >
                  {tf === 0 ? 'Auto' : `${tf}m`}
                </button>
              ))}
            </span>
            <span className="muted small">
              {anaAgg}m bars · {viewBars.length} candles
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            <CandleChart
              bars={viewBars}
              userMarks={levelMarks}
              dragIndex={selLevel}
              onMarkMove={(i, p) => syncLevels(keyLevels.map((v, j) => (j === i ? Math.round(p * 4) / 4 : v)), keyNames)}
              onPriceClick={tapLevel(viewBars)}
              height={wide ? 520 : 420}
              showTime
            />
          </div>

          <LevelEditor
            levels={keyLevels}
            names={keyNames}
            sel={selLevel}
            onSelect={(i) => setSelLevel(i)}
            onAdd={() => addLevelAt(lastCtxClose)}
            addDisabled={keyLevels.length >= 8 || !ctx.length}
            onRemove={removeSelLevel}
            onRename={renameSelLevel}
          />

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="nextbtn" style={{ flex: 1, marginTop: 0 }} onClick={startTrading}>
              ▶ Start trading day
            </button>
            <button className="ghostbtn danger" onClick={resetCampaign}>Reset</button>
          </div>
          {Disclaimer}
        </div>
      </section>
    );
  }

  // ---- SIM ---------------------------------------------------------------

  if (stage === 'sim' && eng && run && campRef.current) {
    const camp = campRef.current;
    // prior tape leads in behind the replayed day bars, then scrolls off;
    // the visible window rolls 1-min source bars up to the chosen timeframe
    const withContext = [...run.context, ...run.bars.slice(0, cursor)];
    const visibleBars = buildView(withContext, withContext.length - 1, {
      mins: Math.round(spanMins),
      agg: TFS[tfIdx].agg,
    });
    const pnl = openPnl(eng);
    const pos = eng.position;
    const prog = challengeProgress(eng);

    // rule levels in PRICE terms — only defined while a position is open
    const tradeLines: TradeLine[] = [];
    if (pos) {
      tradeLines.push({ price: pos.entry, kind: 'entry', label: `entry ${fmtUsd(pnl, true)}` });
      if (pos.stop !== null) tradeLines.push({ price: pos.stop, kind: 'stop' });
      if (pos.target !== null) tradeLines.push({ price: pos.target, kind: 'target' });
      const base = eng.startEquity + eng.realized;
      const dir = pos.side === 'long' ? 1 : -1;
      const perPt = MNQ_POINT_VALUE * pos.qty;
      const failEq = Math.max(prog.ddFailEquity, prog.dayFailEquity);
      tradeLines.push({ price: pos.entry + (dir * (failEq - base)) / perPt, kind: 'fail', label: '⛔ liq' });
      tradeLines.push({
        price: pos.entry + (dir * (eng.startEquity + prog.effectiveTarget - base)) / perPt,
        kind: 'goal',
        label: '🎯 pass',
      });
    }

    // entry/exit markers for every trade this day + the open position
    const tradeMarkers: TradeMarker[] = [];
    for (const tr of eng.trades) {
      tradeMarkers.push({ t: tr.entryT, kind: tr.side === 'long' ? 'buy' : 'sell' });
      tradeMarkers.push({ t: tr.exitT, kind: 'exit', win: tr.pnl >= 0 });
    }
    if (pos) tradeMarkers.push({ t: pos.entryT, kind: pos.side === 'long' ? 'buy' : 'sell' });

    const targetFrac = prog.effectiveTarget > 0 ? prog.profit / prog.effectiveTarget : 0;
    const ddFrac = prog.ddRoom / eng.rules.trailingMaxDrawdown;
    const dayFrac = prog.dayRoom / eng.rules.dailyLossLimit;
    // firm-dashboard numbers: closed balance vs marked equity, and the hard
    // equity level that ends the account right now (nearer of the two rules)
    const balance = eng.startEquity + eng.realized;
    const liqAt = Math.max(prog.ddFailEquity, prog.dayFailEquity);
    const liqRoom = Math.max(0, Math.min(prog.ddRoom, prog.dayRoom));
    const dangerFrac = Math.min(ddFrac, dayFrac);
    const evalFees = eng.trades.reduce((a, t) => a + (t.fees ?? 0), 0);
    const hasCosts = (eng.rules.commissionPerSide ?? 0) > 0 || (eng.rules.slippageTicks ?? 0) > 0;
    const recentFills = eng.trades.slice(-6).reverse();

    const chart = (
      <CandleChart
        bars={visibleBars}
        tradeLines={tradeLines}
        tradeMarkers={tradeMarkers}
        userMarks={levelMarks}
        dragIndex={editLevels ? selLevel : null}
        onMarkMove={
          editLevels
            ? (i, p) => syncLevels(keyLevels.map((v, j) => (j === i ? Math.round(p * 4) / 4 : v)), keyNames)
            : undefined
        }
        onPriceClick={editLevels ? tapLevel(visibleBars) : undefined}
        height={wide ? 540 : 420}
        showTime
      />
    );

    return (
      <section>
        <div className="card">
          <div className="simgrid">
            <div>
              {chart}
              {!editLevels && (
                <>
                  <BarCountdown msPerBar={SPEEDS[speedIdx].ms} playing={playing} cursor={cursor} lastT={eng.lastT} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                    <button className={playing ? 'ghostbtn' : 'nextbtn'} style={{ marginTop: 0 }} onClick={() => setPlaying((p) => !p)}>
                      {playing ? '⏸ Pause' : '▶ Play'}
                    </button>
                    <button className="ghostbtn" onClick={advanceBar} disabled={playing} title="Step one bar (→)">
                      ⏭ Bar
                    </button>
                    <button className="ghostbtn" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
                      Speed {SPEEDS[speedIdx].label}
                    </button>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {TFS.map((tf, i) => (
                        <button key={tf.label} className={tfIdx === i ? 'nextbtn' : 'ghostbtn'} style={{ marginTop: 0, padding: '6px 10px' }} onClick={() => pickTf(i)}>
                          {tf.label}
                        </button>
                      ))}
                    </span>
                    <button className="ghostbtn" style={{ padding: '6px 10px' }} onClick={() => zoomStep(-1)}>🔍−</button>
                    <button className="ghostbtn" style={{ padding: '6px 10px' }} onClick={() => zoomStep(1)}>🔍+</button>
                    <button
                      className="ghostbtn"
                      onClick={() => {
                        setPlaying(false);
                        setEditLevels(true);
                        if (keyLevels.length > 0) setSelLevel(0);
                      }}
                    >
                      ✏️ Levels
                    </button>
                    <button className="ghostbtn" onClick={endDay}>End day</button>
                    <button className="ghostbtn danger" onClick={resetCampaign}>Reset</button>
                  </div>
                  <p className="muted small" style={{ margin: '6px 0 0' }}>
                    Space = play/pause · → = step one bar while paused
                  </p>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    {SCENARIO_LABEL[run.scenario]} tape · bar {cursor}/{run.bars.length} · Day {camp.day} ·{' '}
                    $2/pt per contract
                  </p>
                </>
              )}
            </div>

            {editLevels ? (
              <div className="simrail">
                <LevelEditor
                  levels={keyLevels}
                  names={keyNames}
                  sel={selLevel}
                  onSelect={(i) => setSelLevel(i)}
                  onAdd={() => addLevelAt(price)}
                  addDisabled={keyLevels.length >= 8}
                  onRemove={removeSelLevel}
                  onRename={renameSelLevel}
                  onDone={() => {
                    setEditLevels(false);
                    setSelLevel(null);
                    saveCampaign(clone(camp));
                  }}
                />
              </div>
            ) : (
              <div className="simrail">
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div className="stat"><div className="n">{fmtUsd(balance)}</div><div className="l">Balance</div></div>
                  <div className="stat"><div className="n">{fmtUsd(eng.equity)}</div><div className="l">Open equity</div></div>
                  <div className="stat"><div className="n">{pos ? `${pnl >= 0 ? '▲' : '▼'}${fmtUsd(pnl, true)}` : '—'}</div><div className="l">Open P&amp;L</div></div>
                  <div className="stat"><div className="n">{`${prog.daysTraded}/${prog.minDays}`}</div><div className="l">Days traded</div></div>
                </div>
                <p className="muted small" style={{ margin: '8px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                  ⛔ Liquidates at <b style={{ color: 'var(--bad)' }}>{fmtUsd(liqAt)}</b> — {fmtUsd(liqRoom)} of room
                </p>
                {dangerFrac < 0.25 && (
                  <div className="liq-banner">⚠ {fmtUsd(liqRoom)} from liquidation — protect the account.</div>
                )}

                <Meter
                  label="Target"
                  frac={targetFrac}
                  text={`${fmtUsd(Math.max(0, prog.profit))} / ${fmtUsd(prog.effectiveTarget)}`}
                  color="var(--accent)"
                />
                <Meter label="DD room" frac={ddFrac} text={fmtUsd(Math.max(0, prog.ddRoom))} color={roomColor(ddFrac)} />
                <Meter label="Day room" frac={dayFrac} text={fmtUsd(Math.max(0, prog.dayRoom))} color={roomColor(dayFrac)} />
                {prog.consistencyCap !== null && (
                  <Meter
                    label="Best day"
                    frac={prog.bestDay / prog.consistencyCap}
                    text={`${fmtUsd(prog.bestDay)} / ${fmtUsd(prog.consistencyCap)}`}
                    color={
                      prog.bestDay > prog.consistencyCap
                        ? 'var(--bad)'
                        : prog.bestDay > prog.consistencyCap * 0.8
                          ? 'var(--gold)'
                          : 'var(--info)'
                    }
                  />
                )}
                {prog.effectiveTarget > prog.target && (
                  <p className="muted small" style={{ color: 'var(--gold)', margin: '4px 0 0' }}>
                    ⚠ Best day over the consistency cap — target raised to {fmtUsd(prog.effectiveTarget)}.
                  </p>
                )}

                <div className="simbar">
                  {(
                    [
                      ['Size', qty, setQty, 1, 10, 1, (n: number) => `${n}`],
                      ['Stop', stopPts, setStopPts, 0, 60, 5, (n: number) => (n ? `${n}pt` : 'off')],
                      ['Target', targetPts, setTargetPts, 0, 120, 5, (n: number) => (n ? `${n}pt` : 'off')],
                    ] as const
                  ).map(([label, val, setter, min, max, stp, fmt]) => (
                    <div key={label} className="simctl">
                      <span className="muted small">{label}</span>
                      <button className="stepbtn" onClick={() => setter(Math.max(min, val - stp))}>−</button>
                      <b className="stepval">{fmt(val)}</b>
                      <button className="stepbtn" onClick={() => setter(Math.min(max, val + stp))}>+</button>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  {!pos ? (
                    <>
                      <button className="tradebtn long" onClick={() => enter('long')} disabled={cursor === 0}>
                        ▲ Long {qty}
                      </button>
                      <button className="tradebtn short" onClick={() => enter('short')} disabled={cursor === 0}>
                        ▼ Short {qty}
                      </button>
                    </>
                  ) : (
                    <button className="nextbtn" style={{ flex: 1, marginTop: 0 }} onClick={flatten}>
                      Close {pos.side === 'long' ? '▲ long' : '▼ short'} {pos.qty} @ {price.toFixed(2)} ({fmtUsd(pnl, true)})
                    </button>
                  )}
                </div>

                {recentFills.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <b style={{ fontSize: 12 }}>Fills</b>
                    {recentFills.map((tr, i) => (
                      <div key={i} className="attempt-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span className="muted small">
                          {tr.side === 'long' ? '▲' : '▼'} {tr.qty} @ {tr.entry.toFixed(2)} → {tr.exit.toFixed(2)} ({tr.reason})
                        </span>
                        <b style={{ color: tr.pnl >= 0 ? 'var(--good)' : 'var(--bad)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {fmtUsd(tr.pnl, true)}
                        </b>
                      </div>
                    ))}
                  </div>
                )}
                {hasCosts && (
                  <p className="muted small" style={{ margin: '8px 0 0' }}>
                    Real costs on: ${(eng.rules.commissionPerSide ?? 0).toFixed(2)}/side ·{' '}
                    {eng.rules.slippageTicks ?? 0}-tick slip on market fills · ${evalFees.toFixed(2)} fees so far
                  </p>
                )}
              </div>
            )}
          </div>
          {Disclaimer}
        </div>
      </section>
    );
  }

  // ---- DAY END -----------------------------------------------------------

  if (stage === 'day-end' && campRef.current && run) {
    const camp = campRef.current;
    const dEng = camp.state;
    const prog = challengeProgress(dEng);
    const dayPnl = dayRealizedPnls(dEng.trades).get(run.dayKey) ?? 0;

    return (
      <section>
        <div className="card">
          <h2>Day {camp.day} complete</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="stat"><div className="n">{fmtUsd(dayPnl, true)}</div><div className="l">Day P&amp;L</div></div>
            <div className="stat"><div className="n">{fmtUsd(dEng.equity)}</div><div className="l">Equity</div></div>
            <div className="stat gold"><div className="n">{fmtUsd(prog.toTarget)}</div><div className="l">To target</div></div>
            <div className="stat"><div className="n">{`${prog.daysTraded}/${prog.minDays}`}</div><div className="l">Days traded</div></div>
          </div>
          {prog.effectiveTarget > prog.target && (
            <p className="muted small" style={{ color: 'var(--gold)', marginTop: 6 }}>
              Consistency cap exceeded — your target is now {fmtUsd(prog.effectiveTarget)}.
            </p>
          )}
          <EquityCurve points={dEng.equityCurve} start={dEng.startEquity} />
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="nextbtn" style={{ flex: 1, marginTop: 0 }} onClick={() => void startDay()} disabled={loading}>
              {loading ? 'Loading tape…' : `▶ Trade day ${camp.day + 1}`}
            </button>
            <button className="ghostbtn" onClick={() => setStage('setup')}>Later</button>
          </div>
          {Disclaimer}
        </div>
      </section>
    );
  }

  // ---- RESULT ------------------------------------------------------------

  if (stage === 'result' && lastAttempt) {
    const a = lastAttempt;
    const passed = a.result === 'passed';
    const netPnl = a.finalEquity - a.startEquity;
    const verdictColor = passed ? 'var(--good)' : a.result === 'failed' ? 'var(--bad)' : 'var(--muted)';
    const largestWin = a.trades.reduce((m, t) => Math.max(m, t.pnl), 0);
    const largestLoss = a.trades.reduce((m, t) => Math.min(m, t.pnl), 0);
    let maxConsecLosses = 0;
    let losses = 0;
    for (const t of a.trades) {
      losses = t.pnl < 0 ? losses + 1 : 0;
      maxConsecLosses = Math.max(maxConsecLosses, losses);
    }
    const dayRows = [...dayRealizedPnls(a.trades).entries()].sort((x, y) => x[0] - y[0]);
    const fmtDayKey = (k: number) => `${Math.floor(k / 100) % 100}/${k % 100}`;
    return (
      <section>
        <div
          className="card"
          style={{ borderColor: passed ? 'var(--good)' : a.result === 'failed' ? 'var(--bad)' : 'var(--line)' }}
        >
          <div style={{ fontSize: 24, fontWeight: 800, color: verdictColor }}>
            {passed ? '✓ PASSED' : a.result === 'failed' ? '✗ FAILED' : '— ENDED EARLY'}
          </div>
          <p className="muted small">
            {a.rulesId} · {SCENARIO_LABEL[a.scenario]}
            {a.failReason ? ` · breached the ${a.failReason === 'daily-loss' ? 'daily loss limit' : 'trailing max drawdown'}` : ''}
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <div className="stat"><div className="n">{`${netPnl >= 0 ? '▲' : '▼'}${fmtUsd(netPnl, true)}`}</div><div className="l">Net P&amp;L</div></div>
            <div className="stat"><div className="n">{a.stats.n}</div><div className="l">Trades</div></div>
            <div className="stat"><div className="n">{a.stats.n ? `${Math.round(a.stats.winRate * 100)}%` : '—'}</div><div className="l">Win rate</div></div>
            <div className="stat"><div className="n">{a.stats.avgR !== null ? `${a.stats.avgR.toFixed(2)}R` : '—'}</div><div className="l">Avg R</div></div>
            <div className="stat"><div className="n">{a.stats.n ? fmtUsd(a.stats.expectancy, true) : '—'}</div><div className="l">Expectancy</div></div>
            <div className="stat"><div className="n">{a.stats.profitFactor !== null ? a.stats.profitFactor.toFixed(2) : '—'}</div><div className="l">Profit factor</div></div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <div className="stat"><div className="n">{a.trades.length ? fmtUsd(largestWin, true) : '—'}</div><div className="l">Largest win</div></div>
            <div className="stat"><div className="n">{a.trades.length ? fmtUsd(largestLoss, true) : '—'}</div><div className="l">Largest loss</div></div>
            <div className="stat"><div className="n">{a.trades.length ? maxConsecLosses : '—'}</div><div className="l">Max consec. losses</div></div>
            <div className="stat"><div className="n">{`$${(a.stats.totalFees ?? 0).toFixed(2)}`}</div><div className="l">Commissions paid</div></div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="nextbtn" onClick={() => setStage('setup')}>New challenge</button>
          </div>
          {Disclaimer}
        </div>

        {dayRows.length > 1 && (
          <div className="card">
            <h2>Days</h2>
            {dayRows.map(([k, v]) => (
              <div key={k} className="attempt-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span className="muted small">{fmtDayKey(k)}</span>
                <div className="bar" style={{ flex: 1, alignSelf: 'center' }}>
                  <i
                    style={{
                      width: `${Math.min(100, (Math.abs(v) / Math.max(1, Math.max(...dayRows.map(([, x]) => Math.abs(x))))) * 100)}%`,
                      background: v >= 0 ? 'var(--good)' : 'var(--bad)',
                    }}
                  />
                </div>
                <b style={{ color: v >= 0 ? 'var(--good)' : 'var(--bad)', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {fmtUsd(v, true)}
                </b>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h2>Trades</h2>
          {a.trades.length === 0 && <p className="muted">No trades this run.</p>}
          {a.trades.map((tr, i) => (
            <div key={i} className="attempt-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span className="muted small">
                {tr.side === 'long' ? '▲' : '▼'} {tr.side} {tr.qty} @ {tr.entry.toFixed(2)} → {tr.exit.toFixed(2)} ({tr.reason})
              </span>
              <b style={{ color: tr.pnl >= 0 ? 'var(--good)' : 'var(--bad)', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                {fmtUsd(tr.pnl, true)}
                {tr.r !== null ? `  ${tr.r >= 0 ? '+' : ''}${tr.r.toFixed(1)}R` : ''}
              </b>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return null;
}
