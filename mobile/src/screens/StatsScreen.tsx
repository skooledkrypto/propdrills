import { ScrollView, Text, View } from 'react-native';
import {
  PATTERNS,
  PATTERN_ORDER,
  accuracy,
  accuracyTrend,
  calledSetupExpectancy,
  dueCount,
} from '../core';
import { useApp } from '../store';
import { Card, Chip, H2, Muted } from '../ui';
import { useTheme } from '../theme';

export function StatsScreen() {
  const { progress, attempts } = useApp();
  const { c: C } = useTheme();
  const now = Date.now();
  const due = dueCount(progress, now);
  const trend = accuracyTrend(attempts).slice(-14);
  const exp = calledSetupExpectancy(attempts);
  const anySeen = PATTERN_ORDER.some((id) => (progress.perPattern[id]?.seen ?? 0) > 0);

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <H2>Your recognition stats</H2>
          <View style={{ marginLeft: 8, marginBottom: 8 }}>
            <Chip label={`${due} due today`} color={C.gold} />
          </View>
        </View>
        <Muted style={{ marginBottom: 10 }}>
          Lifetime accuracy per pattern (persists on-device). Aim for a stable ~80%+ before trusting
          a pattern live. Box = Leitner spaced-repetition box (1 = every session … 5 = ~2 weeks).
        </Muted>
        {!anySeen && <Muted>Do some drills to populate this.</Muted>}
        {PATTERN_ORDER.map((id) => {
          const pp = progress.perPattern[id];
          if (!pp || !pp.seen) return null;
          const acc = Math.round(accuracy(pp) * 100);
          const col = acc >= 80 ? C.good : acc >= 60 ? C.gold : C.bad;
          const isDue = pp.box === 0 || now >= pp.dueAt;
          return (
            <View key={id} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ color: C.txt, fontSize: 13 }}>{PATTERNS[id].name}</Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>
                  {pp.correct}/{pp.seen} · box {pp.box || '—'} {isDue ? '· due' : ''}
                </Text>
              </View>
              <View style={{ height: 7, backgroundColor: C.panel2, borderRadius: 5, overflow: 'hidden' }}>
                <View style={{ width: `${acc}%`, height: '100%', backgroundColor: col }} />
              </View>
            </View>
          );
        })}
      </Card>

      {trend.length >= 2 && (
        <Card>
          <H2>Accuracy — last {trend.length} active days</H2>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 80, marginTop: 6 }}>
            {trend.map((p) => (
              <View key={p.day} style={{ flex: 1, alignItems: 'center' }}>
                <View
                  style={{
                    width: '70%',
                    height: Math.max(4, p.accuracy * 72),
                    backgroundColor: p.accuracy >= 0.8 ? C.good : p.accuracy >= 0.6 ? C.gold : C.bad,
                    borderRadius: 3,
                  }}
                />
              </View>
            ))}
          </View>
          <Muted style={{ marginTop: 6 }}>
            {trend[0].day} → {trend[trend.length - 1].day}
          </Muted>
        </Card>
      )}

      <Card>
        <H2>Called-setup expectancy</H2>
        {exp.n ? (
          <Muted>
            Across {exp.n} Realistic drills with a setup present, the actual forward move averaged{' '}
            {exp.avgMove >= 0 ? '+' : ''}
            {exp.avgMove.toFixed(1)} pts over the reveal window. Historical illustration only — not a
            prediction, not advice.
          </Muted>
        ) : (
          <Muted>Drill in Realistic mode to see what setups actually did next.</Muted>
        )}
      </Card>

      <Card>
        <H2>Why drilling this works</H2>
        <Muted>
          Recognition is a trainable skill built by reps + immediate feedback. Live, a session gives
          you maybe 1–3 setups; here you can see hundreds. When focused accuracy is high and stable,
          move to bar-replay on a real platform — then, and only then, consider funded evaluations.
        </Muted>
      </Card>
    </ScrollView>
  );
}
