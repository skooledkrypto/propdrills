import { useEffect } from 'react';
import { useApp, type View } from './state/store';
import { Learn } from './ui/Learn';
import { Drill } from './ui/Drill';
import { LevelDrill } from './ui/LevelDrill';
import { FullSetup } from './ui/FullSetup';
import { Challenge } from './ui/Challenge';
import { Stats } from './ui/Stats';
import { DataScreen } from './ui/DataScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { Paywall } from './ui/Paywall';
import { Onboarding } from './ui/Onboarding';
import { initPurchases, useEntitlement } from './ui/purchases';

const TABS: { id: View; label: string }[] = [
  { id: 'learn', label: 'Learn' },
  { id: 'drill', label: 'Drill' },
  { id: 'levels', label: 'Levels' },
  { id: 'fullsetup', label: 'Full Setup' },
  { id: 'challenge', label: 'Challenge' },
  { id: 'stats', label: 'Stats' },
  { id: 'data', label: 'Data' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const { ready, view, setView, init, paywallOpen, closePaywall, profileName, onboarded } = useApp();
  const isPro = useEntitlement();

  useEffect(() => {
    void init();
    void initPurchases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <header>
        <div>
          <h1>
            📈 Prop<span className="brand-accent">Drills</span> — MNQ Setup Trainer
            {isPro && <span className="pro-badge">★ PRO</span>}
          </h1>
          <div className="sub">
            {profileName
              ? `${profileName} — location first, pattern second.`
              : 'Location first, pattern second. Drill your eye until it\'s automatic.'}
          </div>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={view === t.id ? 'active' : ''} onClick={() => setView(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {!ready ? (
          <div className="card muted">Loading…</div>
        ) : view === 'learn' ? (
          <Learn />
        ) : view === 'drill' ? (
          <Drill />
        ) : view === 'levels' ? (
          <LevelDrill />
        ) : view === 'fullsetup' ? (
          <FullSetup />
        ) : view === 'challenge' ? (
          <Challenge />
        ) : view === 'stats' ? (
          <Stats />
        ) : view === 'data' ? (
          <DataScreen />
        ) : (
          <SettingsScreen />
        )}
        <div className="foot">
          Your progress stays on this device — no email accounts, no analytics. Optional Cloud Sync
          (Settings) links your devices with a private code.<br />
          Outcomes shown are historical or illustrative teaching aids, not predictions — real setups
          fail often. Education tool only, not financial advice; trading MNQ is leveraged and risky.
          <br />
          <a href="/about.html">About — veteran built &amp; operated</a> ·{' '}
          <a href="/learn/">Free guides</a> · <a href="/drawdown-calculator.html">DD calculator</a> ·{' '}
          <a
            href="https://apps.apple.com/us/app/prop-drills/id6798395246"
            target="_blank"
            rel="noreferrer"
          >
            Get the iOS app
          </a>{' '}
          · <a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Use</a> ·{' '}
          charts by{' '}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView
          </a>
        </div>
        <Paywall open={paywallOpen} onClose={closePaywall} />
        {ready && !onboarded && <Onboarding />}
      </main>
    </>
  );
}
