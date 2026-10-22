import { useApp } from '../state/store';
import { purchasesMode, useEntitlement } from './purchases';

/**
 * Gold Pro pitch card for the bottom of free-tier screens — the web twin of
 * mobile's ProUpsellCard. Renders nothing for Pro users, and nothing on
 * keyless deploys where the paywall couldn't sell anyway.
 */
export function ProUpsellCard() {
  const isPro = useEntitlement();
  const { openPaywall } = useApp();
  if (isPro || purchasesMode() === 'unavailable') return null;
  return (
    <div className="card" style={{ borderColor: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 6%, var(--panel))' }}>
      <div style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>
        PROPDRILLS PRO
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>Run the full evaluation, your way</div>
      <p className="muted small" style={{ margin: '6px 0 10px' }}>
        Unlimited challenge evaluations, every account size, the scenario picker, and your full
        attempt history.
      </p>
      <button className="nextbtn" style={{ marginTop: 0 }} onClick={openPaywall}>
        See Pro plans
      </button>
    </div>
  );
}
