import { PATTERNS, PATTERN_ORDER } from '../core/patterns';
import { accuracy, dueCount, overdueFactor } from '../core/scheduler';
import { accuracyTrend, calledSetupExpectancy } from '../core/scoring';
import { useApp } from '../state/store';

function TrendChart({ points }: { points: { day: string; accuracy: number; seen: number }[] }) {
  if (points.length < 2) return <div className="muted small">Drill on at least two different days to see a trend.</div>;
  const w = 640;
  const h = 120;
  const pad = 24;
  const xs = points.map((_, i) => pad + (i * (w - 2 * pad)) / (points.length - 1));
  const ys = points.map((p) => h - pad - p.accuracy * (h - 2 * pad));
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', maxWidth: 720 }} role="img" aria-label="accuracy trend">
      {[0.5, 0.8].map((g) => (
        <g key={g}>
          <line x1={pad} x2={w - pad} y1={h - pad - g * (h - 2 * pad)} y2={h - pad - g * (h - 2 * pad)} style={{ stroke: 'var(--line)' }} strokeDasharray="4 4" />
          <text x={4} y={h - pad - g * (h - 2 * pad) + 4} style={{ fill: 'var(--muted)' }} fontSize={10}>{Math.round(g * 100)}%</text>
        </g>
      ))}
      <path d={path} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth={2} />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={3} style={{ fill: 'var(--accent)' }}>
          <title>{`${points[i].day}: ${Math.round(points[i].accuracy * 100)}% (${points[i].seen} drills)`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function Stats() {
  const { progress, attempts, flaggedCount } = useApp();
  const now = Date.now();
  const due = dueCount(progress, now);
  const trend = accuracyTrend(attempts);
  const exp = calledSetupExpectancy(attempts);
  const anySeen = PATTERN_ORDER.some((id) => (progress.perPattern[id]?.seen ?? 0) > 0);

  return (
    <section>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Your recognition stats</h2>
          <span className="pill gold">{due} pattern{due === 1 ? '' : 's'} due today</span>
        </div>
        <p className="muted small">
          Lifetime accuracy per pattern (persists across sessions). Aim for a stable ~80%+ on each
          before trusting it live. Box = Leitner spaced-repetition box (1 = every session … 5 = ~2 weeks).
        </p>
        {!anySeen && <p className="muted">Do some drills to populate this.</p>}
        {anySeen && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Pattern</th><th>Seen</th><th>Correct</th><th style={{ width: 180 }}>Accuracy</th><th>Streak</th><th>Box</th><th>Status</th></tr>
              </thead>
              <tbody>
                {PATTERN_ORDER.map((id) => {
                  const pp = progress.perPattern[id];
                  if (!pp || !pp.seen) return null;
                  const acc = Math.round(accuracy(pp) * 100);
                  const isDue = pp.box === 0 || now >= pp.dueAt || overdueFactor(pp, now) > 0;
                  return (
                    <tr key={id}>
                      <td>{PATTERNS[id].name}</td>
                      <td>{pp.seen}</td>
                      <td>{pp.correct}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="bar"><i style={{ width: `${acc}%`, background: acc >= 80 ? 'var(--good)' : acc >= 60 ? 'var(--gold)' : 'var(--bad)' }} /></div>
                          <span>{acc}%</span>
                        </div>
                      </td>
                      <td>{pp.streak}</td>
                      <td>{pp.box || '—'}</td>
                      <td className="muted small">{isDue ? 'due' : `next ${new Date(pp.dueAt).toLocaleDateString()}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Accuracy over time</h2>
        <TrendChart points={trend} />
      </div>

      <div className="row">
        <div className="card" style={{ flex: 1, minWidth: 260 }}>
          <h2>Called-setup expectancy (real data)</h2>
          {exp.n ? (
            <p className="muted">
              Across <b>{exp.n}</b> real-data drills where a setup was present, the actual forward move
              averaged <b>{exp.avgMove >= 0 ? '+' : ''}{exp.avgMove.toFixed(1)} pts</b> over the reveal
              window. Historical illustration only — not a prediction, not advice.
            </p>
          ) : (
            <p className="muted">Drill in Realistic mode to see what setups actually did next.</p>
          )}
          {flaggedCount > 0 && <p className="muted small">{flaggedCount} auto-label{flaggedCount > 1 ? 's' : ''} flagged as bad — excluded from drills.</p>}
        </div>
        <div className="card" style={{ flex: 2, minWidth: 300 }}>
          <h2>Why drilling this works</h2>
          <p className="muted" style={{ margin: 0 }}>
            Recognition is a trainable skill built by reps + immediate feedback. Live, a session gives
            you maybe 1–3 setups. Here you can see hundreds. When your focused accuracy is high and
            stable, move to bar-replay on a real platform (NinjaTrader Market Replay / TradingView Bar
            Replay) to add live noise — then, and only then, consider funded evaluations.
          </p>
        </div>
      </div>
    </section>
  );
}
