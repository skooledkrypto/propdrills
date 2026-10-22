import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { PAYWALL_VARIANT } from '../core';
import { useApp } from '../store';
import { getPlans, purchase, purchasesMode, restore, type PlanInfo } from '../purchases';
import { Btn, Muted, useThemedStyles } from '../ui';
import { RADIUS, tint } from '../theme';
import { LegalSheet, type LegalDoc } from './LegalSheet';

const VALUE_PROPS = [
  ['🏆', 'Unlimited challenge attempts'],
  ['💼', 'All account sizes — $25k, $50k and $100k'],
  ['🎛️', 'Scenario picker: trend, chop, news-spike, reversal'],
  ['📊', 'Full challenge history & analytics'],
  ['🤖', 'AI trade review (coming soon)'],
] as const;

export function PaywallSheet() {
  const { paywallVisible, hidePaywall, isPro } = useApp();
  const { c } = useThemedStyles();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [selected, setSelected] = useState<PlanInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDoc>(null);

  useEffect(() => {
    if (!paywallVisible) return;
    setMsg('');
    setPlansLoaded(false);
    void getPlans().then((p) => {
      const ordered =
        PAYWALL_VARIANT === 'lifetime-first'
          ? [...p].sort((a, b) => (a.id === 'lifetime' ? -1 : b.id === 'lifetime' ? 1 : 0))
          : p;
      setPlans(ordered);
      setSelected(ordered[0] ?? null);
      setPlansLoaded(true);
    });
  }, [paywallVisible]);

  useEffect(() => {
    if (isPro && paywallVisible) hidePaywall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro]);

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
    setMsg(res.ok ? (useApp.getState().isPro ? 'Purchases restored ✓' : 'No previous purchase found.') : res.error ?? '');
  };

  const cta = selected?.trial ? 'Start free trial' : selected?.id === 'lifetime' ? 'Unlock forever' : 'Continue';

  return (
    <Modal visible={paywallVisible} animationType="slide" transparent onRequestClose={hidePaywall}>
      <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: c.bg,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            borderWidth: 1,
            borderColor: c.line,
            maxHeight: '92%',
          }}
        >
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 34 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: c.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }}>
                👑 PROPDRILLS PRO
              </Text>
              <Pressable onPress={hidePaywall} hitSlop={12}>
                <Text style={{ color: c.muted, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ color: c.txt, fontSize: 21, fontWeight: '800', marginTop: 8, marginBottom: 4 }}>
              Train like it's the real evaluation
            </Text>
            <Muted style={{ marginBottom: 14 }}>
              Free gets you every recognition drill and a taste of Challenge Mode. Pro removes the limits.
            </Muted>

            {VALUE_PROPS.map(([icon, txt]) => (
              <View key={txt} style={{ flexDirection: 'row', gap: 9, marginBottom: 8, alignItems: 'center' }}>
                <Text style={{ fontSize: 14 }}>{icon}</Text>
                <Text style={{ color: c.txt, fontSize: 13.5, flex: 1 }}>{txt}</Text>
              </View>
            ))}

            <View style={{ height: 8 }} />
            {plansLoaded && plans.length === 0 && (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: c.line,
                  backgroundColor: c.panel,
                  borderRadius: RADIUS.control,
                  padding: 13,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: c.txt, fontSize: 13 }}>
                  Plans aren't available right now. Check your connection and try again in a
                  moment — everything free stays fully usable meanwhile.
                </Text>
              </View>
            )}
            {plans.map((p, i) => {
              const sel = selected === p;
              return (
                <Pressable
                  key={`${p.id}${i}`}
                  onPress={() => setSelected(p)}
                  style={{
                    borderWidth: sel ? 2 : 1,
                    borderColor: sel ? c.gold : c.line,
                    backgroundColor: sel ? tint(c.gold, 0.08) : c.panel,
                    borderRadius: RADIUS.control,
                    padding: 13,
                    marginBottom: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.txt, fontWeight: '700', fontSize: 14 }}>
                      {p.title}
                      {p.id === 'annual' ? '  ·  save vs monthly' : ''}
                    </Text>
                    {p.trial ? <Text style={{ color: c.gold, fontSize: 11.5, fontWeight: '600' }}>{p.trial}</Text> : null}
                  </View>
                  <Text style={{ color: c.txt, fontWeight: '800', fontSize: 15 }}>{p.price}</Text>
                  <Text style={{ color: c.muted, fontSize: 11 }}>{p.period}</Text>
                </Pressable>
              );
            })}

            {plans.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <Btn label={busy ? '…' : cta} kind="primary" onPress={() => void buy()} disabled={busy || !selected} />
              </View>
            )}
            <View style={{ marginTop: 8 }}>
              <Btn label="Restore Purchases" onPress={() => void doRestore()} disabled={busy} />
            </View>
            {msg ? <Muted style={{ marginTop: 8, textAlign: 'center' }}>{msg}</Muted> : null}
            {purchasesMode() === 'mock' && (
              <View
                style={{
                  marginTop: 10,
                  borderWidth: 1,
                  borderColor: tint(c.info, 0.45),
                  backgroundColor: tint(c.info, 0.1),
                  borderRadius: RADIUS.inner,
                  padding: 9,
                }}
              >
                <Text style={{ color: c.info, fontSize: 11.5 }}>
                  Sandbox: this build runs purchases in mock mode (Expo Go has no native billing). Real
                  purchases activate in a store/dev build with RevenueCat keys set.
                </Text>
              </View>
            )}

            <Muted style={{ marginTop: 14, fontSize: 10.5, lineHeight: 15 }}>
              Subscriptions auto-renew until cancelled. Payment is charged to your App Store or Google
              Play account at purchase confirmation. Manage or cancel anytime in your store account
              settings. Lifetime is a one-time purchase, not a subscription.
            </Muted>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
              <Pressable onPress={() => setLegalDoc('terms')}>
                <Text style={{ color: c.info, fontSize: 11.5 }}>Terms of Use</Text>
              </Pressable>
              <Pressable onPress={() => setLegalDoc('privacy')}>
                <Text style={{ color: c.info, fontSize: 11.5 }}>Privacy Policy</Text>
              </Pressable>
            </View>
            <Muted style={{ marginTop: 10, fontSize: 10.5, lineHeight: 15 }}>
              PropDrills is a simulated-trading education tool. It is not financial advice, offers no
              real-money trading, and is not affiliated with any proprietary trading firm. Simulated
              results do not reflect real trading.
            </Muted>
          </ScrollView>
        </View>
      </View>
      <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </Modal>
  );
}
