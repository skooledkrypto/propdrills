import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Level, LevelSet, BarSessionInfo } from '../core/types';
import { computeLevels, primaryLevels } from '../core/levels';
import { levelFullName, mergedLevelNotes, nextUnplaced, scoreSlots, type SlotScore } from '../core/levelDrill';
import { passesSessionFilter, sessionInfo, toET } from '../core/sessions';
import { generateSampleSeries } from '../core/synth';
import { loadBars } from '../storage/db';
import { useApp } from '../state/store';
import { CandleChart, type UserMark } from '../chart/CandleChart';

const WINDOW = 240; // bars shown

// module cache so re-entering the tab is instant
let cachedBars: Candle[] | null = null;
let cachedInfo: BarSessionInfo[] | null = null;
let cachedIsSample = false;

async function ensureBars(): Promise<{ bars: Candle[]; info: BarSessionInfo[]; isSample: boolean }> {
  if (cachedBars && cachedInfo) return { bars: cachedBars, info: cachedInfo, isSample: cachedIsSample };
  let bars = await loadBars();
  let isSample = false;
  if (bars.length < 3000) {
    bars = generateSampleSeries(21, 20260731, toET);
    isSample = true;
  }
  const info = sessionInfo(bars);
  cachedBars = bars;
  cachedInfo = info;
  cachedIsSample = isSample;
  return { bars, info, isSample };
}

/** Call after a new dataset import so the drill picks it up. */
export function invalidateLevelDrillCache() {
  cachedBars = null;
  cachedInfo = null;
}

interface Round {
  view: Candle[];
  set: LevelSet;
  targets: Level[];
  isSample: boolean;
}

export function LevelDrill() {
  const { cfg } = useApp();
  const [round, setRound] = useState<Round | null>(null);
  const [prices, setPrices] = useState<(number | null)[]>([]);
  const [armed, setArmed] = useState<number | null>(null);
  const [results, setResults] = useState<SlotScore[] | null>(null);
  const [tally, setTally] = useState({ rounds: 0, hits: 0, targets: 0 });
  const seq = useRef(0);

  const scored = results !== null;

  const next = useCallback(async () => {
    const mySeq = ++seq.current;
    setPrices([]);
    setArmed(null);
    setResults(null);
    const { bars, info, isSample } = await ensureBars();
    if (mySeq !== seq.current) return;
    // pick an anchor with enough history for prior-day levels and the display
    // window; prefer rounds where all five drill levels are markable
    const minIdx = Math.min(1500, Math.floor(bars.length / 3));
    let best: Round | null = null;
    for (let tries = 0; tries < 300; tries++) {
      const idx = minIdx + Math.floor(Math.random() * (bars.length - minIdx - 1));
      if (info[idx].tag === 'maintenance') continue;
      if (!passesSessionFilter(info, idx, cfg.sessionFilter, cfg.eveningHours)) continue;
      const set = computeLevels(bars, info, idx, cfg);
      const targets = primaryLevels(set, cfg.tol);
      if (targets.length < 3) continue;
      // targets should be plausibly markable: near the visible price range
      const view = bars.slice(Math.max(0, idx - WINDOW), idx + 1);
      const lo = Math.min(...view.map((b) => b.l));
      const hi = Math.max(...view.map((b) => b.h));
      const inRange = targets.filter((t) => t.price > lo - 60 && t.price < hi + 60);
      if (inRange.length < 3) continue;
      if (!best || inRange.length > best.targets.length) best = { view, set, targets: inRange, isSample };
      if (inRange.length >= 5) break;
    }
    setRound(best);
    if (best) {
      setPrices(best.targets.map(() => null));
      setArmed(0);
    }
  }, [cfg]);

  useEffect(() => {
    void next();
  }, [next]);

  if (!round) return <div className="card muted">Preparing a chart…</div>;

  // Chart marks carry the slot's short name; placedSlots maps a chart-mark
  // index (placed marks only) back to its slot for drag updates.
  const placedSlots: number[] = [];
  const marks: UserMark[] = [];
  prices.forEach((p, i) => {
    if (p === null) return;
    placedSlots.push(i);
    marks.push({ price: p, hit: results ? results[i].hit : null, label: round.targets[i].id });
  });

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

  const mergedNotes = mergedLevelNotes(round.set.levels, round.targets, cfg.tol);

  const score = () => {
    if (scored) return;
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

  return (
    <section>
      <div className="card">
        <div className="controls">
          <div>
            <h2 style={{ margin: 0 }}>Level-marking drill</h2>
            <div className="muted small">
              A trader's first job each session: mark yesterday's key levels from the tape alone.
              The real levels stay hidden until you score. <b>1.</b> One level at a time is
              selected (highlighted blue). <b>2.</b> Click the chart where it belongs — its line
              appears and the next level selects itself. <b>3.</b> To adjust a line, click its
              chip first, then drag the line. <b>4.</b> Score — within ±{cfg.tol} pts counts.
            </div>
          </div>
          <div className="scoreboard">
            <div className="stat"><div className="n">{tally.rounds}</div><div className="l">Charts</div></div>
            <div className="stat">
              <div className="n">{tally.targets ? Math.round((100 * tally.hits) / tally.targets) + '%' : '—'}</div>
              <div className="l">Levels found</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
          {round.targets.map((t, i) => {
            const placed = prices[i] !== null;
            const isArmed = armed === i;
            return (
              <button
                key={t.id}
                className={`slot-chip${isArmed ? ' armed' : ''}${placed ? ' placed' : ''}`}
                disabled={scored}
                onClick={() => setArmed(i)}
                title={levelFullName(t.id)}
              >
                <b>
                  {t.id}
                  {placed ? ` · ${prices[i]!.toFixed(0)}` : ''}
                </b>
                <span>{levelFullName(t.id)}</span>
              </button>
            );
          })}
        </div>
        {!scored && (
          <div className="muted small" style={{ marginBottom: 8 }}>
            {armed !== null && prices[armed] === null
              ? `Click the chart to place ${round.targets[armed].id} — ${levelFullName(round.targets[armed].id).toLowerCase()}.`
              : armed !== null
                ? `${round.targets[armed].id} selected — drag its line to adjust, or click the chart to re-place it.`
                : 'All levels placed. Click a chip to select one, then drag or re-place its line. Score when ready.'}
          </div>
        )}
        {mergedNotes.map((note) => (
          <div key={note} className="muted small" style={{ marginBottom: 8 }}>
            ℹ️ {note}
          </div>
        ))}

        <CandleChart
          bars={round.view}
          levels={scored ? round.set.levels : []}
          clusters={scored ? round.set.clusters : []}
          vwapSeries={scored ? round.set.vwapSeries : undefined}
          userMarks={marks}
          includePrices={round.targets.map((t) => t.price)}
          onPriceClick={!scored && armed !== null ? placeArmed : undefined}
          dragIndex={chartDragIndex}
          onMarkMove={!scored ? moveMark : undefined}
          height={420}
          showTime={!round.isSample}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          {!scored ? (
            <>
              <button className="nextbtn" onClick={score} disabled={!placedCount}>
                {placedCount < prices.length ? `Score (${placedCount}/${prices.length} placed)` : 'Score my levels'}
              </button>
              <button
                className="ghostbtn"
                onClick={() => {
                  setPrices(round.targets.map(() => null));
                  setArmed(0);
                }}
                disabled={!placedCount}
              >
                Clear
              </button>
            </>
          ) : (
            <button className="nextbtn" onClick={() => void next()}>Next chart →</button>
          )}
        </div>

        {scored && results && (
          <div className="reveal show">
            <div className={`verdict ${hits === round.targets.length ? 'ok' : hits > 0 ? 'mid' : 'no'}`}>
              {hits}/{round.targets.length} key levels found
            </div>
            <div style={{ marginTop: 6 }}>
              {round.targets.map((t, i) => {
                const r = results[i];
                return (
                  <div key={t.id} className="small" style={{ color: r.hit ? 'var(--good)' : 'var(--bad)', marginBottom: 2 }}>
                    {r.hit ? '✓' : '✗'} {t.id} — {levelFullName(t.id)}:{' '}
                    {r.placed ? `off by ${r.off!.toFixed(1)} pts` : 'not placed'}
                  </div>
                );
              })}
            </div>
            {round.set.clusters.length > 0 && (
              <div className="muted small" style={{ marginTop: 6 }}>
                {round.set.clusters.length} confluence zone{round.set.clusters.length > 1 ? 's' : ''} (★) — where
                levels stack, they matter more.
              </div>
            )}
            {round.isSample && (
              <div className="muted small" style={{ marginTop: 6 }}>
                Practicing on the built-in sample dataset — import real MNQ data in the Data tab for the real thing.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
