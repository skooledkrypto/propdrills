import { useMemo, useState } from 'react';
import { PATTERNS, PATTERN_ORDER } from '../core/patterns';
import type { PatternId } from '../core/types';
import { mulberry32, synthDrill } from '../core/synth';
import { CandleChart } from '../chart/CandleChart';
import { ProUpsellCard } from './ProUpsell';

type LearnId = PatternId | 'key-levels';

const LEVEL_ROWS: { name: string; what: string; why: string }[] = [
  { name: 'PDH / PDL', what: 'Prior regular-session (09:30–16:00 ET) high and low.', why: 'The most-watched reference prices in futures. Stops pool beyond them; sweeps of these are the bread-and-butter of thin sessions.' },
  { name: 'ONH / ONL', what: 'Overnight (Globex) high and low since the 18:00 ET reopen.', why: 'The developing range of the current session — breaks and failed breaks of these define the overnight structure.' },
  { name: 'Prior close', what: 'Last regular-session close (settlement proxy).', why: 'The "unchanged" line. Price accepts or rejects the prior day here.' },
  { name: 'Round numbers', what: 'Multiples of 50 and 100 index points.', why: 'Purely psychological — and self-fulfilling. Resting orders cluster at them.' },
  { name: 'VWAP', what: 'Session volume-weighted average price (dynamic).', why: "The session's average paid price. Trend days ride one side of it; chop days orbit it." },
  { name: 'Swing highs/lows', what: 'Obvious recent pivots.', why: 'Secondary — matters most when they line up with something above.' },
];

export function Learn() {
  const [cur, setCur] = useState<LearnId>('key-levels');

  const example = useMemo(() => {
    if (cur === 'key-levels') return null;
    // stable seeded example, bullish orientation (v1 behaviour)
    return synthDrill(cur, {
      difficulty: 'easy',
      rng: mulberry32(42 + PATTERN_ORDER.indexOf(cur)),
      allowMirror: false,
    });
  }, [cur]);

  const info = cur === 'key-levels' ? null : PATTERNS[cur];

  return (
    <section>
      <div className="card intro">
        <h2>How to use this deck</h2>
        <p className="muted">
          Backtests are blunt about it: a candlestick pattern on its own is a weak edge. What turns it
          into a real setup is <b>location + context + exits</b>. So every pattern here is taught the
          same way — <b>it only counts when it forms at a level you marked in advance</b>, in a market
          whose structure agrees.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Start with <b>Key Levels</b> — the "where" — then work one pattern at a time. Read it here,
          switch to <b>Drill</b>, and focus that single pattern until your accuracy is consistently
          high. The "No Setup" reps matter as much as the others — most of the tape is nothing, and
          learning to pass is a real skill.
        </p>
      </div>
      <div className="learn-wrap">
        <div className="learn-list">
          <button className={cur === 'key-levels' ? 'active' : ''} onClick={() => setCur('key-levels')}>
            📍 Key Levels — the "where"
          </button>
          {PATTERN_ORDER.map((id) => (
            <button key={id} className={cur === id ? 'active' : ''} onClick={() => setCur(id)}>
              {PATTERNS[id].name}
            </button>
          ))}
        </div>
        <div className="learn-main">
          {cur === 'key-levels' ? (
            <div className="card">
              <h2>Key levels — where setups are allowed to exist</h2>
              <p className="muted">
                A key level is a price where meaningful trading happened before, so price is likely to
                react there again. Treat levels as <b>zones a few points wide</b>, not exact lines. The
                app computes and draws all of these automatically on every drill.
              </p>
              <table>
                <thead>
                  <tr><th>Level</th><th>What it is</th><th>Why it matters</th></tr>
                </thead>
                <tbody>
                  {LEVEL_ROWS.map((r) => (
                    <tr key={r.name}><td style={{ whiteSpace: 'nowrap' }}><b>{r.name}</b></td><td>{r.what}</td><td className="muted">{r.why}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="kv" style={{ marginTop: 14 }}>
                <div className="field">
                  <div className="lab">The pre-session routine</div>
                  <div>
                    Before each session: mark PDH, PDL, ONH, ONL and the nearest round number. Then{' '}
                    <b>do nothing until price reaches one of them.</b> That single habit removes most
                    over-trading.
                  </div>
                </div>
                <div className="field">
                  <div className="lab">Confluence</div>
                  <div>
                    When two or more references sit within ~15 points of each other (say PDL and a
                    round 100), that cluster is a <b>stronger</b> level. Charts mark these with a gold
                    ★ line. Prefer setups there.
                  </div>
                </div>
                <div className="field">
                  <div className="lab">Train it</div>
                  <div>
                    The <b>Levels</b> tab is a dedicated drill: charts with the levels hidden — you tap
                    where they should be, and get scored against the computed ones.
                  </div>
                </div>
              </div>
            </div>
          ) : info && example ? (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>{info.name}</h2>
                <span className="pill gold">{info.cat}</span>
                {cur !== 'no' && <span className="pill">shown as bullish — flip vertically for the bearish twin</span>}
              </div>
              <CandleChart
                bars={example.bars}
                levels={example.levelSet.levels}
                markers={[{ t: example.bars[example.bars.length - 1].t, bias: example.bias }]}
                height={330}
                showTime={false}
              />
              <div className="legend">
                Dashed line = the level. Marker = the pattern bar(s).{' '}
                {cur === 'no' ? 'Here there is no valid reaction — you pass.' : ''}
              </div>
              <div className="kv">
                <div className="field"><div className="lab">What it is</div><div>{info.def}</div></div>
                <div className="field"><div className="lab">Why it works</div><div>{info.why}</div></div>
                <div className="field"><div className="lab">What to look for</div><div>{info.look}</div></div>
                <div className="field"><div className="lab">Common trap</div><div>{info.trap}</div></div>
                {info.evidence && (
                  <div className="field"><div className="lab">Evidence note</div><div>{info.evidence}</div></div>
                )}
              </div>
              <div className="ets">
                <div><div className="lab">Entry</div><span>{info.entry}</span></div>
                <div><div className="lab">Stop</div><span>{info.stop}</span></div>
                <div><div className="lab">Target</div><span>{info.target}</span></div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <ProUpsellCard />
    </section>
  );
}
