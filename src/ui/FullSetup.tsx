import { useCallback, useEffect, useRef, useState } from 'react';
import { PATTERNS, PATTERN_ORDER } from '../core/patterns';
import type { DrillInstance, PatternId } from '../core/types';
import { nextPattern } from '../core/scheduler';
import { nearestLevel } from '../core/levels';
import { useApp } from '../state/store';
import { getDrill } from './drillService';
import { CandleChart } from '../chart/CandleChart';

/**
 * Full-setup mode (brief §4.4): grade the whole decision chain —
 * location -> context -> trigger -> risk. The closest thing to the real
 * decision, and the top difficulty tier.
 */

type StepId = 'location' | 'context' | 'trigger' | 'risk';

interface StepResult {
  id: StepId;
  picked: string;
  correct: boolean;
  truth: string;
}

const STOP_OPTIONS: { key: string; label: string }[] = [
  { key: 'beyondExtreme', label: "Just beyond the pattern's extreme / wick" },
  { key: 'backThroughLevel', label: 'Back through the broken level' },
  { key: 'oppositeInside', label: 'Opposite side of the inside bar' },
  { key: 'none', label: 'No stop needed if the level is strong' },
];

function structureTruth(inst: DrillInstance): 'up' | 'down' | 'sideways' {
  const closes = inst.bars.map((b) => b.c);
  const n = closes.length;
  const k = Math.max(5, Math.floor(n / 4));
  const early = closes.slice(0, k).reduce((a, b) => a + b, 0) / k;
  const late = closes.slice(n - k).reduce((a, b) => a + b, 0) / k;
  const ranges = inst.bars.map((b) => b.h - b.l);
  const ar = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const diff = late - early;
  if (diff > 2.5 * ar) return 'up';
  if (diff < -2.5 * ar) return 'down';
  return 'sideways';
}

export function FullSetup() {
  const { cfg, progress, answer, libCounts } = useApp();
  const [inst, setInst] = useState<DrillInstance | null>(null);
  const [step, setStep] = useState<StepId>('location');
  const [results, setResults] = useState<StepResult[]>([]);
  const [pending, setPending] = useState<StepResult | null>(null);
  const [finished, setFinished] = useState(false);
  const seq = useRef(0);
  const hasRealData = Object.values(libCounts).some((n) => n > 0);

  const next = useCallback(async () => {
    const mySeq = ++seq.current;
    setResults([]);
    setPending(null);
    setFinished(false);
    setStep('location');
    const patternId = nextPattern(progress, Date.now(), { noSetupRate: cfg.noSetupRate });
    const d = await getDrill(patternId, hasRealData ? 'real' : 'synthetic', cfg, 'hard', new Set());
    if (mySeq !== seq.current) return;
    setInst(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, progress, hasRealData]);

  useEffect(() => {
    void next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!inst) return <div className="card muted">Loading…</div>;

  const lastClose = inst.bars[inst.bars.length - 1].c;
  const atLevelTruth = nearestLevel(inst.levelSet, lastClose, cfg.tol * 1.5) !== null || inst.levelHit !== null;
  const structTruth = structureTruth(inst);
  const info = PATTERNS[inst.patternId];

  const answerStep = (id: StepId, picked: string, truth: string, labels?: Record<string, string>) => {
    if (pending || finished) return;
    const r: StepResult = {
      id,
      picked: labels?.[picked] ?? picked,
      correct: picked === truth,
      truth: labels?.[truth] ?? truth,
    };
    setPending(r);
  };

  const advance = () => {
    if (!pending) return;
    const rs = [...results, pending];
    setResults(rs);
    setPending(null);
    const order: StepId[] = ['location', 'context', 'trigger', 'risk'];
    const idx = order.indexOf(pending.id);
    const skipRisk = inst.patternId === 'no';
    const nextStep = order[idx + 1];
    if (!nextStep || (nextStep === 'risk' && skipRisk)) {
      // finished — grade the chain
      const triggerOk = rs.find((r) => r.id === 'trigger')?.correct ?? false;
      const riskOk = skipRisk ? true : rs.find((r) => r.id === 'risk')?.correct ?? false;
      answer({
        patternId: inst.patternId,
        correct: triggerOk && riskOk,
        mode: 'fullSetup',
        source: inst.source,
        realizedMove: inst.source === 'real' ? inst.realizedMove : undefined,
      });
      setFinished(true);
    } else {
      setStep(nextStep);
    }
  };

  const yn = { yes: 'Yes', no: 'No' };
  const structLabels = { up: 'Trending up', down: 'Trending down', sideways: 'Sideways / range' };

  return (
    <section>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Full-setup mode</h2>
          <span className="muted small">
            Grade the whole chain: location → context → trigger → risk. This is the closest thing to
            the live decision.
          </span>
        </div>

        <CandleChart
          bars={inst.bars}
          outcome={finished ? inst.outcomeBars : []}
          levels={inst.levelSet.levels}
          clusters={inst.levelSet.clusters}
          vwapSeries={inst.levelSet.vwapSeries}
          markers={finished ? [{ t: inst.bars[inst.bars.length - 1].t, bias: inst.bias }] : []}
          showTime={inst.source === 'real'}
          height={380}
        />

        {/* chain progress */}
        <div className="chain">
          {(['location', 'context', 'trigger', 'risk'] as StepId[]).map((s) => {
            const done = results.find((r) => r.id === s);
            const skipped = s === 'risk' && inst.patternId === 'no' && finished;
            return (
              <span
                key={s}
                className={`chip ${done ? (done.correct ? 'good' : 'bad') : skipped ? '' : s === step && !finished ? 'active' : ''}`}
              >
                {s === 'location' ? '1 · Location' : s === 'context' ? '2 · Context' : s === 'trigger' ? '3 · Trigger' : '4 · Risk'}
                {done ? (done.correct ? ' ✓' : ' ✗') : skipped ? ' —' : ''}
              </span>
            );
          })}
        </div>

        {!finished && !pending && step === 'location' && (
          <>
            <div className="q">1 · Location — is price interacting with a key level right now?</div>
            <div className="opts">
              <button onClick={() => answerStep('location', 'yes', atLevelTruth ? 'yes' : 'no', yn)}>Yes — at a level</button>
              <button onClick={() => answerStep('location', 'no', atLevelTruth ? 'yes' : 'no', yn)}>No — mid-range / nowhere</button>
            </div>
          </>
        )}

        {!finished && !pending && step === 'context' && (
          <>
            <div className="q">2 · Context — what is the recent structure doing?</div>
            <div className="opts">
              {(['up', 'down', 'sideways'] as const).map((s) => (
                <button key={s} onClick={() => answerStep('context', s, structTruth, structLabels)}>
                  {structLabels[s]}
                </button>
              ))}
            </div>
          </>
        )}

        {!finished && !pending && step === 'trigger' && (
          <>
            <div className="q">3 · Trigger — is there a valid setup at the level?</div>
            <div className="opts">
              {PATTERN_ORDER.map((id: PatternId) => (
                <button key={id} onClick={() => answerStep('trigger', id, inst.patternId, Object.fromEntries(PATTERN_ORDER.map((p) => [p, PATTERNS[p].short])))}>
                  {PATTERNS[id].short}
                </button>
              ))}
            </div>
          </>
        )}

        {!finished && !pending && step === 'risk' && (
          <>
            <div className="q">4 · Risk — where does the protective stop belong for a {info.short}?</div>
            <div className="opts">
              {STOP_OPTIONS.map((o) => (
                <button key={o.key} onClick={() => answerStep('risk', o.key, info.stopKey, Object.fromEntries(STOP_OPTIONS.map((x) => [x.key, x.label])))}>
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}

        {pending && (
          <div className="reveal show">
            <div className={`verdict ${pending.correct ? 'ok' : 'no'}`}>
              {pending.correct ? '✓ Right.' : `✗ Not quite — the answer was: ${pending.truth}.`}
            </div>
            {pending.id === 'location' && (
              <div className="muted">
                {atLevelTruth
                  ? 'Price is inside the tolerance zone of a computed level — a setup is at least allowed to exist here.'
                  : 'No computed level within tolerance — whatever the candles look like, this is the dead middle. Pass.'}
              </div>
            )}
            {pending.id === 'context' && (
              <div className="muted">Structure over the lead-in leans {structLabels[structTruth].toLowerCase()}. Triggers against the structure need far more proof.</div>
            )}
            {pending.id === 'trigger' && (
              <div className="muted">
                <b>{info.name}.</b> {info.look}
              </div>
            )}
            {pending.id === 'risk' && <div className="muted"><b>Stop:</b> {info.stop} <b>Target:</b> {info.target}</div>}
            <button className="nextbtn" onClick={advance}>Continue →</button>
          </div>
        )}

        {finished && (
          <div className="reveal show">
            <div className={`verdict ${results.every((r) => r.correct) ? 'ok' : results.find((r) => r.id === 'trigger')?.correct ? 'mid' : 'no'}`}>
              Chain: {results.filter((r) => r.correct).length}/{results.length} correct —{' '}
              {inst.levelHit ? `this was ${info.name} at ${inst.levelHit.label}${inst.confluent ? ' (★ confluence)' : ''}` : `this was ${info.name}`}
              {inst.patternId !== 'no' && ` · ${inst.bias === 'long' ? 'long' : 'short'}`}
            </div>
            {inst.source === 'real' && inst.patternId !== 'no' && (
              <div className="muted">
                Actual outcome: {(inst.realizedMove ?? 0) >= 0 ? '+' : ''}
                {(inst.realizedMove ?? 0).toFixed(1)} pts over the next {inst.outcomeBars.length} minutes.
              </div>
            )}
            <div className="muted small" style={{ marginTop: 6 }}>
              Only a chain that's right end-to-end counts as a tradeable decision — the scheduler
              records this rep against {info.short}.
            </div>
            <button className="nextbtn" onClick={() => void next()}>Next setup →</button>
          </div>
        )}
      </div>
    </section>
  );
}
