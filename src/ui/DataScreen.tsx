import { useRef, useState } from 'react';
import { parseCsv, type CsvReport, type DeclaredTz } from '../core/csv';
import { generateSampleSeries } from '../core/synth';
import { toET } from '../core/sessions';
import type { Candle } from '../core/types';
import { PATTERNS } from '../core/patterns';
import { loadBars, replaceBars, replaceLibrary, wipeData } from '../storage/db';
import { useApp } from '../state/store';
import { invalidateLevelDrillCache } from './LevelDrill';
import type { DetectResponse } from '../workers/detector.worker';

type Phase = 'idle' | 'parsed' | 'storing' | 'scanning' | 'done' | 'error';

export function DataScreen() {
  const { cfg, meta, libCounts, flaggedCount, refreshData } = useApp();
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState<CsvReport | null>(null);
  const [pendingBars, setPendingBars] = useState<Candle[] | null>(null);
  const [pendingSource, setPendingSource] = useState('');
  const [tz, setTz] = useState<DeclaredTz>('utc');
  const [progressFrac, setProgressFrac] = useState(0);
  const [error, setError] = useState('');
  const [resultCount, setResultCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File) => {
    setError('');
    setPhase('idle');
    const text = await f.text();
    const r = parseCsv(text, tz);
    if (!r.bars.length) {
      setError('No valid bars found in that file. Expected columns: timestamp, open, high, low, close, volume.');
      setPhase('error');
      return;
    }
    setReport(r);
    setPendingBars(r.bars);
    setPendingSource(`csv:${f.name}`);
    setPhase('parsed');
  };

  const makeSample = () => {
    setError('');
    const bars = generateSampleSeries(30, 42, toET);
    setReport(null);
    setPendingBars(bars);
    setPendingSource('synthetic-sample');
    setPhase('parsed');
  };

  const runScan = async (bars: Candle[], store: boolean) => {
    try {
      if (store) {
        setPhase('storing');
        await replaceBars(bars, {
          symbol: pendingSource === 'synthetic-sample' ? 'MNQ (sample data)' : 'MNQ',
          source: pendingSource,
          firstBar: bars[0].t,
          lastBar: bars[bars.length - 1].t,
          count: bars.length,
          importedAt: Date.now(),
        });
        invalidateLevelDrillCache();
      }
      setPhase('scanning');
      setProgressFrac(0);
      const worker = new Worker(new URL('../workers/detector.worker.ts', import.meta.url), {
        type: 'module',
      });
      const instances = await new Promise<DetectResponse & { type: 'done' }>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<DetectResponse>) => {
          if (e.data.type === 'progress') setProgressFrac(e.data.frac);
          else if (e.data.type === 'done') resolve(e.data);
          else reject(new Error(e.data.message));
        };
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ bars, cfg });
      }).finally(() => worker.terminate());
      await replaceLibrary(instances.instances);
      setResultCount(instances.instances.length);
      await refreshData();
      setPhase('done');
      setPendingBars(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const rescan = async () => {
    const bars = await loadBars();
    if (bars.length) await runScan(bars, false);
  };

  const clearAll = async () => {
    if (!window.confirm('Remove the imported dataset and detected drill library? (Progress/stats are kept.)')) return;
    await wipeData();
    invalidateLevelDrillCache();
    await refreshData();
    setPhase('idle');
    setReport(null);
    setPendingBars(null);
  };

  const totalLib = Object.values(libCounts).reduce((a, b) => a + b, 0);
  const busy = phase === 'storing' || phase === 'scanning';

  return (
    <section>
      <div className="card">
        <h2>Current dataset</h2>
        {meta ? (
          <p className="muted">
            <b>{meta.symbol}</b> · {meta.count.toLocaleString()} one-minute bars ·{' '}
            {new Date(meta.firstBar).toLocaleDateString()} → {new Date(meta.lastBar).toLocaleDateString()} ·
            imported {new Date(meta.importedAt).toLocaleString()}
          </p>
        ) : (
          <p className="muted">No dataset loaded yet. Import a CSV below, or generate the built-in sample to try everything instantly.</p>
        )}
        {totalLib > 0 && (
          <>
            <p className="muted small" style={{ marginBottom: 6 }}>
              Drill library: <b>{totalLib.toLocaleString()}</b> auto-labeled instances
              {flaggedCount ? ` (${flaggedCount} flagged/excluded)` : ''}:
            </p>
            <div className="chips">
              {Object.entries(libCounts).map(([id, n]) => (
                <span key={id} className="chip">{PATTERNS[id as keyof typeof PATTERNS]?.short ?? id}: {n}</span>
              ))}
            </div>
          </>
        )}
        {meta && (
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="ghostbtn" onClick={() => void rescan()} disabled={busy}>
              Re-scan with current settings
            </button>
            <button className="ghostbtn danger" onClick={() => void clearAll()} disabled={busy}>
              Remove dataset
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Import real MNQ data (CSV)</h2>
        <p className="muted small">
          Expected schema: <code>timestamp, open, high, low, close, volume</code> — 1-minute bars.
          Timestamps may be epoch seconds/ms/ns or ISO; if they have no timezone, declare it here.
          <b> Your data never leaves this device</b>, and the repo's .gitignore keeps it out of git —
          CME data is licensed and must stay local (see README).
        </p>
        <div className="controls" style={{ marginBottom: 0 }}>
          <label className="ctl">
            Naive timestamps are in
            <select value={tz} onChange={(e) => setTz(e.target.value as DeclaredTz)}>
              <option value="utc">UTC</option>
              <option value="et">America/New_York (ET)</option>
              <option value="pt">America/Los_Angeles (PT)</option>
            </select>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <button className="nextbtn" onClick={() => fileRef.current?.click()} disabled={busy}>
            Choose CSV file…
          </button>
          <button className="ghostbtn" onClick={makeSample} disabled={busy}>
            Or generate sample dataset (synthetic, 30 days)
          </button>
        </div>

        {report && phase === 'parsed' && (
          <div className="reveal show">
            <div className="verdict ok">Parsed OK — ready to import</div>
            <div className="muted small">
              {report.bars.length.toLocaleString()} bars · {report.skipped} malformed rows skipped ·{' '}
              {report.duplicates} duplicates collapsed · {report.gaps.length} unusual intraday gaps
              {report.firstBar && (
                <> · {new Date(report.firstBar).toLocaleString()} → {new Date(report.lastBar!).toLocaleString()}</>
              )}
            </div>
            {report.warnings.map((w, i) => (
              <div key={i} className="warn">⚠ {w}</div>
            ))}
          </div>
        )}
        {pendingBars && phase === 'parsed' && (
          <button className="nextbtn" style={{ marginTop: 12 }} onClick={() => void runScan(pendingBars, true)}>
            Import &amp; scan for setups →
          </button>
        )}
        {busy && (
          <div className="reveal show">
            <div className="verdict">{phase === 'storing' ? 'Storing bars…' : `Scanning for setups… ${Math.round(progressFrac * 100)}%`}</div>
            <div className="bar big"><i style={{ width: `${Math.round(progressFrac * 100)}%` }} /></div>
          </div>
        )}
        {phase === 'done' && (
          <div className="reveal show">
            <div className="verdict ok">✓ Done — {resultCount.toLocaleString()} labeled drill instances ready</div>
            <div className="muted small">Head to the Drill tab and switch Mode to “Realistic — real data”.</div>
          </div>
        )}
        {phase === 'error' && <div className="warn" style={{ marginTop: 10 }}>⚠ {error}</div>}
      </div>

      <div className="card">
        <h2>Getting MNQ data from Databento</h2>
        <p className="muted small" style={{ marginBottom: 8 }}>
          A helper script is included. In a terminal, from the project folder:
        </p>
        <pre className="code">{`1. Put your API key in .env      (DATABENTO_API_KEY=db-xxxx — file is gitignored)
2. npm run fetch-data -- --start 2025-02-01 --end 2025-07-31
3. Import the CSV it writes to data\\mnq-1m.csv above (timestamps are UTC)`}</pre>
        <p className="muted small" style={{ margin: 0 }}>
          Databento charges per-GB after the free starter credit; ~6 months of MNQ 1-min OHLCV is
          tiny (a few MB). The script downloads to the gitignored <code>data/</code> folder — licensed
          CME data must never be committed or redistributed.
        </p>
      </div>
    </section>
  );
}
