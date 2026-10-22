import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  computeLevels,
  levelFullName,
  mergedLevelNotes,
  nextUnplaced,
  passesSessionFilter,
  primaryLevels,
  scoreSlots,
  toET,
  type Candle,
  type Level,
  type LevelSet,
  type SlotScore,
} from '../core';
import { getDataset } from '../data';
import { useApp } from '../store';
import { SvgCandleChart, type UserMark } from '../chart/SvgCandleChart';
import { Btn, Card, H2, Muted, Seg, Stat } from '../ui';
import { RADIUS, tint, useTheme } from '../theme';

import { VIEWS, buildView } from '../chart/views';

interface Round {
  bars: Candle[];
  idx: number;
  set: LevelSet;
  targets: Level[];
}

export function LevelDrillScreen() {
  const { cfg } = useApp();
  const { c: C } = useTheme();
  const [round, setRound] = useState<Round | null>(null);
  const [prices, setPrices] = useState<(number | null)[]>([]);
  const [armed, setArmed] = useState<number | null>(null);
  const [results, setResults] = useState<SlotScore[] | null>(null);
  const [tally, setTally] = useState({ rounds: 0, hits: 0, targets: 0 });
  const [viewIdx, setViewIdx] = useState(2); // default widest — see VIEWS
  const [chartGesture, setChartGesture] = useState(false); // freeze scroll while dragging/pinching
  const seq = useRef(0);

  const scored = results !== null;

  const next = useCallback(async () => {
    const mySeq = ++seq.current;
    setPrices([]);
    setArmed(null);
    setResults(null);
    setRound(null);
    const { bars, info } = await getDataset(cfg);
    if (mySeq !== seq.current) return;
    const minIdx = Math.min(1500, Math.floor(bars.length / 3));
    // prefer rounds where all five drill levels are markable; keep the best
    // candidate seen so a sparse dataset still yields a round
    let best: Round | null = null;
    for (let tries = 0; tries < 300; tries++) {
      const idx = minIdx + Math.floor(Math.random() * (bars.length - minIdx - 1));
      if (info[idx].tag === 'maintenance') continue;
      if (!passesSessionFilter(info, idx, cfg.sessionFilter, cfg.eveningHours)) continue;
      const set = computeLevels(bars, info, idx, cfg);
      const targets = primaryLevels(set, cfg.tol);
      if (targets.length < 3) continue;
      // judge markability against the widest view — that's the default zoom
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = Math.max(0, idx - VIEWS[VIEWS.length - 1].mins); i <= idx; i++) {
        lo = Math.min(lo, bars[i].l);
        hi = Math.max(hi, bars[i].h);
      }
      const inRange = targets.filter((t) => t.price > lo - 60 && t.price < hi + 60);
      if (inRange.length < 3) continue;
      if (!best || inRange.length > best.targets.length) best = { bars, idx, set, targets: inRange };
      if (inRange.length >= 5) break;
    }
    if (best) {
      setRound(best);
      setPrices(best.targets.map(() => null));
      setArmed(0);
    }
  }, [cfg]);

  useEffect(() => {
    void next();
  }, [next]);

  // Chart marks carry the slot's short name; placedSlots maps a chart-mark
  // index (placed marks only) back to its slot for drag updates.
  const placedSlots: number[] = [];
  const marks: UserMark[] = [];
  if (round) {
    prices.forEach((p, i) => {
      if (p === null) return;
      placedSlots.push(i);
      marks.push({ price: p, hit: results ? results[i].hit : null, label: round.targets[i].id });
    });
  }

  const placeArmed = (price: number) => {
    if (scored || armed === null) return;
    setPrices((ps) => {
      const nextPs = [...ps];
      nextPs[armed] = price;
      setArmed(nextUnplaced(nextPs, armed));
      return nextPs;
    });
  };

  // only the armed (selected) level's line is draggable
  const chartDragIndex =
    !scored && armed !== null && prices[armed] !== null ? placedSlots.indexOf(armed) : null;

  const moveMark = (chartIdx: number, price: number) => {
    if (scored || chartIdx !== chartDragIndex) return;
    const slot = placedSlots[chartIdx];
    if (slot === undefined) return;
    setPrices((ps) => {
      const nextPs = [...ps];
      nextPs[slot] = price;
      return nextPs;
    });
  };

  const score = () => {
    if (!round || scored) return;
    const { hits, results: r } = scoreSlots(round.targets, prices, cfg.tol);
    setResults(r);
    setArmed(null);
    setTally((t) => ({
      rounds: t.rounds + 1,
      hits: t.hits + hits,
      targets: t.targets + round.targets.length,
    }));
  };

  const placedCount = prices.filter((p) => p !== null).length;
  const hits = results ? results.filter((r) => r.hit).length : 0;
  const mergedNotes = round ? mergedLevelNotes(round.set.levels, round.targets, cfg.tol) : [];
  const view = useMemo(
    () => (round ? buildView(round.bars, round.idx, VIEWS[viewIdx]) : []),
    [round, viewIdx],
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }} scrollEnabled={!chartGesture}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <H2>Level-marking drill</H2>
            <Muted>
              A trader's first job each session: mark yesterday's key levels from the tape alone.
              The real levels are hidden until you score.
            </Muted>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Stat n={String(tally.rounds)} l="Charts" />
            <Stat n={tally.targets ? `${Math.round((100 * tally.hits) / tally.targets)}%` : '—'} l="Found" />
          </View>
        </View>
        <Muted style={{ marginTop: 6 }}>
          1. One level at a time is selected (highlighted blue). 2. Tap the chart where it belongs
          — its line appears and the next level selects itself. 3. To adjust a line, tap its chip
          first, then drag the line up/down. 4. Score — within ±{cfg.tol} pts counts.
        </Muted>
      </Card>

      <Card>
        {round ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {round.targets.map((t, i) => {
                const placed = prices[i] !== null;
                const isArmed = armed === i;
                const col = isArmed ? C.info : placed ? C.accent : C.muted;
                return (
                  <Pressable
                    key={t.id}
                    disabled={scored}
                    onPress={() => setArmed(i)}
                    style={{
                      borderWidth: isArmed ? 2 : 1,
                      borderColor: isArmed ? C.info : placed ? tint(C.accent, 0.55) : C.line,
                      backgroundColor: isArmed ? tint(C.info, 0.12) : placed ? tint(C.accent, 0.08) : C.panel,
                      borderRadius: RADIUS.control,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                    }}
                  >
                    <Text style={{ color: col, fontSize: 12, fontWeight: '700' }}>
                      {t.id}
                      {placed ? ` · ${prices[i]!.toFixed(0)}` : ''}
                    </Text>
                    <Text style={{ color: C.muted, fontSize: 9.5 }}>{levelFullName(t.id)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!scored && (
              <Muted style={{ marginBottom: 6 }}>
                {armed !== null && prices[armed] === null
                  ? `Tap the chart to place ${round.targets[armed].id} — ${levelFullName(round.targets[armed].id).toLowerCase()}.`
                  : armed !== null
                    ? `${round.targets[armed].id} selected — drag its line to adjust, or tap the chart to re-place it.`
                    : 'All levels placed. Tap a chip to select one, then drag or re-place its line. Score when ready.'}
              </Muted>
            )}
            {mergedNotes.map((note) => (
              <Muted key={note} style={{ marginBottom: 6 }}>
                ℹ️ {note}
              </Muted>
            ))}
            <View style={{ marginBottom: 8 }}>
              <Seg
                options={VIEWS.map((v) => ({ v: v.key, label: v.label }))}
                value={VIEWS[viewIdx].key}
                onChange={(k) => setViewIdx(VIEWS.findIndex((v) => v.key === k))}
              />
            </View>
            <SvgCandleChart
              bars={view}
              levels={scored ? round.set.levels : []}
              clusters={scored ? round.set.clusters : []}
              vwapSeries={scored ? round.set.vwapSeries : undefined}
              userMarks={marks}
              includePrices={round.targets.map((t) => t.price)}
              onPricePress={!scored && armed !== null ? placeArmed : undefined}
              dragIndex={chartDragIndex}
              onMarkMove={!scored ? moveMark : undefined}
              onZoomStep={(dir) =>
                setViewIdx((i) => Math.min(VIEWS.length - 1, Math.max(0, dir > 0 ? i - 1 : i + 1)))
              }
              onGesture={setChartGesture}
              height={360}
              showTime
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {!scored ? (
                <>
                  <Btn
                    label={placedCount < prices.length ? `Score (${placedCount}/${prices.length} placed)` : 'Score my levels'}
                    kind="primary"
                    onPress={score}
                    disabled={!placedCount}
                    style={{ flexGrow: 1 }}
                  />
                  <Btn
                    label="Clear"
                    onPress={() => {
                      setPrices(round.targets.map(() => null));
                      setArmed(0);
                    }}
                    disabled={!placedCount}
                  />
                </>
              ) : (
                <Btn label="Next chart →" kind="primary" onPress={() => void next()} style={{ flexGrow: 1 }} />
              )}
            </View>
            {scored && results && (
              <View style={{ marginTop: 12, backgroundColor: C.panel2, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12 }}>
                <Text
                  style={{
                    color: hits === round.targets.length ? C.good : hits > 0 ? C.gold : C.bad,
                    fontWeight: '700',
                    fontSize: 14,
                    marginBottom: 6,
                  }}
                >
                  {hits}/{round.targets.length} key levels found
                </Text>
                {round.targets.map((t, i) => {
                  const r = results[i];
                  return (
                    <Text key={t.id} style={{ color: r.hit ? C.good : C.bad, fontSize: 12.5, marginBottom: 2 }}>
                      {r.hit ? '✓' : '✗'} {t.id} — {levelFullName(t.id)}:{' '}
                      {r.placed ? `off by ${r.off!.toFixed(1)} pts` : 'not placed'}
                    </Text>
                  );
                })}
                {round.set.clusters.length > 0 && (
                  <Muted style={{ marginTop: 4 }}>
                    {round.set.clusters.length} confluence zone(s) (★) — where levels stack, they matter more.
                  </Muted>
                )}
              </View>
            )}
          </>
        ) : (
          <Muted>Preparing a chart… (first run scans the generated dataset)</Muted>
        )}
      </Card>
    </ScrollView>
  );
}
