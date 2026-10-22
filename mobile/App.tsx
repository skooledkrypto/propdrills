import { useEffect, useState } from 'react';
import { Platform, Pressable, SafeAreaView, StatusBar as RNStatusBar, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useApp } from './src/store';
import { initNotificationHandler } from './src/reminders';
import { RADIUS, tint, useTheme } from './src/theme';
import { LearnScreen } from './src/screens/LearnScreen';
import { DrillScreen } from './src/screens/DrillScreen';
import { LevelDrillScreen } from './src/screens/LevelDrillScreen';
import { FullSetupScreen } from './src/screens/FullSetupScreen';
import { ChallengeScreen } from './src/screens/ChallengeScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PaywallSheet } from './src/screens/PaywallScreen';
import { initPurchases } from './src/purchases';

type ViewId = 'learn' | 'drill' | 'levels' | 'setup' | 'challenge' | 'stats' | 'settings';

const TABS: { id: ViewId; icon: string; label: string }[] = [
  { id: 'learn', icon: '📖', label: 'Learn' },
  { id: 'drill', icon: '🎯', label: 'Drill' },
  { id: 'levels', icon: '📍', label: 'Levels' },
  { id: 'setup', icon: '🧩', label: 'Setup' },
  { id: 'challenge', icon: '🏆', label: 'Challenge' },
  { id: 'stats', icon: '📊', label: 'Stats' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

initNotificationHandler();

export default function App() {
  const { ready, init, streak, profileName, onboarded, isPro } = useApp();
  const [view, setView] = useState<ViewId>('learn');
  const { scheme, c } = useTheme();

  useEffect(() => {
    void init().then(() => initPurchases());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (ready && !onboarded) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <SafeAreaView
          style={{
            flex: 1,
            paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0,
          }}
        >
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <OnboardingScreen />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.chrome }}>
    <SafeAreaView
      style={{
        flex: 1,
        paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0,
      }}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: c.line,
          backgroundColor: c.chrome,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.txt, fontSize: 18, fontWeight: '800', letterSpacing: 0.3 }}>
            Prop<Text style={{ color: c.accent }}>Drills</Text>
          </Text>
          <Text style={{ color: c.muted, fontSize: 11, marginTop: 1 }}>
            {profileName ? `${profileName} — location first, pattern second.` : 'Location first, pattern second.'}
          </Text>
        </View>
        {isPro && (
          <View
            style={{
              backgroundColor: tint(c.gold, 0.1),
              borderColor: tint(c.gold, 0.5),
              borderWidth: 1,
              borderRadius: 20,
              paddingHorizontal: 9,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: c.gold, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>★ PRO</Text>
          </View>
        )}
        {streak > 0 && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              backgroundColor: tint(c.gold, 0.1),
              borderColor: tint(c.gold, 0.4),
              borderWidth: 1,
              borderRadius: 20,
              paddingHorizontal: 9,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontSize: 12 }}>🔥</Text>
            <Text style={{ color: c.gold, fontSize: 12.5, fontWeight: '800' }}>{streak}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {!ready ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: c.muted }}>Loading…</Text>
          </View>
        ) : view === 'learn' ? (
          <LearnScreen />
        ) : view === 'drill' ? (
          <DrillScreen />
        ) : view === 'levels' ? (
          <LevelDrillScreen />
        ) : view === 'setup' ? (
          <FullSetupScreen />
        ) : view === 'challenge' ? (
          <ChallengeScreen />
        ) : view === 'stats' ? (
          <StatsScreen />
        ) : (
          <SettingsScreen />
        )}
      </View>
      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderTopColor: c.line,
          backgroundColor: c.chrome,
          paddingBottom: 8,
          paddingTop: 6,
          paddingHorizontal: 4,
          // pull the bar partway into the home-indicator inset so it hugs the
          // bottom edge; the chrome wrapper still paints beneath it
          marginBottom: Platform.OS === 'ios' ? -18 : 0,
        }}
      >
        {TABS.map((t) => {
          const active = view === t.id;
          return (
            <Pressable key={t.id} style={{ flex: 1, alignItems: 'center', gap: 2 }} onPress={() => setView(t.id)}>
              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 3,
                  borderRadius: RADIUS.control,
                  backgroundColor: active ? tint(c.info, 0.16) : 'transparent',
                }}
              >
                <Text style={{ fontSize: 17, opacity: active ? 1 : 0.5 }}>{t.icon}</Text>
              </View>
              <Text
                style={{
                  color: active ? c.info : c.muted,
                  fontSize: 9.5,
                  letterSpacing: 0.2,
                  fontWeight: active ? '700' : '400',
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <PaywallSheet />
    </SafeAreaView>
    </View>
  );
}
