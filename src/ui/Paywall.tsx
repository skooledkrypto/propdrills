import { useEffect, useState } from 'react';
import { PAYWALL_VARIANT } from '../core/entitlement';
import { PRIVACY_TEXT, TERMS_TEXT } from '../core/legal';
import { getEntitlement, getPlans, purchase, purchasesMode, restore, useEntitlement, type PlanInfo } from './purchases';

const VALUE_PROPS = [
  ['🏆', 'Unlimited challenge attempts'],
  ['💼', 'All account sizes — $25k, $50k and $100k'],
  ['🎛️', 'Scenario picker: trend, chop, news-spike, reversal'],
  ['📊', 'Full challenge history & analytics'],
  ['🤖', 'AI trade review (coming soon)'],
] as const;

function LegalOverlay({ doc, onClose }: { doc: 'terms' | 'privacy' | null; onClose: () => void }) {
  if (!doc) return null;
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      style={{ zIndex: 60 }}
    >
      <div className="card modal-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>{doc === 'terms' ? 'Terms of Use' : 'Privacy Policy'}</b>
          <button className="closebtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>
          {doc === 'terms' ? TERMS_TEXT : PRIVACY_TEXT}
        </p>
      </div>
    </div>
  );
}

export function Paywall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isPro = useEntitlement();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [selected, setSelected] = useState<PlanInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy' | null>(null);

  useEffect(() => {
    if (!open) return;
    setMsg('');
    void getPlans().then((p) => {
      const lead = PAYWALL_VARIANT === 'lifetime-first' ? 'lifetime' : 'monthly';
      const ordered = [...p].sort((a, b) => (a.id === lead ? -1 : b.id === lead ? 1 : 0));
      setPlans(ordered);
      setSelected(ordered[0] ?? null);
    });
  }, [open]);

  useEffect(() => {
    if (isPro && open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro]);

  if (!open) return null;

  const buy = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setMsg('');
    const res = await purchase(selected);
    setBusy(false);
    if (res.ok) {
      setMsg('Welcome to Pro ✓');
    } else if (res.error) {
      setMsg(res.error);
    }
  };

  const doRestore = async () => {
    setBusy(true);
    const res = await restore();
    setBusy(false);
    setMsg(res.ok ? (getEntitlement() ? 'Purchases restored ✓' : 'No previous purchase found.') : res.error ?? '');
  };

  const cta = selected?.trial ? 'Start free trial' : selected?.id === 'lifetime' ? 'Unlock forever' : 'Continue';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow">👑 PROPDRILLS PRO</span>
          <button className="closebtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <h2 style={{ fontSize: 19, margin: '8px 0 4px' }}>Train like it's the real evaluation</h2>
        <p className="muted small">
          Free gets you every recognition drill and a taste of Challenge Mode. Pro removes the limits.
        </p>

        {VALUE_PROPS.map(([icon, txt]) => (
          <div key={txt} className="valueprop">
            <span>{icon}</span>
            <span>{txt}</span>
          </div>
        ))}

        <div style={{ marginTop: 10 }}>
          {plans.map((p, i) => (
            <button
              key={`${p.id}${i}`}
              className={selected === p ? 'plan-card sel' : 'plan-card'}
              onClick={() => setSelected(p)}
            >
              <span className="plan-main">
                <b>{p.title}{p.id === 'annual' ? '  ·  save vs monthly' : ''}</b>
                {p.trial && <em className="plan-trial">{p.trial}</em>}
              </span>
              <b className="plan-price">{p.price}</b>
              <span className="muted small">{p.period}</span>
            </button>
          ))}
        </div>

        <button
          className="nextbtn"
          style={{ width: '100%' }}
          onClick={() => void buy()}
          disabled={busy || !selected}
        >
          {busy ? '…' : cta}
        </button>
        <button className="ghostbtn" style={{ width: '100%', marginTop: 8 }} onClick={() => void doRestore()} disabled={busy}>
          Restore Purchases
        </button>
        {msg && <p className="muted small" style={{ textAlign: 'center', marginTop: 8, marginBottom: 0 }}>{msg}</p>}
        {purchasesMode() === 'mock' && (
          <div className="mockbanner">
            Sandbox: purchases run in mock mode on this build (no RevenueCat key configured). Real
            purchases activate once VITE_RC_WEB_KEY is set.
          </div>
        )}
        {purchasesMode() === 'unavailable' && (
          <div className="mockbanner">
            Purchases aren't available on this build yet — everything free stays free. Check back
            soon.
          </div>
        )}

        <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 11, lineHeight: 1.5 }}>
          Subscriptions auto-renew until cancelled. Payment is charged at purchase confirmation.
          Manage or cancel anytime in your account settings. Lifetime is a one-time purchase, not a
          subscription.
        </p>
        {purchasesMode() === 'web' && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 11, lineHeight: 1.5 }}>
            Purchases are linked to this browser. Keep your email receipt, and export a backup from
            Settings — importing it restores your purchase on a new browser or after clearing site
            data.
          </p>
        )}
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <button className="linkbtn" onClick={() => setLegalDoc('terms')} style={{ color: 'var(--info)', fontSize: 11.5 }}>
            Terms of Use
          </button>
          <button className="linkbtn" onClick={() => setLegalDoc('privacy')} style={{ color: 'var(--info)', fontSize: 11.5 }}>
            Privacy Policy
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 11, lineHeight: 1.5 }}>
          PropDrills is a simulated-trading education tool. It is not financial advice, offers no
          real-money trading, and is not affiliated with any proprietary trading firm. Simulated
          results do not reflect real trading.
        </p>
      </div>
      <LegalOverlay doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </div>
  );
}
