import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { useApp } from '../store';
import { RADIUS, tint, useTheme } from '../theme';
import { Btn } from '../ui';

/**
 * First-run welcome tour, shown until a profile is created (or skipped).
 * Pure presentation — no data loads, so it renders instantly on install.
 */

/** Decorative mini candle chart for the welcome page. */
function HeroChart({ w, h }: { w: number; h: number }) {
  const { c, levelColor } = useTheme();
  // hand-placed candles: a pullback to a level, then continuation up
  const candles: [number, number, number, number][] = [
    [10, 58, 30, 48], [22, 50, 26, 32], [34, 40, 22, 26], [46, 34, 18, 30],
    [58, 44, 26, 40], [70, 48, 34, 38], [82, 46, 30, 34], [94, 40, 22, 26],
    [106, 32, 14, 18], [118, 26, 8, 12], [130, 20, 4, 8],
  ];
  const sx = w / 145;
  const sy = h / 66;
  return (
    <Svg width={w} height={h}>
      <Line x1={0} x2={w} y1={40 * sy} y2={40 * sy} stroke={levelColor.PDH} strokeWidth={1.2} strokeDasharray="6,5" />
      <Line x1={0} x2={w} y1={16 * sy} y2={16 * sy} stroke={levelColor.ONH} strokeWidth={1} strokeDasharray="6,5" />
      {candles.map(([x, hi, lo, cl], i) => {
        const op = i === 0 ? Math.min(hi - 4, cl + 8) : candles[i - 1][3];
        const up = cl <= op; // y grows downward
        const col = up ? c.candleUp : c.candleDown;
        const top = Math.min(op, cl);
        return (
          <Svg key={i}>
            <Line x1={(x + 3) * sx} x2={(x + 3) * sx} y1={lo * sy} y2={hi * sy} stroke={col} strokeWidth={1.4} />
            <Rect x={x * sx} y={top * sy} width={6 * sx} height={Math.max(Math.abs(op - cl), 1.5) * sy} fill={col} rx={1} />
          </Svg>
        );
      })}
    </Svg>
  );
}

/** One glossary term: a sample of its chart line + name + meaning. */
function Term({ color, dash, name, desc }: { color: string; dash?: string; name: string; desc: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 }}>
      <Svg width={34} height={10}>
        <Line x1={0} x2={34} y1={5} y2={5} stroke={color} strokeWidth={2} strokeDasharray={dash} />
      </Svg>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.txt, fontSize: 13.5, fontWeight: '700' }}>{name}</Text>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16, marginTop: 1 }}>{desc}</Text>
      </View>
    </View>
  );
}

/** One row of the tab tour: icon chip + what that tab trains. */
function TabRow({ icon, name, desc }: { icon: string; name: string; desc: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: tint(c.accent, 0.1),
          borderWidth: 1,
          borderColor: tint(c.accent, 0.3),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 19 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.txt, fontSize: 14, fontWeight: '700' }}>{name}</Text>
        <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 17, marginTop: 2 }}>{desc}</Text>
      </View>
    </View>
  );
}

/** Static mock of a challenge meter, for the evaluation page. */
function MockMeter({ label, frac, text, color }: { label: string; frac: number; text: string; color: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <Text style={{ color: c.muted, fontSize: 9.5, width: 62, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.inset, overflow: 'hidden' }}>
        <View style={{ width: `${frac * 100}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </View>
      <Text style={{ color: c.txt, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function OnboardingScreen() {
  const { setProfileName, setOnboarded, profileName } = useApp();
  const { c, levelColor } = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [name, setName] = useState(profileName);
  const scrollRef = useRef<ScrollView>(null);

  const N_PAGES = 6;
  const goTo = (p: number) => {
    scrollRef.current?.scrollTo({ x: p * width, animated: true });
    setPage(p);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  };
  const finish = () => {
    if (name.trim()) setProfileName(name);
    setOnboarded(true);
  };

  const pageStyle = { width, paddingHorizontal: 28, paddingTop: 12 } as const;
  const title = { color: c.txt, fontSize: 24, fontWeight: '800' as const, letterSpacing: 0.3, marginBottom: 10 };
  const body = { color: c.muted, fontSize: 14, lineHeight: 21 };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* skip — always available until the profile page */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 6 }}>
        <Pressable onPress={finish} hitSlop={10}>
          <Text style={{ color: c.muted, fontSize: 13, padding: 6 }}>{page < N_PAGES - 1 ? 'Skip' : ' '}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
      >
        {/* 1 — welcome */}
        <View style={pageStyle}>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={{ color: c.txt, fontSize: 34, fontWeight: '800', letterSpacing: 0.5 }}>
              Prop<Text style={{ color: c.accent }}>Drills</Text>
            </Text>
            <Text style={[body, { marginTop: 6, marginBottom: 22 }]}>Train like you're funded.</Text>
            <View
              style={{
                borderRadius: RADIUS.card,
                borderWidth: 1,
                borderColor: c.line,
                backgroundColor: c.chartBg,
                padding: 14,
                marginBottom: 22,
              }}
            >
              <HeroChart w={width - 84} h={130} />
            </View>
            <Text style={body}>
              Short daily reps that build one skill: reading MNQ price action around the levels that
              matter — then proving it in a simulated prop-firm evaluation.{'\n\n'}
              <Text style={{ color: c.txt, fontWeight: '600' }}>Location first, pattern second.</Text>{' '}
              No real money, no account needed — everything stays on your phone.
            </Text>
          </View>
        </View>

        {/* 2 — the language */}
        <View style={pageStyle}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={title}>Speak the language</Text>
            <Text style={[body, { marginBottom: 10 }]}>
              Five levels do most of the work on an MNQ chart. You'll see them drawn exactly like
              this everywhere in the app:
            </Text>
            <Term color={levelColor.PDH} dash="6,5" name="PDH / PDL" desc="Prior day high & low — yesterday's extremes, the first magnets for stop runs." />
            <Term color={levelColor.ONH} dash="6,5" name="ONH / ONL" desc="Overnight high & low — the range built while the US session slept." />
            <Term color={levelColor.PC} dash="2,4" name="Prior close" desc="Yesterday's settlement — above it buyers are in charge, below it sellers." />
            <Term color={levelColor.VWAP} name="VWAP" desc="Volume-weighted average price — the session's fair value line." />
            <Term color={levelColor.R50} dash="2,4" name="Round numbers" desc="…00 and …50 levels where resting orders cluster." />
            <Text style={[body, { marginTop: 8 }]}>
              Where price is relative to these levels matters more than any candle pattern. That's
              the whole method.
            </Text>
          </ScrollView>
        </View>

        {/* 3 — learn & drill */}
        <View style={pageStyle}>
          <Text style={title}>Learn it, then drill it</Text>
          <Text style={[body, { marginBottom: 8 }]}>
            The first two tabs build the foundation — concepts in, reps out:
          </Text>
          <TabRow icon="📖" name="Learn" desc="Short lessons on each level, setup and session quirk — the why behind every drill." />
          <TabRow icon="🎯" name="Drill" desc="Rapid-fire pattern recognition: read a live chart, call the next move, get instant feedback. Spaced repetition keeps serving what you miss." />
          <Text style={[body, { marginTop: 10 }]}>
            Five focused minutes a day beats an hour of chart-staring. Streaks and session stats keep
            you honest.
          </Text>
        </View>

        {/* 4 — levels & setup */}
        <View style={pageStyle}>
          <Text style={title}>Mark the chart yourself</Text>
          <Text style={[body, { marginBottom: 8 }]}>
            Recognizing a level someone drew is easy. Drawing it yourself is the skill:
          </Text>
          <TabRow icon="📍" name="Levels" desc="A naked chart — you place PDH, PDL, ONH and ONL from memory, then watch whether price respects your marks." />
          <TabRow icon="🧩" name="Setup" desc="The full morning read: pick the levels, call the bias, commit before the reveal." />
          <Text style={[body, { marginTop: 10 }]}>
            Both feed your stats, so you can watch your read sharpen week over week.
          </Text>
        </View>

        {/* 5 — challenge */}
        <View style={pageStyle}>
          <Text style={title}>Prove it in the Challenge</Text>
          <Text style={[body, { marginBottom: 12 }]}>
            🏆 A simulated prop-firm evaluation on replayed tape, with the same shape real firms use —{' '}
            <Text style={{ color: c.txt, fontWeight: '600' }}>one rule, two objectives</Text>:
          </Text>
          <View
            style={{
              backgroundColor: c.panel,
              borderColor: c.line,
              borderWidth: 1,
              borderRadius: RADIUS.card,
              padding: 14,
            }}
          >
            <Text style={{ color: c.txt, fontSize: 13, fontWeight: '700' }}>⛔ The rule</Text>
            <Text style={[body, { fontSize: 12.5, marginTop: 2 }]}>
              Never touch the trailing drawdown or the daily loss limit. Touch either and the
              evaluation fails on the spot.
            </Text>
            <Text style={{ color: c.txt, fontSize: 13, fontWeight: '700', marginTop: 10 }}>🎯 The objectives</Text>
            <Text style={[body, { fontSize: 12.5, marginTop: 2 }]}>
              Hit the profit target — consistently. One monster day doesn't pass; it raises your bar.
            </Text>
            <MockMeter label="Target" frac={0.62} text="$1,860 / $3,000" color={c.accent} />
            <MockMeter label="DD room" frac={0.8} text="$1,600" color={c.good} />
            <MockMeter label="Day room" frac={0.35} text="$350" color={c.gold} />
          </View>
          <Text style={[body, { marginTop: 12 }]}>
            Your account carries across trading days — come back tomorrow, or reset any time.
          </Text>
        </View>

        {/* 6 — profile */}
        <View style={pageStyle}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Text style={title}>Make it yours</Text>
              <Text style={[body, { marginBottom: 16 }]}>
                Pick a trader name for your stats and streaks. No email, no signup — your profile
                and every rep live only on this phone.
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Trader name"
                placeholderTextColor={c.muted}
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={finish}
                style={{
                  backgroundColor: c.panel,
                  borderColor: c.line,
                  borderWidth: 1,
                  borderRadius: RADIUS.control,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: c.txt,
                  fontSize: 15,
                  marginBottom: 12,
                }}
              />
              <Btn label={name.trim() ? 'Start training' : 'Start without a name'} kind="primary" onPress={finish} />
              <Text style={[body, { fontSize: 11.5, marginTop: 14 }]}>
                Education tool only — simulated trading, no real money, not financial advice.
              </Text>
            </View>
          </KeyboardAvoidingView>
        </View>
      </ScrollView>

      {/* dots + next */}
      <View style={{ paddingHorizontal: 28, paddingBottom: 14, paddingTop: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 12 }}>
          {Array.from({ length: N_PAGES }, (_, i) => (
            <Pressable key={i} onPress={() => goTo(i)} hitSlop={6}>
              <View
                style={{
                  width: i === page ? 22 : 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: i === page ? c.accent : tint(c.muted, 0.35),
                }}
              />
            </Pressable>
          ))}
        </View>
        {page < N_PAGES - 1 && <Btn label="Next" kind="primary" onPress={() => goTo(page + 1)} />}
      </View>
    </View>
  );
}
