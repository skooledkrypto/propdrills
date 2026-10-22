import { useCallback, useEffect, useRef, useState } from 'react';
import { PATTERNS, PATTERN_ORDER, TRIGGERS } from '../core/patterns';
import type { DrillInstance, PatternId } from '../core/types';
import { nextPattern, dueCount } from '../core/scheduler';
import { useApp } from '../state/store';
import { getDrill } from './drillService';
import { CandleChart } from '../chart/CandleChart';
import { flagInstance } from '../storage/db';

type Source = 'synthetic' | 'real';

export function Drill() {
  const { cfg, progress, answer, meta, libCounts, refreshData } = useApp();
  const [source, setSource] = useState<Source>('synthetic');
  const [focus, setFocus] = useState<PatternId | 'all'>('all');
  const [difficulty, setDifficulty] = useState<'easy' | 'hard'>('hard');
  const [inst, setInst] = useState<DrillInstance | null>(null);
  const [picked, setPicked] = useState<PatternId | null>(null);
  const [flagged, setFlagged] = useState(false);
  const recentIds = useRef<Set<string>>(new Set());
  const seq = useRef(0);

  const { sessionSeen, sessionCorrect, streak, best } = useApp();
  const hasRealData = Object.values(libCounts).some((n) => n > 0);
  const due = dueCount(progress, Date.now());

  const next = useCallback(async () => {
    const mySeq = ++seq.current;
    setPicked(null);
    setFlagged(false);
    const patternId = nextPattern(progress, Date.now(), {
      noSetupRate: cfg.noSetupRate,
      focus: focus === 'all' ? null : focus,
    });
    const d = await getDrill(patternId, source, cfg, difficulty, recentIds.current);
    if (mySeq !== seq.current) return; // a newer request superseded this one
    recentIds.current.add(d.id);
    if (recentIds.current.size > 12) {
      recentIds.current.delete(recentIds.current.values().next().value as string);
    }
    setInst(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, focus, source, difficulty, progress]);

  useEffect(() => {
    void next();
    // regenerate when controls change (not on every progress change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, source, difficulty]);

  if (!inst) return <div className="card muted">Loading drill…</div>;

  const answered = picked !== null;
  const correct = picked === inst.patternId;
  const info = PATTERNS[inst.patternId];

  const options: PatternId[] =
    focus === 'all' ? PATTERN_ORDER : ([focus, 'no'] as PatternId[]);

  const pick = (id: PatternId) => {
    if (answered) return;
    setPicked(id);
    answer({
      patternId: inst.patternId,
      correct: id === inst.patternId,
      mode: 'drill',
      source: inst.source,
      realizedMove: inst.source === 'real' ? inst.realizedMove : undefined,
    });
  };

  const flag = async () => {
    if (flagged || inst.source !== 'real') return;
    await flagInstance({ instanceId: inst.id, reason: 'bad-label', t: Date.now() });
    setFlagged(true);
    void refreshData();
  };

  const levelLine = inst.levelHit
    ? `${info.name} at ${inst.levelHit.label}${inst.confluent ? ' — ★ confluence zone (stronger)' : ''}`
    : `${info.name} — no clean level interaction`;

  return (
    <section>
      <div className="card">
        <div className="controls">
          <label className="ctl">
            Mode
            <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="synthetic">Fundamentals — synthetic charts</option>
              <option value="real" disabled={!hasRealData}>
                Realistic — real data{hasRealData ? '' : ' (import in Data tab)'}
              </option>
            </select>
          </label>
          <label className="ctl">
            Focus
            <select value={focus} onChange={(e) => setFocus(e.target.value as PatternId | 'all')}>
              <option value="all">All patterns (mixed)</option>
              {TRIGGERS.map((id) => (
                <option key={id} value={id}>{PATTERNS[id].name}</option>
              ))}
            </select>
          </label>
          {source === 'synthetic' && (
            <label className="ctl">
              Difficulty
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'easy' | 'hard')}>
                <option value="easy">Easy — cleaner charts</option>
                <option value="hard">Realistic — more noise</option>
              </select>
            </label>
          )}
          <div className="scoreboard">
            <div className="stat"><div className="n">{sessionSeen}</div><div className="l">Seen</div></div>
            <div className="stat"><div className="n">{sessionSeen ? Math.round((100 * sessionCorrect) / sessionSeen) + '%' : '—'}</div><div className="l">Accuracy</div></div>
            <div className="stat"><div className="n">{streak}</div><div className="l">Streak</div></div>
            <div className="stat"><div className="n">{best}</div><div className="l">Best</div></div>
            <div className="stat due"><div className="n">{due}</div><div className="l">Due today</div></div>
          </div>
        </div>

        <CandleChart
          bars={inst.bars}
          outcome={answered ? inst.outcomeBars : []}
          levels={inst.levelSet.levels}
          clusters={inst.levelSet.clusters}
          vwapSeries={inst.levelSet.vwapSeries}
          markers={answered ? [{ t: inst.bars[inst.bars.length - 1].t, bias: inst.bias }] : []}
          showTime={inst.source === 'real'}
          height={380}
        />
        <div className="legend">
          {inst.source === 'real'
            ? 'Real MNQ 1-minute bars with auto-computed levels (gold = prior day, blue = overnight, purple = round numbers, teal = VWAP). Judge the right edge.'
            : "Levels you'd have marked before the session are drawn. Judge only what's happening at the level, at the right edge of the chart."}
        </div>

        <div className="q">What is price doing at the level?</div>
        <div className="opts">
          {options.map((id) => (
            <button
              key={id}
              disabled={answered}
              className={
                answered && id === inst.patternId ? 'correct' : answered && id === picked ? 'wrong' : ''
              }
              onClick={() => pick(id)}
            >
              {PATTERNS[id].short}
            </button>
          ))}
        </div>

        {answered && (
          <div className="reveal show">
            <div className={`verdict ${correct ? 'ok' : 'no'}`}>
              {correct ? '✓ Correct — ' : '✗ Not quite — '}
              {levelLine}
              {inst.patternId !== 'no' && ` (${inst.bias === 'long' ? 'bullish / long' : 'bearish / short'})`}
            </div>
            <div>
              <b>What to see:</b> {info.look} <b>Trap:</b> {info.trap}
            </div>
            <div className="legend">
              {inst.source === 'real' ? (
                inst.patternId === 'no' ? (
                  'No trade — the correct move was to stay flat. The faded candles are what actually happened next.'
                ) : (
                  <>
                    The faded candles are the <b>actual</b> next {inst.outcomeBars.length} minutes:{' '}
                    price moved <b>{(inst.realizedMove ?? 0) >= 0 ? '+' : ''}{(inst.realizedMove ?? 0).toFixed(1)} pts</b>{' '}
                    {(inst.realizedMove ?? 0) >= 0 ? 'with' : 'against'} the setup direction. Real
                    setups fail often — the edge is location + stops across many trades, not any single one.
                  </>
                )
              ) : inst.patternId === 'no' ? (
                'No trade — the correct move was to stay flat. The faded candles show it just kept chopping.'
              ) : (
                `The faded candles show one illustrative way it could resolve ${inst.bias === 'long' ? 'upward' : 'downward'}. Real setups fail often — the edge is in taking many with a tight stop, not in any single trade.`
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="nextbtn" onClick={() => void next()}>Next chart →</button>
              {inst.source === 'real' && (
                <button className="ghostbtn" onClick={() => void flag()} disabled={flagged}>
                  {flagged ? 'Flagged — won\'t reappear' : '⚑ Bad label? Flag it'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {source === 'real' && meta && (
        <div className="card muted small">
          Drilling on {meta.symbol} · {new Date(meta.firstBar).toLocaleDateString()} –{' '}
          {new Date(meta.lastBar).toLocaleDateString()} · session filter: {cfg.sessionFilter}
        </div>
      )}
    </section>
  );
}
