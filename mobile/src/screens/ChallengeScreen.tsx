import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Line as SvgLine, Polyline } from 'react-native-svg';
import {
  ACCOUNT_SIZES,
  CAMPAIGN_PRESETS,
  MNQ_POINT_VALUE,
  SCENARIO_LABEL,
  SCENARIO_TYPES,
  attemptFromState,
  beginCampaignDay,
  canPickScenario,
  canStartChallenge,
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
  toET,
  visibleHistoryCount,
  type AccountSize,
  type Campaign,
  type Candle,
  type ChallengeAttempt,
  type ChallengeState,
  type ScenarioType,
} from '../core';
import { getDataset } from '../data';
import { useApp } from '../store';
import { SvgCandleChart, type AxisTag, type TradeLine, type TradeMarker, type UserMark, type Zone } from '../chart/SvgCandleChart';
import { aggForSpan, buildView } from '../chart/views';
import { Btn, Card, Chip, H2, Muted, Seg, Stat, useThemedStyles } from '../ui';
import { RADIUS, tint } from '../theme';
import { ProUpsellCard } from './ProUpsell';

/** Prior tape attached for pre-market analysis (~4½ prior days + overnight). */
const CONTEXT_BARS = 6300;
/** Sim-chart candle timeframes, switchable mid-day like a real platform. */
const TFS = [
  { label: '1m', agg: 1 },
  { label: '5m', agg: 5 },
  { label: '15m', agg: 15 },
] as const;
/** Visible-span bounds keep the candle count drawable at any timeframe. */
const spanBounds = (agg: number): [number, number] => [agg * 35, agg * 280];
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

type Stage = 'setup' | 'analysis' | 'sim' | 'day-end' | 'result';

interface RunMeta {
  /** The trading day's bars — the only bars the engine ever sees. */
  bars: Candle[];
  /** Display-only prior tape (prior day + overnight) for analysis and lead-in. */
  context: Candle[];
  scenario: ScenarioType;
  dayKey: number;
}

function EquityCurve({ points, start, height = 70 }: { points: { equity: number }[]; start: number; height?: number }) {
  const { c } = useThemedStyles();
  const [w, setW] = useState(0);
  if (points.length < 2) {
    return <View style={{ height: 0 }} onLayout={(e) => setW(e.nativeEvent.layout.width)} />;
  }
  const eqs = points.map((p) => p.equity);
  const min = Math.min(...eqs, start);
  const max = Math.max(...eqs, start);
  const range = max - min || 1;
  const yOf = (v: number) => 4 + (height - 8) * (1 - (v - min) / range);
  const pts = eqs.map((v, i) => `${((i / (eqs.length - 1)) * (w - 8) + 4).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const last = eqs[eqs.length - 1];
  const lineColor = last >= start ? c.good : c.bad;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height, width: '100%' }}>
      {w > 0 && (
        <Svg width={w} height={height}>
          <SvgLine x1={0} x2={w} y1={yOf(start)} y2={yOf(start)} stroke={c.line} strokeDasharray="4,4" strokeWidth={1} />
          <Polyline points={pts} fill="none" stroke={lineColor} strokeWidth={1.8} />
        </Svg>
      )}
    </View>
  );
}

/** Objective/limit bar: label · fill · value. Self-explanatory at a glance. */
function Meter({ label, frac, text, color }: { label: string; frac: number; text: string; color: string }) {
  const { c } = useThemedStyles();
  const f = Math.max(0, Math.min(1, frac));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }}>
      <Text style={{ color: c.muted, fontSize: 9.5, width: 66, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.inset, overflow: 'hidden' }}>
        <View style={{ width: `${f * 100}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </View>
      <Text style={{ color: c.txt, fontSize: 11, fontWeight: '700', minWidth: 88, textAlign: 'right' }}>{text}</Text>
    </View>
  );
}

/**
 * Time-to-next-bar strip (TradingView's bar-close countdown, mobile-sized).
 * Self-contained interval so its 8 fps ticks re-render only this row, never
 * the chart above it.
 */
function BarCountdown({ msPerBar, playing, cursor, lastT }: { msPerBar: number; playing: boolean; cursor: number; lastT: number }) {
  const { c } = useThemedStyles();
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
  const clock = `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')} ET`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
      <Text style={{ color: c.muted, fontSize: 9.5, fontVariant: ['tabular-nums'] }}>{clock}</Text>
      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: c.inset, overflow: 'hidden' }}>
        <View style={{ width: `${(playing ? frac : 0) * 100}%`, height: '100%', backgroundColor: tint(c.info, 0.75) }} />
      </View>
      <Text style={{ color: c.muted, fontSize: 9.5 }}>next bar</Text>
    </View>
  );
}

/**
 * The key-levels menu: name, place, and manage user levels. Naming a level
 * (PDH, ONL, …) is deliberate practice — saying what a level IS burns it in
 * far better than an anonymous line.
 */
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
  const { c } = useThemedStyles();
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: c.txt, fontSize: 13, fontWeight: '700' }}>Key levels</Text>
        <Muted style={{ fontSize: 10.5 }}>{levels.length}/8</Muted>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {levels.map((p, i) => {
          const active = sel === i;
          const name = names[i]?.trim() || `L${i + 1}`;
          return (
            <Btn
              key={i}
              label={`${name} · ${p.toFixed(0)}`}
              kind={active ? 'primary' : 'ghost'}
              onPress={() => onSelect(i)}
              style={{ paddingVertical: 6, paddingHorizontal: 10 }}
            />
          );
        })}
        <Btn label="＋ Add" onPress={onAdd} disabled={addDisabled} style={{ paddingVertical: 6 }} />
      </View>
      {levels.length === 0 && (
        <Muted style={{ marginTop: 6, fontSize: 10.5 }}>
          Tap the chart where a level belongs — the line drops right there.
        </Muted>
      )}
      {sel !== null && sel < levels.length && (
        <View
          style={{
            backgroundColor: c.panel2,
            borderColor: c.line,
            borderWidth: 1,
            borderRadius: 10,
            padding: 9,
            marginTop: 8,
          }}
        >
          <Muted style={{ fontSize: 10.5, marginBottom: 6 }}>
            Name it — what is {names[sel]?.trim() || `L${sel + 1}`} at {levels[sel].toFixed(2)}?
          </Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {LEVEL_NAMES.map((n) => (
              <Btn
                key={n}
                label={n}
                kind={names[sel]?.trim() === n ? 'primary' : 'ghost'}
                onPress={() => {
                  onRename(n);
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={{ paddingVertical: 5, paddingHorizontal: 9 }}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 7, alignItems: 'center' }}>
            <TextInput
              value={names[sel] ?? ''}
              onChangeText={onRename}
              placeholder="Custom name"
              placeholderTextColor={c.muted}
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect={false}
              style={{
                flex: 1,
                color: c.txt,
                backgroundColor: c.inset,
                borderColor: c.line,
                borderWidth: 1,
                borderRadius: RADIUS.control,
                paddingHorizontal: 10,
                paddingVertical: 7,
                fontSize: 12.5,
              }}
            />
            <Btn label="🗑" kind="danger" onPress={onRemove} style={{ paddingVertical: 7, paddingHorizontal: 12 }} />
          </View>
        </View>
      )}
      <Muted style={{ marginTop: 7, fontSize: 10.5 }}>
        Tap the chart to drop a level, tap a line or chip to select, drag the selected line to
        fine-tune. Levels and names stay for the whole evaluation.
      </Muted>
      {onDone && <Btn label="Done" kind="primary" onPress={onDone} style={{ marginTop: 8 }} />}
    </View>
  );
}

export function ChallengeScreen() {
  const { cfg, isPro, challengeAttempts, addChallengeAttempt, campaign, saveCampaign, showPaywall } = useApp();
  const { c } = useThemedStyles();
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  // portrait: ~44% of the screen; landscape: most of it — that's the point
  const chartH = landscape ? Math.max(220, Math.round(winH * 0.62)) : Math.max(300, Math.min(440, Math.round(winH * 0.44)));

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
  const [spanMins, setSpanMins] = useState(110); // sim visible span, pinch/buttons
  const [anaSpan, setAnaSpan] = useState(2880); // analysis look-back, pinch/presets
  const [chartGesture, setChartGesture] = useState(false); // freeze scroll while dragging/pinching
  const pinchBase = useRef<number | null>(null); // span at pinch start
  const [, setTick] = useState(0); // engine mutates in place; tick forces render

  const [qty, setQty] = useState(2);
  const [stopPts, setStopPts] = useState(10);
  const [targetPts, setTargetPts] = useState(20);
  const [lastAttempt, setLastAttempt] = useState<ChallengeAttempt | null>(null);

  // user-drawn analysis levels (+ names) — live on the campaign so they
  // survive app kills
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
        showPaywall();
        return;
      }
      camp = createCampaign(size, Date.now());
    }
    setLoading(true);
    const ds = await getDataset(cfg);
    const w = pickDayWindow(ds.bars, ds.info, {
      scenario,
      contextBars: CONTEXT_BARS,
      excludeDayKeys: camp.usedDayKeys,
    });
    setLoading(false);
    if (!w) return;
    beginCampaignDay(camp, w);
    saveCampaign(clone(camp)); // day-start snapshot survives an app kill
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
  }, [attemptsUsed, campaign, cfg, isPro, saveCampaign, scenario, showPaywall, size]);

  /** Leave the pre-market analysis view; the tape waits for ▶ Play. */
  const startTrading = useCallback(() => {
    // syncLevels keeps campRef.current.keyLevels current; persist them with the day
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
    Alert.alert(
      'Reset challenge?',
      'This abandons the current evaluation. If you placed any trades it is recorded as an abandoned attempt.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
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
          },
        },
      ],
    );
  }, [campaign, saveCampaign, stage, terminal]);

  // ---- replay loop -------------------------------------------------------

  useEffect(() => {
    if (stage !== 'sim' || !playing) return;
    const iv = setInterval(() => {
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
    }, SPEEDS[speedIdx].ms);
    return () => clearInterval(iv);
  }, [stage, playing, speedIdx, endDay, terminal]);

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

  // ---- zoom (buttons + continuous pinch) --------------------------------

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const [lo, hi] = spanBounds(TFS[tfIdx].agg);
      setSpanMins((s) => Math.min(hi, Math.max(lo, dir > 0 ? s / SPAN_RATIO : s * SPAN_RATIO)));
    },
    [tfIdx],
  );

  const pickTf = (i: number) => {
    setTfIdx(i);
    const [lo, hi] = spanBounds(TFS[i].agg);
    setSpanMins((s) => Math.min(hi, Math.max(lo, s)));
  };

  /** Continuous pinch: scale is cumulative since the pinch began. */
  const simPinch = useCallback(
    (scale: number) => {
      if (pinchBase.current === null) pinchBase.current = spanMins;
      const [lo, hi] = spanBounds(TFS[tfIdx].agg);
      setSpanMins(Math.min(hi, Math.max(lo, pinchBase.current / scale)));
    },
    [spanMins, tfIdx],
  );

  const anaPinch = useCallback(
    (scale: number) => {
      if (pinchBase.current === null) pinchBase.current = anaSpan;
      setAnaSpan(Math.min(ANA_SPAN_MAX, Math.max(ANA_SPAN_MIN, pinchBase.current / scale)));
    },
    [anaSpan],
  );

  const onChartGesture = useCallback((active: boolean) => {
    if (!active) pinchBase.current = null;
    setChartGesture(active);
  }, []);

  // ---- key-level helpers shared by the analysis and sim stages ----------

  const addLevelAt = (p: number) => {
    if (keyLevels.length >= 8) return;
    syncLevels([...keyLevels, Math.round(p * 4) / 4], [...keyNames, '']);
    setSelLevel(keyLevels.length);
  };

  /**
   * Tap on the chart: near an existing level selects it, anywhere else drops
   * a new one right where you tapped — no add-then-drag-across-the-chart.
   */
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
    if (best >= 0) {
      setSelLevel(best);
    } else {
      if (keyLevels.length >= 8) return;
      addLevelAt(p);
    }
    Haptics.selectionAsync().catch(() => {});
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

  const flatten = () => {
    if (!eng?.position) return;
    closePosition(eng, price, eng.lastT, 'manual');
    step(eng, { t: eng.lastT, o: price, h: price, l: price, c: price, v: 0 }); // re-mark + re-check rules
    setTick((t) => t + 1);
  };

  // ---- shared bits -------------------------------------------------------

  const Disclaimer = (
    <Muted style={{ marginTop: 8, fontSize: 10.5, lineHeight: 15 }}>
      Simulated, hypothetical trading for education only — no real money, no brokerage connection,
      not financial advice. Simulated results do not reflect real trading. Generic evaluation rules;
      not affiliated with any prop trading firm.
    </Muted>
  );

  const roomColor = (frac: number) => (frac > 0.5 ? c.good : frac > 0.25 ? c.gold : c.bad);

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
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        {resume && resumeProg && (
          <Card style={{ borderColor: tint(c.accent, 0.55), backgroundColor: tint(c.accent, 0.05) }}>
            <H2>Evaluation in progress — Day {resume.day} played</H2>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              <Stat n={fmtUsd(resume.state.equity)} l="Equity" />
              <Stat n={fmtUsd(resumeProg.toTarget)} l="To target" gold />
              <Stat n={`${resumeProg.daysTraded}/${resumeProg.minDays}`} l="Days traded" />
            </View>
            {resumeProg.effectiveTarget > resumeProg.target && (
              <Muted style={{ color: c.gold }}>
                Consistency rule raised your target to {fmtUsd(resumeProg.effectiveTarget)} (best day{' '}
                {fmtUsd(resumeProg.bestDay)} is over the {fmtUsd(resumeProg.consistencyCap ?? 0)} cap).
              </Muted>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Btn
                label={loading ? 'Loading tape…' : `▶ Trade day ${resume.day + 1}`}
                kind="primary"
                onPress={() => void startDay()}
                disabled={loading}
                style={{ flex: 1 }}
              />
              <Btn label="Reset" kind="danger" onPress={resetCampaign} />
            </View>
          </Card>
        )}

        <Card>
          <H2>{resume ? 'Evaluation rules' : 'Challenge Mode — simulated evaluation'}</H2>
          <Muted style={{ marginBottom: 10 }}>
            A prop-style evaluation over multiple replayed trading days. One rule: never breach a loss
            limit. Two objectives: hit the target, and build it consistently.
          </Muted>

          {!resume && (
            <>
              <Muted style={{ marginBottom: 4 }}>Account size</Muted>
              <Seg
                options={ACCOUNT_SIZES.map((s) => ({
                  v: String(s),
                  label: `$${s / 1000}k${!isPro && s !== 50000 ? ' 🔒' : ''}`,
                }))}
                value={String(size)}
                onChange={(v) => {
                  const s = Number(v) as AccountSize;
                  if (!isPro && s !== 50000) {
                    showPaywall();
                    return;
                  }
                  setSize(s);
                }}
              />
            </>
          )}

          <Muted style={{ marginTop: 12, marginBottom: 4 }}>
            Next day's tape {isPro ? '' : '(Pro picks the tape)'}
          </Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Btn
              label="Any"
              kind={scenario === null ? 'primary' : 'ghost'}
              onPress={() => setScenario(null)}
              style={{ paddingVertical: 7, marginRight: 6, marginBottom: 6 }}
            />
            {SCENARIO_TYPES.map((sc) => (
              <Btn
                key={sc}
                label={`${SCENARIO_LABEL[sc]}${isPro ? '' : ' 🔒'}`}
                kind={scenario === sc ? 'primary' : 'ghost'}
                onPress={() => {
                  if (!canPickScenario(isPro, sc).allowed) {
                    showPaywall();
                    return;
                  }
                  setScenario(sc);
                }}
                style={{ paddingVertical: 7, marginRight: 6, marginBottom: 6 }}
              />
            ))}
          </View>

          <View
            style={{
              backgroundColor: c.panel2,
              borderColor: c.line,
              borderWidth: 1,
              borderRadius: 10,
              padding: 11,
              marginTop: 10,
            }}
          >
            <Text style={{ color: c.txt, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>{rules.name}</Text>
            <Muted>
              ⛔ Trailing max drawdown {fmtUsd(rules.trailingMaxDrawdown)} · daily loss limit{' '}
              {fmtUsd(rules.dailyLossLimit)}
            </Muted>
            <Muted>
              🎯 Profit target {fmtUsd(rules.profitTarget)}
              {cap !== null ? ` · best day ≤ ${fmtUsd(cap)}` : ''}
              {rules.minTradingDays ? ` · ${rules.minTradingDays}+ trading days` : ''}
            </Muted>
            {(rules.commissionPerSide ?? 0) > 0 && (
              <Muted>
                💸 Live-market friction: ${(rules.commissionPerSide ?? 0).toFixed(2)}/side commission ·{' '}
                {rules.slippageTicks ?? 0}-tick slippage on market fills
              </Muted>
            )}
            <Muted style={{ marginTop: 4, fontSize: 11 }}>
              A big day doesn't fail you — it raises your target until the rest of your trading backs
              it up. Play one day at a time; your account carries over. Reset any time.
            </Muted>
          </View>

          {!isPro && (
            <Muted style={{ marginTop: 8 }}>
              Free preview: {Math.max(0, 2 - attemptsUsed)} of 2 evaluations left · $50k size only.
            </Muted>
          )}
          {!resume && (
            <View style={{ marginTop: 10 }}>
              <Btn
                label={loading ? 'Loading tape…' : 'Start evaluation'}
                kind="primary"
                onPress={() => void startDay()}
                disabled={loading}
              />
            </View>
          )}
          {Disclaimer}
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <H2>History</H2>
            <View style={{ marginLeft: 8, marginBottom: 8, flexDirection: 'row' }}>
              <Chip label={`pass streak ${streak}`} color={streak > 0 ? c.gold : c.muted} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
            {badges.map((b) => (
              <Chip key={b.id} label={`${b.earned ? '🏅 ' : ''}${b.name}`} color={b.earned ? c.gold : c.muted} />
            ))}
          </View>
          {history.length === 0 && <Muted>No attempts yet — your results and badges land here.</Muted>}
          {history.map((a) => (
            <View
              key={a.id}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.line }}
            >
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: a.result === 'passed' ? c.good : a.result === 'failed' ? c.bad : c.muted, fontWeight: '700', fontSize: 12.5 }}>
                  {a.result === 'passed' ? '✓ PASS' : a.result === 'failed' ? '✗ FAIL' : '– QUIT'}
                  <Text style={{ color: c.muted, fontWeight: '400' }}>
                    {'  '}${a.accountSize / 1000}k · {SCENARIO_LABEL[a.scenario]}
                    {a.failReason ? ` · ${a.failReason === 'daily-loss' ? 'daily loss' : 'trailing DD'}` : ''}
                  </Text>
                </Text>
                <Muted>
                  {new Date(a.t).toLocaleDateString()} · {a.stats.n} trades · {fmtUsd(a.finalEquity - a.startEquity, true)}
                  {a.stats.avgR !== null ? ` · avg ${a.stats.avgR.toFixed(2)}R` : ''}
                </Muted>
              </View>
            </View>
          ))}
          {!isPro && challengeAttempts.length > visible && (
            <Btn label={`Unlock full history (${challengeAttempts.length} attempts) — Pro`} onPress={showPaywall} style={{ marginTop: 8 }} />
          )}
        </Card>

        <ProUpsellCard />
      </ScrollView>
    );
  }

  // ---- PRE-MARKET ANALYSIS ----------------------------------------------

  if (stage === 'analysis' && eng && run && campRef.current) {
    const camp = campRef.current;
    const prog = challengeProgress(eng);
    const ctx = run.context;
    const anaMins = Math.round(anaSpan);
    const viewBars = ctx.length
      ? buildView(ctx, ctx.length - 1, { mins: anaMins, agg: aggForSpan(anaMins) })
      : [];
    const lastCtxClose = ctx.length ? ctx[ctx.length - 1].c : 0;
    const p0 = toET(run.bars[0].t);

    return (
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }} scrollEnabled={!chartGesture}>
        <Card>
          <H2>Day {camp.day} — pre-market prep</H2>
          <Muted style={{ marginBottom: 8 }}>
            The session opens {String(p0.hh).padStart(2, '0')}:{String(p0.mm).padStart(2, '0')} ET.
            Study the prior days and overnight tape, mark your key levels, then start the day. You'll
            trade the full session — open to close.
          </Muted>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <Stat n={fmtUsd(eng.equity)} l="Equity" />
            <Stat n={fmtUsd(prog.toTarget)} l="To target" gold />
            <Stat n={`${prog.daysTraded}/${prog.minDays}`} l="Days traded" />
          </View>

          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {ANA_PRESETS.map((v) => (
              <Btn
                key={v.key}
                label={v.key}
                kind={Math.abs(anaSpan - v.mins) < 1 ? 'primary' : 'ghost'}
                onPress={() => setAnaSpan(v.mins)}
                style={{ flex: 1, paddingVertical: 6 }}
              />
            ))}
            <Muted style={{ fontSize: 10.5 }}>{aggForSpan(anaMins)}m bars</Muted>
          </View>
          <View style={{ marginTop: 6 }}>
            <SvgCandleChart
              bars={viewBars}
              userMarks={levelMarks}
              dragIndex={selLevel}
              onMarkMove={(i, p) => syncLevels(keyLevels.map((v, j) => (j === i ? Math.round(p * 4) / 4 : v)), keyNames)}
              onPricePress={tapLevel(viewBars)}
              onPinch={anaPinch}
              onGesture={onChartGesture}
              height={chartH}
              showTime
            />
          </View>

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

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Btn label="▶ Start trading day" kind="primary" onPress={startTrading} style={{ flex: 1 }} />
            <Btn label="Reset" kind="danger" onPress={resetCampaign} />
          </View>
          {Disclaimer}
        </Card>
      </ScrollView>
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
    const zones: Zone[] = [];
    if (pos) {
      tradeLines.push({ price: pos.entry, kind: 'entry', label: `entry ${fmtUsd(pnl, true)}` });
      if (pos.stop !== null) tradeLines.push({ price: pos.stop, kind: 'stop' });
      if (pos.target !== null) tradeLines.push({ price: pos.target, kind: 'target' });
      const base = eng.startEquity + eng.realized;
      const dir = pos.side === 'long' ? 1 : -1;
      const perPt = MNQ_POINT_VALUE * pos.qty;
      const failEq = Math.max(prog.ddFailEquity, prog.dayFailEquity);
      const failPrice = pos.entry + (dir * (failEq - base)) / perPt;
      const goalPrice = pos.entry + (dir * (eng.startEquity + prog.effectiveTarget - base)) / perPt;
      tradeLines.push({ price: failPrice, kind: 'fail', label: '⛔ liq' });
      tradeLines.push({ price: goalPrice, kind: 'goal', label: '🎯 pass' });
      zones.push({ from: failPrice, to: failPrice + (pos.side === 'long' ? -1 : 1) * 10_000, color: c.bad });
    }

    // session high/low tags from every bar replayed so far today
    const seen = run.bars.slice(0, cursor);
    let hi = -Infinity;
    let lo = Infinity;
    for (const b of seen) {
      hi = Math.max(hi, b.h);
      lo = Math.min(lo, b.l);
    }
    const axisTags: AxisTag[] = isFinite(hi) ? [{ price: hi, label: 'H' }, { price: lo, label: 'L' }] : [];

    // entry/exit markers for every trade this day + the open position
    const tradeMarkers: TradeMarker[] = [];
    for (const tr of eng.trades) {
      tradeMarkers.push({ t: tr.entryT, price: tr.entry, kind: tr.side === 'long' ? 'buy' : 'sell' });
      tradeMarkers.push({ t: tr.exitT, price: tr.exit, kind: 'exit', win: tr.pnl >= 0 });
    }
    if (pos) tradeMarkers.push({ t: pos.entryT, price: pos.entry, kind: pos.side === 'long' ? 'buy' : 'sell' });

    const targetFrac = prog.effectiveTarget > 0 ? prog.profit / prog.effectiveTarget : 0;
    const ddFrac = prog.ddRoom / eng.rules.trailingMaxDrawdown;
    const dayFrac = prog.dayRoom / eng.rules.dailyLossLimit;
    // firm-dashboard numbers: closed balance vs marked equity, and the hard
    // equity level that ends the account right now (nearer of the two rules)
    const balance = eng.startEquity + eng.realized;
    const liqAt = Math.max(prog.ddFailEquity, prog.dayFailEquity);
    const liqRoom = Math.max(0, Math.min(prog.ddRoom, prog.dayRoom));
    const dangerFrac = Math.min(ddFrac, dayFrac);

    const doneLevels = () => {
      setEditLevels(false);
      setSelLevel(null);
      saveCampaign(clone(camp));
    };

    return (
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }} scrollEnabled={!chartGesture}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <Stat n={fmtUsd(balance)} l="Balance" />
            <Stat n={fmtUsd(eng.equity)} l="Open equity" />
            <Stat n={pos ? `${pnl >= 0 ? '▲' : '▼'}${fmtUsd(pnl, true)}` : '—'} l="Open P&L" />
            <Stat n={`Day ${camp.day}`} l={`${prog.daysTraded}/${prog.minDays} traded`} />
          </View>
          <Muted style={{ marginBottom: 4, fontSize: 11.5 }}>
            ⛔ Liquidates at <Text style={{ color: c.bad, fontWeight: '700' }}>{fmtUsd(liqAt)}</Text> —{' '}
            {fmtUsd(liqRoom)} of room
          </Muted>
          {dangerFrac < 0.25 && (
            <Text style={{ color: c.bad, fontSize: 12.5, fontWeight: '700', marginBottom: 4 }}>
              ⚠ {fmtUsd(liqRoom)} from liquidation — protect the account.
            </Text>
          )}

          <SvgCandleChart
            bars={visibleBars}
            tradeLines={tradeLines}
            tradeMarkers={tradeMarkers}
            axisTags={axisTags}
            zones={zones}
            userMarks={levelMarks}
            dragIndex={editLevels ? selLevel : null}
            onMarkMove={
              editLevels
                ? (i, p) => syncLevels(keyLevels.map((v, j) => (j === i ? Math.round(p * 4) / 4 : v)), keyNames)
                : undefined
            }
            onPricePress={editLevels ? tapLevel(visibleBars) : undefined}
            onPinch={simPinch}
            onGesture={onChartGesture}
            height={chartH}
            showTime
          />

          {editLevels ? (
            // the ✏️ Levels menu replaces the trading controls until Done
            <LevelEditor
              levels={keyLevels}
              names={keyNames}
              sel={selLevel}
              onSelect={(i) => setSelLevel(i)}
              onAdd={() => addLevelAt(price)}
              addDisabled={keyLevels.length >= 8}
              onRemove={removeSelLevel}
              onRename={renameSelLevel}
              onDone={doneLevels}
            />
          ) : (
            <>
              <BarCountdown msPerBar={SPEEDS[speedIdx].ms} playing={playing} cursor={cursor} lastT={eng.lastT} />

              <Meter
                label="Target"
                frac={targetFrac}
                text={`${fmtUsd(Math.max(0, prog.profit))} / ${fmtUsd(prog.effectiveTarget)}`}
                color={c.accent}
              />
              <Meter label="DD room" frac={ddFrac} text={fmtUsd(Math.max(0, prog.ddRoom))} color={roomColor(ddFrac)} />
              <Meter label="Day room" frac={dayFrac} text={fmtUsd(Math.max(0, prog.dayRoom))} color={roomColor(dayFrac)} />
              {prog.consistencyCap !== null && (
                <Meter
                  label="Best day"
                  frac={prog.bestDay / prog.consistencyCap}
                  text={`${fmtUsd(prog.bestDay)} / ${fmtUsd(prog.consistencyCap)}`}
                  color={prog.bestDay > prog.consistencyCap ? c.bad : prog.bestDay > prog.consistencyCap * 0.8 ? c.gold : c.info}
                />
              )}
              {prog.effectiveTarget > prog.target && (
                <Muted style={{ color: c.gold, marginTop: 4, fontSize: 11 }}>
                  ⚠ Best day over the consistency cap — target raised to {fmtUsd(prog.effectiveTarget)}.
                </Muted>
              )}

              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <Btn label={playing ? '⏸ Pause' : '▶ Play'} kind={playing ? 'ghost' : 'primary'} onPress={() => setPlaying((p) => !p)} style={{ flex: 1 }} />
                <Btn label={SPEEDS[speedIdx].label} onPress={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)} style={{ paddingHorizontal: 14 }} />
                <Btn label="🔍−" onPress={() => zoomStep(-1)} style={{ paddingHorizontal: 10 }} />
                <Btn label="🔍+" onPress={() => zoomStep(1)} style={{ paddingHorizontal: 10 }} />
              </View>
              <View style={{ marginTop: 6 }}>
                <Seg
                  options={TFS.map((tf, i) => ({ v: String(i), label: tf.label }))}
                  value={String(tfIdx)}
                  onChange={(v) => pickTf(Number(v))}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                <Btn
                  label="✏️ Levels"
                  onPress={() => {
                    setPlaying(false);
                    setEditLevels(true);
                    if (keyLevels.length > 0) setSelLevel(0);
                  }}
                  style={{ flex: 1 }}
                />
                <Btn label="End day" onPress={endDay} style={{ flex: 1 }} />
                <Btn label="Reset" kind="danger" onPress={resetCampaign} />
              </View>

              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {(
                  [
                    ['Size', qty, setQty, 1, 10, 1, (n: number) => `${n}`],
                    ['Stop', stopPts, setStopPts, 0, 60, 5, (n: number) => (n ? `${n}pt` : 'off')],
                    ['Target', targetPts, setTargetPts, 0, 120, 5, (n: number) => (n ? `${n}pt` : 'off')],
                  ] as const
                ).map(([label, val, setter, min, max, stp, fmt]) => (
                  <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.panel2, borderColor: c.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4 }}>
                    <Text style={{ color: c.muted, fontSize: 10.5 }}>{label}</Text>
                    <Btn label="−" onPress={() => setter(Math.max(min, val - stp))} style={{ paddingVertical: 2, paddingHorizontal: 9 }} />
                    <Text style={{ color: c.txt, fontSize: 12.5, fontWeight: '700', minWidth: 34, textAlign: 'center' }}>{fmt(val)}</Text>
                    <Btn label="+" onPress={() => setter(Math.min(max, val + stp))} style={{ paddingVertical: 2, paddingHorizontal: 9 }} />
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {!pos ? (
                  <>
                    <Btn label={`▲ Long ${qty}`} kind="correct" onPress={() => enter('long')} disabled={cursor === 0} style={{ flex: 1 }} />
                    <Btn label={`▼ Short ${qty}`} kind="wrong" onPress={() => enter('short')} disabled={cursor === 0} style={{ flex: 1 }} />
                  </>
                ) : (
                  <Btn
                    label={`Close ${pos.side === 'long' ? '▲ long' : '▼ short'} ${pos.qty} @ ${price.toFixed(2)} (${fmtUsd(pnl, true)})`}
                    kind="primary"
                    onPress={flatten}
                    style={{ flex: 1 }}
                  />
                )}
              </View>
              <Muted style={{ marginTop: 8 }}>
                {SCENARIO_LABEL[run.scenario]} tape · bar {cursor}/{run.bars.length} ·
                {' '}{eng.trades.length} closed trade{eng.trades.length === 1 ? '' : 's'} · $2/pt per contract
              </Muted>
            </>
          )}
          {Disclaimer}
        </Card>
      </ScrollView>
    );
  }

  // ---- DAY END -----------------------------------------------------------

  if (stage === 'day-end' && campRef.current && run) {
    const camp = campRef.current;
    const dEng = camp.state;
    const prog = challengeProgress(dEng);
    const dayPnl = dayRealizedPnls(dEng.trades).get(run.dayKey) ?? 0;

    return (
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Card>
          <H2>Day {camp.day} complete</H2>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Stat n={fmtUsd(dayPnl, true)} l="Day P&L" />
            <Stat n={fmtUsd(dEng.equity)} l="Equity" />
            <Stat n={fmtUsd(prog.toTarget)} l="To target" gold />
            <Stat n={`${prog.daysTraded}/${prog.minDays}`} l="Days traded" />
          </View>
          {prog.effectiveTarget > prog.target && (
            <Muted style={{ color: c.gold, marginTop: 6 }}>
              Consistency cap exceeded — your target is now {fmtUsd(prog.effectiveTarget)}.
            </Muted>
          )}
          <View style={{ marginTop: 10 }}>
            <EquityCurve points={dEng.equityCurve} start={dEng.startEquity} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Btn
              label={loading ? 'Loading tape…' : `▶ Trade day ${camp.day + 1}`}
              kind="primary"
              onPress={() => void startDay()}
              disabled={loading}
              style={{ flex: 1 }}
            />
            <Btn label="Later" onPress={() => setStage('setup')} />
          </View>
          {Disclaimer}
        </Card>
      </ScrollView>
    );
  }

  // ---- RESULT ------------------------------------------------------------

  if (stage === 'result' && lastAttempt) {
    const a = lastAttempt;
    const passed = a.result === 'passed';
    const netPnl = a.finalEquity - a.startEquity;
    return (
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Card
          style={{
            borderColor: passed ? c.good : a.result === 'failed' ? c.bad : c.line,
            backgroundColor: tint(passed ? c.good : a.result === 'failed' ? c.bad : c.muted, 0.06),
          }}
        >
          <Text style={{ color: passed ? c.good : a.result === 'failed' ? c.bad : c.muted, fontSize: 22, fontWeight: '800' }}>
            {passed ? '✓ PASSED' : a.result === 'failed' ? '✗ FAILED' : '— ENDED EARLY'}
          </Text>
          <Muted style={{ marginTop: 2 }}>
            {a.rulesId} · {SCENARIO_LABEL[a.scenario]}
            {a.failReason ? ` · breached the ${a.failReason === 'daily-loss' ? 'daily loss limit' : 'trailing max drawdown'}` : ''}
          </Muted>

          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            <Stat n={`${netPnl >= 0 ? '▲' : '▼'}${fmtUsd(netPnl, true)}`} l="Net P&L" />
            <Stat n={String(a.stats.n)} l="Trades" />
            <Stat n={a.stats.n ? `${Math.round(a.stats.winRate * 100)}%` : '—'} l="Win rate" />
            <Stat n={a.stats.avgR !== null ? `${a.stats.avgR.toFixed(2)}R` : '—'} l="Avg R" />
            <Stat n={a.stats.n ? fmtUsd(a.stats.expectancy, true) : '—'} l="Expectancy" />
            <Stat n={a.stats.profitFactor !== null ? a.stats.profitFactor.toFixed(2) : '—'} l="Profit factor" />
            <Stat n={`$${(a.stats.totalFees ?? 0).toFixed(2)}`} l="Fees" />
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Btn label="New challenge" kind="primary" onPress={() => setStage('setup')} style={{ flex: 1 }} />
          </View>
          {Disclaimer}
        </Card>

        <Card>
          <H2>Trades</H2>
          {a.trades.length === 0 && <Muted>No trades this run.</Muted>}
          {a.trades.map((tr, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <Muted>
                {tr.side === 'long' ? '▲' : '▼'} {tr.side} {tr.qty} @ {tr.entry.toFixed(2)} → {tr.exit.toFixed(2)} ({tr.reason})
              </Muted>
              <Text style={{ color: tr.pnl >= 0 ? c.good : c.bad, fontSize: 12.5, fontWeight: '700' }}>
                {fmtUsd(tr.pnl, true)}
                {tr.r !== null ? `  ${tr.r >= 0 ? '+' : ''}${tr.r.toFixed(1)}R` : ''}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    );
  }

  return null;
}
