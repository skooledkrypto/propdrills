import { useRef, useState } from 'react';
import { DEFAULT_CONFIG } from '../core/config';
import { SUPPORT_EMAIL } from '../core/legal';
import { describeBackup, parseBackup, serializeBackup } from '../core/backup';
import {
  deleteSyncAccount,
  fetchSyncStatus,
  normalizeSyncCode,
  pushSyncBackup,
  type SyncAccount,
} from '../core/sync';
import { createAndLinkSyncAccount, readSyncAccount, saveSyncAccount } from './cloudSync';
import { useApp } from '../state/store';
import { getColorblind, getThemePref, setColorblind, setThemePref, type ThemePref } from './theme';
import { getBillingUserId, linkBillingUser, purchasesMode, restore, setProForDev, useEntitlement } from './purchases';

function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="setting">
      <span>
        {label}
        {hint && <em className="muted small"> — {hint}</em>}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}

export function SettingsScreen() {
  const { cfg, setCfg, resetProgress, progress, attempts, importBackup, openPaywall, profileName, setProfileName, setOnboarded } = useApp();
  const isPro = useEntitlement();
  const [confirming, setConfirming] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [proMsg, setProMsg] = useState('');
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const [cb, setCbState] = useState<boolean>(getColorblind);
  const [sync, setSync] = useState<SyncAccount | null>(readSyncAccount);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const changeTheme = (pref: ThemePref) => {
    setThemePrefState(pref);
    setThemePref(pref);
  };

  const changeCb = (on: boolean) => {
    setCbState(on);
    setColorblind(on);
  };

  const exportProgress = () => {
    const json = serializeBackup({
      platform: 'web',
      progress,
      attempts,
      profileName: profileName || undefined,
      rcUserId: getBillingUserId() ?? undefined,
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `propdrills-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMsg('Backup downloaded. On the phone, open the file, copy its text, and use "Import from clipboard".');
  };

  const importFile = async (file: File) => {
    const res = parseBackup(await file.text());
    if (!res.ok) {
      setBackupMsg(res.error);
      return;
    }
    if (!window.confirm(`${describeBackup(res.payload)}\n\nThis replaces the progress in this browser. Import?`)) return;
    await importBackup(res.payload);
    setBackupMsg('Progress imported ✓');
  };

  const restorePurchases = async () => {
    const res = await restore();
    setProMsg(res.ok ? 'Purchases restored ✓' : res.error ?? 'Restore failed.');
  };

  const currentBackupJson = () =>
    serializeBackup({
      platform: 'web',
      progress,
      attempts,
      profileName: profileName || undefined,
      rcUserId: getBillingUserId() ?? undefined,
    });

  const saveSync = (acct: SyncAccount | null) => {
    saveSyncAccount(acct);
    setSync(acct);
  };

  const withSyncBusy = async (fn: () => Promise<void>) => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncMsg('');
    try {
      await fn();
    } catch (e) {
      setSyncMsg((e as Error).message);
    } finally {
      setSyncBusy(false);
    }
  };

  const syncCreate = () =>
    withSyncBusy(async () => {
      const acct = await createAndLinkSyncAccount();
      await pushSyncBackup(acct.code, currentBackupJson());
      setSync(acct);
      setSyncMsg('Sync code created and progress backed up ✓ — save the code somewhere safe.');
    });

  const syncLink = () =>
    withSyncBusy(async () => {
      const raw = window.prompt('Enter the sync code from your other device (PD-XXXX-XXXX-XXXX-XXXX):') ?? '';
      if (!raw.trim()) return;
      const code = normalizeSyncCode(raw);
      if (!code) {
        setSyncMsg("That doesn't look like a sync code — it has the form PD-XXXX-XXXX-XXXX-XXXX.");
        return;
      }
      const status = await fetchSyncStatus(code);
      await linkBillingUser(status.userId);
      if (status.backup) {
        const parsed = parseBackup(status.backup);
        if (parsed.ok && window.confirm(`${describeBackup(parsed.payload)}\n\nRestore this cloud backup here? (This replaces the progress in this browser.)`)) {
          await importBackup(parsed.payload);
        }
      }
      saveSync({ code, userId: status.userId });
      setSyncMsg('Device linked ✓ — purchases and cloud backups now follow this account.');
    });

  const syncPush = () =>
    withSyncBusy(async () => {
      if (!sync) return;
      await pushSyncBackup(sync.code, currentBackupJson());
      setSyncMsg('Progress backed up to the cloud ✓');
    });

  const syncPull = () =>
    withSyncBusy(async () => {
      if (!sync) return;
      const status = await fetchSyncStatus(sync.code);
      if (!status.backup) {
        setSyncMsg('No cloud backup stored yet — use "Back up now" on the device with your progress.');
        return;
      }
      const parsed = parseBackup(status.backup);
      if (!parsed.ok) {
        setSyncMsg(parsed.error);
        return;
      }
      if (!window.confirm(`${describeBackup(parsed.payload)}\n\nRestore this cloud backup here? (This replaces the progress in this browser.)`)) return;
      await importBackup(parsed.payload);
      setSyncMsg('Cloud backup restored ✓');
    });

  const syncDelete = () =>
    withSyncBusy(async () => {
      if (!sync) return;
      if (!window.confirm('Delete your cloud account? The sync code stops working and the cloud copy of your progress is erased everywhere. Progress already on your devices stays put.')) return;
      await deleteSyncAccount(sync.code);
      saveSync(null);
      setSyncMsg('Cloud account deleted ✓');
    });

  return (
    <section>
      <div className="card">
        <h2>Profile</h2>
        <label className="setting">
          <span>
            Trader name
            <em className="muted small"> — shown in the header; stays in this browser, no account</em>
          </span>
          <input
            type="text"
            value={profileName}
            maxLength={40}
            placeholder="Trader name"
            onChange={(e) => setProfileName(e.target.value)}
          />
        </label>
        <button className="ghostbtn" onClick={() => setOnboarded(false)}>
          Replay welcome tour
        </button>
      </div>
      <div className="card">
        <h2>Appearance</h2>
        <label className="setting">
          <span>
            Theme
            <em className="muted small"> — System follows your OS light/dark setting</em>
          </span>
          <select value={themePref} onChange={(e) => changeTheme(e.target.value as ThemePref)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="setting">
          <span>
            Colorblind mode
            <em className="muted small"> — up/down and P&amp;L use blue/orange instead of green/red</em>
          </span>
          <input type="checkbox" checked={cb} onChange={(e) => changeCb(e.target.checked)} />
        </label>
      </div>
      <div className="card">
        <h2>Progress backup</h2>
        <p className="muted small">
          Progress lives in this browser. Move it between devices with a backup file — the same
          format the mobile app exports and imports.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="ghostbtn" onClick={exportProgress}>
            Export progress (.json)
          </button>
          <button className="ghostbtn" onClick={() => fileRef.current?.click()}>
            Import backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {backupMsg && <p className="muted small" style={{ marginTop: 8 }}>{backupMsg}</p>}
      </div>
      <div className="card">
        <h2>Cloud Sync</h2>
        {!sync ? (
          <>
            <p className="muted small">
              Link your phone and this browser with a private sync code — no email, no password.
              Purchases made on either device unlock Pro on both, and you can back up progress to
              the cloud. Create the code on the device where you bought Pro, then link the others.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="ghostbtn" disabled={syncBusy} onClick={() => void syncCreate()}>
                Create sync code
              </button>
              <button className="ghostbtn" disabled={syncBusy} onClick={() => void syncLink()}>
                Link with a code…
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              Sync code: <b style={{ userSelect: 'all' }}>{sync.code}</b> — enter it on your other
              devices to link them. Anyone with the code can access this account, so keep it private.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="ghostbtn" disabled={syncBusy} onClick={() => void syncPush()}>
                Back up now
              </button>
              <button className="ghostbtn" disabled={syncBusy} onClick={() => void syncPull()}>
                Restore from cloud
              </button>
              <button className="ghostbtn" disabled={syncBusy} onClick={() => saveSync(null)}>
                Unlink this browser
              </button>
              <button className="ghostbtn danger" disabled={syncBusy} onClick={() => void syncDelete()}>
                Delete cloud account…
              </button>
            </div>
          </>
        )}
        {syncMsg && <p className="muted small" style={{ marginTop: 8 }}>{syncMsg}</p>}
      </div>
      <div className="card">
        <h2>Session</h2>
        <label className="setting">
          <span>
            Drill session filter
            <em className="muted small"> — which part of the trading day real drills are sampled from</em>
          </span>
          <select
            value={cfg.sessionFilter}
            onChange={(e) => setCfg({ sessionFilter: e.target.value as typeof cfg.sessionFilter })}
          >
            <option value="any">Any session</option>
            <option value="rth">RTH only (09:30–16:00 ET)</option>
            <option value="evening">Evening Globex (first hours after 18:00 ET reopen)</option>
            <option value="overnight">Full overnight (18:00 ET → 09:30 ET)</option>
          </select>
        </label>
        {cfg.sessionFilter === 'evening' && (
          <Num label="Evening window length (hours after reopen)" value={cfg.eveningHours} onChange={(n) => setCfg({ eveningHours: n })} min={1} max={15} />
        )}
        <label className="setting">
          <span>
            VWAP anchor
            <em className="muted small"> — where the session VWAP resets</em>
          </span>
          <select value={cfg.vwapAnchor} onChange={(e) => setCfg({ vwapAnchor: e.target.value as 'rth' | 'globex' })}>
            <option value="rth">RTH open (09:30 ET) — default</option>
            <option value="globex">Globex reopen (18:00 ET)</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h2>Levels &amp; detector tolerances</h2>
        <p className="muted small">
          These feed both level drawing and the auto-labeler. Changes to detector rules apply on the
          next scan — use “Re-scan with current settings” in the Data tab afterwards.
        </p>
        <Num label="Level zone tolerance (pts)" hint='how close counts as "at the level"' value={cfg.tol} onChange={(n) => setCfg({ tol: n })} min={2} max={50} />
        <Num label="Confluence cluster width (pts)" value={cfg.confluenceTol} onChange={(n) => setCfg({ confluenceTol: n })} min={2} max={50} />
        <Num label="Sweep pierce (pts)" hint="how far the wick must run past the level" value={cfg.sweepPts} onChange={(n) => setCfg({ sweepPts: n })} min={1} max={25} step={0.5} />
        <Num label="Sweep reclaim (pts)" value={cfg.reclaimPts} onChange={(n) => setCfg({ reclaimPts: n })} min={0.5} max={20} step={0.5} />
        <Num label="Pin wick : body ratio" value={cfg.pinRatio} onChange={(n) => setCfg({ pinRatio: n })} min={1.5} max={5} step={0.5} />
        <Num label="Lead-in bars shown" value={cfg.leadInBars} onChange={(n) => setCfg({ leadInBars: n })} min={30} max={180} />
        <Num label="Outcome bars revealed" value={cfg.outcomeBars} onChange={(n) => setCfg({ outcomeBars: n })} min={5} max={60} />
      </div>

      <div className="card">
        <h2>Scheduler</h2>
        <Num
          label="'No Setup' share of drills"
          hint="0.15–0.25 recommended — passing is a skill"
          value={cfg.noSetupRate}
          onChange={(n) => setCfg({ noSetupRate: n })}
          min={0}
          max={0.5}
          step={0.05}
        />
      </div>

      <div className="card">
        <h2>PropDrills Pro</h2>
        <p className="muted small">
          Status:{' '}
          {isPro ? <b style={{ color: 'var(--good)' }}>Pro active ✓</b> : <b>Free plan</b>}
          {' — '}Pro unlocks unlimited challenge attempts, all account sizes, the scenario picker and
          full history.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="ghostbtn" onClick={openPaywall}>View plans</button>
          <button className="ghostbtn" onClick={() => void restorePurchases()}>Restore Purchases</button>
          {purchasesMode() === 'mock' && (
            <button className="ghostbtn" onClick={() => setProForDev(!isPro)}>Toggle mock Pro (dev)</button>
          )}
        </div>
        {proMsg && <p className="muted small" style={{ marginTop: 8 }}>{proMsg}</p>}
      </div>

      <div className="card">
        <h2>About PropDrills</h2>
        <p className="muted small">
          Veteran built, owned, and operated. PropDrills started as the founder&apos;s personal
          trainer for reading MNQ price action and is kept cheap on purpose so price is never the
          reason someone skips their reps. Education tool only — not financial advice.
        </p>
        <p className="muted small">
          Support: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="ghostbtn" href="/about.html">
            Our story
          </a>
          <a
            className="ghostbtn"
            href="https://apps.apple.com/us/app/prop-drills/id6798395246"
            target="_blank"
            rel="noreferrer"
          >
            Get the iOS app
          </a>
        </div>
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="ghostbtn"
            onClick={() => {
              setCfg({ ...DEFAULT_CONFIG });
            }}
          >
            Restore default settings
          </button>
          {!confirming ? (
            <button className="ghostbtn danger" onClick={() => setConfirming(true)}>
              Reset all progress &amp; stats…
            </button>
          ) : (
            <>
              <button
                className="ghostbtn danger"
                onClick={() => {
                  void resetProgress();
                  setConfirming(false);
                }}
              >
                Yes, wipe my stats permanently
              </button>
              <button className="ghostbtn" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
