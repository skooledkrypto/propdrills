import { Text } from 'react-native';
import { useApp } from '../store';
import { Btn, Card, Muted } from '../ui';
import { tint, useTheme } from '../theme';

/** Gold Pro pitch card for the bottom of free-tier screens. Renders nothing for Pro users. */
export function ProUpsellCard() {
  const { isPro, showPaywall } = useApp();
  const { c } = useTheme();
  if (isPro) return null;
  return (
    <Card style={{ borderColor: tint(c.gold, 0.5), backgroundColor: tint(c.gold, 0.06) }}>
      <Text style={{ color: c.gold, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>
        PROPDRILLS PRO
      </Text>
      <Text style={{ color: c.txt, fontSize: 15, fontWeight: '700', marginTop: 4 }}>
        Run the full evaluation, your way
      </Text>
      <Muted style={{ marginTop: 4 }}>
        Unlimited challenge evaluations, every account size, the scenario picker, and your full
        attempt history.
      </Muted>
      <Btn label="See Pro plans" kind="primary" onPress={showPaywall} style={{ marginTop: 12 }} />
    </Card>
  );
}
