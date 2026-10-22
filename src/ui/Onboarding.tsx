import { useState } from 'react';
import { useApp } from '../state/store';
import type { SyncAccount } from '../core/sync';
import { createAndLinkSyncAccount, readSyncAccount } from './cloudSync';
import { chartPalette, levelColorsFor, useColorblind, useScheme } from './theme';

/**
 * First-visit welcome tour, shown until finished or skipped ('dm.onboarded').
 * Mirrors the mobile OnboardingScreen, adapted to the web tabs (Full Setup,
 * Data) and the web Challenge (single-session evaluation, not a campaign).
 * Pure presentation — replayable from Settings.
 */

const N_PAGES = 7;

/** Decorative mini candle chart for the welcome page. */
function HeroChart({ w, h }: { w: number; h: number }) {
  const scheme = useScheme();
  const cb = useColorblind();
  const p = chartPalette(scheme, cb);
  const levelColor = levelColorsFor(p);
  // hand-placed candles: a pullback to a level, then continuation up
  const candles: [number, number, number, number][] = [
    [10, 58, 30, 48], [22, 50, 26, 32], [34, 40, 22, 26], [46, 34, 18, 30],
    [58, 44, 26, 40], [70, 48, 34, 38], [82, 46, 30, 34], [94, 40, 22, 26],
    [106, 32, 14, 18], [118, 26, 8, 12], [130, 20, 4, 8],
  ];
  const sx = w / 145;
  const sy = h / 66;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
      <line x1={0} x2={w} y1={40 * sy} y2={40 * sy} stroke={levelColor.PDH} strokeWidth={1.2} strokeDasharray="6,5" />
      <line x1={0} x2={w} y1={16 * sy} y2={16 * sy} stroke={levelColor.ONH} strokeWidth={1} strokeDasharray="6,5" />
      {candles.map(([x, hi, lo, cl], i) => {
        const op = i === 0 ? Math.min(hi - 4, cl + 8) : candles[i - 1][3];
        const up = cl <= op; // y grows downward
        const col = up ? p.up : p.down;
        const top = Math.min(op, cl);
        return (
          <g key={i}>
            <line x1={(x + 3) * sx} x2={(x + 3) * sx} y1={lo * sy} y2={hi * sy} stroke={col} strokeWidth={1.4} />
            <rect x={x * sx} y={top * sy} width={6 * sx} height={Math.max(Math.abs(op - cl), 1.5) * sy} fill={col} rx={1} />
          </g>
        );
      })}
    </svg>
  );
}

/** One glossary term: a sample of its chart line + name + meaning. */
function Term({ color, dash, name, desc }: { color: string; dash?: string; name: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
      <svg width={34} height={10} style={{ flexShrink: 0 }}>
        <line x1={0} x2={34} y1={5} y2={5} stroke={color} strokeWidth={2} strokeDasharray={dash} />
      </svg>
      <div>
        <b style={{ fontSize: 13.5 }}>{name}</b>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
}

/** One row of the tab tour: icon chip + what that tab trains. */
function TabRow({ icon, name, desc }: { icon: string; name: string; desc: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', alignItems: 'flex-start' }}>
      <div className="tour-icon">{icon}</div>
      <div>
        <b style={{ fontSize: 14 }}>{name}</b>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}

/** Static mock of a challenge meter, for the evaluation page. */
function MockMeter({ label, frac, text, colorVar }: { label: string; frac: number; text: string; colorVar: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span className="muted" style={{ fontSize: 9.5, width: 64, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>
        {label}
      </span>
      <div className="bar" style={{ flex: 1 }}>
        <i style={{ width: `${frac * 100}%`, background: `var(${colorVar})` }} />
      </div>
      <b style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{text}</b>
    </div>
  );
}

export function Onboarding() {
  const { profileName, setProfileName, setOnboarded } = useApp();
  const scheme = useScheme();
  const cb = useColorblind();
  const levelColor = levelColorsFor(chartPalette(scheme, cb));
  const [page, setPage] = useState(0);
  const [name, setName] = useState(profileName);
  const [sync, setSync] = useState<SyncAccount | null>(readSyncAccount);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncErr, setSyncErr] = useState('');
  const [copied, setCopied] = useState(false);

  const makeAccount = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncErr('');
    try {
      setSync(await createAndLinkSyncAccount());
    } catch (e) {
      setSyncErr((e as Error).message);
    } finally {
      setSyncBusy(false);
    }
  };

  const copyCode = async () => {
    if (!sync) return;
    try {
      await navigator.clipboard.writeText(sync.code);
      setCopied(true);
    } catch {
      // clipboard blocked — the code is selectable text
    }
  };

  const finish = () => {
    if (name.trim()) setProfileName(name.trim());
    setOnboarded(true);
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 70 }}>
      <div className="card modal-card tour-card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 24 }}>
          {page < N_PAGES - 1 && (
            <button className="closebtn" onClick={finish} style={{ fontSize: 13 }}>
              Skip
            </button>
          )}
        </div>

        {page === 0 && (
          <div>
            <h1 style={{ fontSize: 30, margin: '4px 0 2px' }}>
              Prop<span className="brand-accent">Drills</span>
            </h1>
            <p className="muted" style={{ margin: '0 0 16px' }}>Train like you're funded.</p>
            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: 'var(--chart-bg)',
                padding: 14,
                marginBottom: 16,
              }}
            >
              <HeroChart w={460} h={130} />
            </div>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              Short daily reps that build one skill: reading MNQ price action around the levels that
              matter — then proving it in a simulated prop-firm evaluation.
            </p>
            <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              <b>Location first, pattern second.</b>{' '}
              <span className="muted">
                No real money, no account needed — everything stays in this browser.
              </span>
            </p>
          </div>
        )}

        {page === 1 && (
          <div>
            <h2 style={{ marginTop: 0 }}>Speak the language</h2>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 6 }}>
              Five levels do most of the work on an MNQ chart. You'll see them drawn exactly like
              this everywhere in the app:
            </p>
            <Term color={levelColor.PDH} dash="6,5" name="PDH / PDL" desc="Prior day high & low — yesterday's extremes, the first magnets for stop runs." />
            <Term color={levelColor.ONH} dash="6,5" name="ONH / ONL" desc="Overnight high & low — the range built while the US session slept." />
            <Term color={levelColor.PC} dash="2,4" name="Prior close" desc="Yesterday's settlement — above it buyers are in charge, below it sellers." />
            <Term color={levelColor.VWAP} name="VWAP" desc="Volume-weighted average price — the session's fair value line." />
            <Term color={levelColor.R50} dash="2,4" name="Round numbers" desc="…00 and …50 levels where resting orders cluster." />
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 0 }}>
              Where price is relative to these levels matters more than any candle pattern. That's
              the whole method.
            </p>
          </div>
        )}

        {page === 2 && (
          <div>
            <h2 style={{ marginTop: 0 }}>Learn it, then drill it</h2>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 4 }}>
              The first two tabs build the foundation — concepts in, reps out:
            </p>
            <TabRow icon="📖" name="Learn" desc="Short lessons on each level, setup and session quirk — plus a plain-English key-terms glossary. The why behind every drill." />
            <TabRow icon="🎯" name="Drill" desc="Rapid-fire pattern recognition: read a chart, call the next move, get instant feedback. Spaced repetition keeps serving what you miss." />
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 0 }}>
              Five focused minutes a day beats an hour of chart-staring. Streaks and session stats
              keep you honest.
            </p>
          </div>
        )}

        {page === 3 && (
          <div>
            <h2 style={{ marginTop: 0 }}>Mark the chart yourself</h2>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 4 }}>
              Recognizing a level someone drew is easy. Drawing it yourself is the skill:
            </p>
            <TabRow icon="📍" name="Levels" desc="A naked chart — you place PDH, PDL, ONH and ONL from memory, then watch whether price respects your marks." />
            <TabRow icon="🧩" name="Full Setup" desc="The full morning read: pick the levels, call the bias, commit before the reveal." />
            <TabRow icon="💾" name="Data" desc="Drills work out of the box on realistic generated data — or import your own purchased MNQ 1-minute CSV here to train on real tape." />
          </div>
        )}

        {page === 4 && (
          <div>
            <h2 style={{ marginTop: 0 }}>Prove it in the Challenge</h2>
            <p className="muted" style={{ fontSize: 13.5 }}>
              🏆 A simulated prop-firm evaluation on replayed tape, with the same shape real firms
              use — <b style={{ color: 'var(--txt)' }}>one rule, one objective</b>:
            </p>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
              <b style={{ fontSize: 13 }}>⛔ The rule</b>
              <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>
                Never touch the trailing drawdown or the daily loss limit. Touch either and the
                evaluation fails on the spot.
              </p>
              <b style={{ fontSize: 13 }}>🎯 The objective</b>
              <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 2px' }}>
                Hit the profit target before the session ends — with the rule intact.
              </p>
              <MockMeter label="Target" frac={0.62} text="$1,860 / $3,000" colorVar="--accent" />
              <MockMeter label="DD room" frac={0.8} text="$1,600" colorVar="--good" />
              <MockMeter label="Day room" frac={0.35} text="$350" colorVar="--gold" />
            </div>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 0, marginTop: 12 }}>
              Pick an account size, trade the replay one bar at a time, and see exactly which rule
              you broke when it goes wrong. That's the point.
            </p>
          </div>
        )}

        {page === 5 && (
          <div>
            <h2 style={{ marginTop: 0 }}>One account for phone &amp; web</h2>
            <p className="muted" style={{ fontSize: 13.5 }}>
              ☁️ <b style={{ color: 'var(--txt)' }}>Cloud Sync</b> links your devices with a private
              code — no email, no password. A Pro purchase on any device unlocks every device, and
              your progress can back up to the cloud.
            </p>
            {!sync ? (
              <>
                <button className="nextbtn" style={{ width: '100%' }} disabled={syncBusy} onClick={() => void makeAccount()}>
                  {syncBusy ? 'Creating…' : 'Create my sync code'}
                </button>
                {syncErr && <p className="muted small" style={{ marginTop: 8 }}>{syncErr}</p>}
                <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
                  Totally optional — you can create or enter a code any time in Settings → Cloud
                  Sync. Skip it and everything simply stays in this browser.
                </p>
              </>
            ) : (
              <>
                <div
                  style={{
                    background: 'var(--panel2)',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    padding: 14,
                    textAlign: 'center',
                  }}
                >
                  <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    Your sync code
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 17, margin: '6px 0 10px', userSelect: 'all' }}>{sync.code}</div>
                  <button className="ghostbtn" style={{ marginTop: 0 }} onClick={() => void copyCode()}>
                    {copied ? 'Copied ✓' : 'Copy code'}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
                  Save it somewhere safe (it's also in Settings → Cloud Sync), and enter it on your
                  phone under Settings → Cloud Sync to link it. Anyone with the code can access the
                  account, so keep it private.
                </p>
              </>
            )}
          </div>
        )}

        {page === 6 && (
          <div>
            <h2 style={{ marginTop: 0 }}>Make it yours</h2>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
              Pick a trader name for your stats and streaks. Your profile and every rep stay in
              this browser{sync ? ' (plus your cloud backups)' : ' — no email, no signup'}.
            </p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finish();
              }}
              placeholder="Trader name"
              maxLength={40}
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
            />
            <button className="nextbtn" style={{ width: '100%' }} onClick={finish}>
              {name.trim() ? 'Start training' : 'Start without a name'}
            </button>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 12, marginBottom: 0 }}>
              Education tool only — simulated trading, no real money, not financial advice.
            </p>
          </div>
        )}

        <div className="tour-dots">
          {Array.from({ length: N_PAGES }, (_, i) => (
            <button
              key={i}
              className={`tour-dot${i === page ? ' active' : ''}`}
              onClick={() => setPage(i)}
              aria-label={`Page ${i + 1}`}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {page > 0 && (
            <button className="ghostbtn" style={{ marginTop: 0 }} onClick={() => setPage(page - 1)}>
              Back
            </button>
          )}
          {page < N_PAGES - 1 && (
            <button className="nextbtn" style={{ flex: 1, marginTop: 0 }} onClick={() => setPage(page + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
