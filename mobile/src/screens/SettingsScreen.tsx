import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_CONFIG,
  SUPPORT_EMAIL,
  createSyncAccount,
  deleteSyncAccount,
  describeBackup,
  fetchSyncStatus,
  normalizeSyncCode,
  parseBackup,
  pushSyncBackup,
  serializeBackup,
  type SyncAccount,
} from '../core';
import { useApp } from '../store';
import { getAppUserId, linkPurchaseUser } from '../purchases';
import { applyReminder } from '../reminders';
import { Btn, Card, H2, Muted, Seg } from '../ui';
import { RADIUS, useTheme } from '../theme';
import { LegalSheet, type LegalDoc } from './LegalSheet';

const SYNC_KEY = 'dm.sync';

function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  fmt = (n: number) => String(n),
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  fmt?: (n: number) => string;
}) {
  const { c: C } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <Text style={{ color: C.txt, fontSize: 13.5, flex: 1, paddingRight: 8 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Btn label="−" onPress={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} style={{ paddingVertical: 6, paddingHorizontal: 14 }} />
        <Text style={{ color: C.txt, fontSize: 14, fontWeight: '700', minWidth: 44, textAlign: 'center' }}>{fmt(value)}</Text>
        <Btn label="+" onPress={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))} style={{ paddingVertical: 6, paddingHorizontal: 14 }} />
      </View>
    </View>
  );
}

export function SettingsScreen() {
  const { cfg, setCfg, reminder, setReminder, resetProgress, profileName, setProfileName, progress, attempts, importBackup, themeMode, setThemeMode, colorblind, setColorblind, isPro, proSource, showPaywall, setOnboarded } =
    useApp();
  const { c: C } = useTheme();
  const [reminderMsg, setReminderMsg] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const [legalDoc, setLegalDoc] = useState<LegalDoc>(null);
  const [supportId, setSupportId] = useState<string | null>(null);
  const [supportIdMsg, setSupportIdMsg] = useState('');
  const [supportTaps, setSupportTaps] = useState(0);
  const [sync, setSync] = useState<SyncAccount | null>(null);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  useEffect(() => {
    void getAppUserId().then(setSupportId);
    void AsyncStorage.getItem(SYNC_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as SyncAccount;
        if (parsed.code && parsed.userId) setSync(parsed);
      } catch {
        // corrupt record — ignore
      }
    });
  }, []);

  const currentBackupJson = async () =>
    serializeBackup({
      platform: 'mobile',
      progress,
      attempts,
      profileName: profileName || undefined,
      rcUserId: (await getAppUserId()) ?? undefined,
    });

  const saveSync = (acct: SyncAccount | null) => {
    if (acct) void AsyncStorage.setItem(SYNC_KEY, JSON.stringify(acct));
    else void AsyncStorage.removeItem(SYNC_KEY);
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
      const acct = await createSyncAccount(await getAppUserId());
      await linkPurchaseUser(acct.userId);
      await pushSyncBackup(acct.code, await currentBackupJson());
      saveSync(acct);
      setSyncMsg('Sync code created and progress backed up ✓ — save the code somewhere safe.');
    });

  const syncLink = () =>
    withSyncBusy(async () => {
      const code = normalizeSyncCode(linkCode);
      if (!code) {
        setSyncMsg("That doesn't look like a sync code — it has the form PD-XXXX-XXXX-XXXX-XXXX.");
        return;
      }
      const status = await fetchSyncStatus(code);
      await linkPurchaseUser(status.userId);
      const finish = () => {
        saveSync({ code, userId: status.userId });
        setLinkOpen(false);
        setLinkCode('');
        setSyncMsg('Device linked ✓ — purchases and cloud backups now follow this account.');
      };
      const parsed = status.backup ? parseBackup(status.backup) : null;
      if (parsed?.ok) {
        Alert.alert('Restore cloud backup?', `${describeBackup(parsed.payload)}\n\nThis replaces the progress on this device.`, [
          { text: 'Not now', onPress: finish },
          {
            text: 'Restore',
            onPress: () => {
              importBackup(parsed.payload);
              finish();
            },
          },
        ]);
      } else {
        finish();
      }
    });

  const syncPush = () =>
    withSyncBusy(async () => {
      if (!sync) return;
      await pushSyncBackup(sync.code, await currentBackupJson());
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
      Alert.alert('Restore cloud backup?', `${describeBackup(parsed.payload)}\n\nThis replaces the progress on this device.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: () => {
            importBackup(parsed.payload);
            setSyncMsg('Cloud backup restored ✓');
          },
        },
      ]);
    });

  const syncDelete = () => {
    if (!sync || syncBusy) return;
    Alert.alert(
      'Delete cloud account?',
      'The sync code stops working and the cloud copy of your progress is erased everywhere. Progress already on your devices stays put.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void withSyncBusy(async () => {
              await deleteSyncAccount(sync.code);
              saveSync(null);
              setSyncMsg('Cloud account deleted ✓');
            }),
        },
      ],
    );
  };

  const copySyncCode = async () => {
    if (!sync) return;
    await Clipboard.setStringAsync(sync.code).catch(() => {});
    setSyncMsg('Sync code copied ✓');
  };

  const copySupportId = async () => {
    if (!supportId) return;
    await Clipboard.setStringAsync(supportId).catch(() => {});
    setSupportIdMsg('Support ID copied ✓');
  };

  const exportProgress = async () => {
    try {
      const json = serializeBackup({
        platform: 'mobile',
        progress,
        attempts,
        profileName: profileName || undefined,
        rcUserId: (await getAppUserId()) ?? undefined,
      });
      await Share.share({ message: json });
      setBackupMsg('Backup shared. Save it anywhere (Notes, email to yourself, a file).');
    } catch {
      setBackupMsg('Share was cancelled.');
    }
  };

  const importFromClipboard = async () => {
    const raw = (await Clipboard.getStringAsync().catch(() => '')) ?? '';
    if (!raw.trim()) {
      setBackupMsg('Clipboard is empty — copy the backup text first, then tap Import.');
      return;
    }
    const res = parseBackup(raw);
    if (!res.ok) {
      setBackupMsg(res.error);
      return;
    }
    Alert.alert('Import backup?', `${describeBackup(res.payload)}\n\nThis replaces the progress on this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Import',
        onPress: () => {
          importBackup(res.payload);
          setBackupMsg('Progress imported ✓');
        },
      },
    ]);
  };

  const updateReminder = async (enabled: boolean, hour: number) => {
    setReminder({ enabled, hour });
    const res = await applyReminder(enabled, hour);
    setReminderMsg(
      res.ok
        ? enabled
          ? `Daily reminder set for ${hour}:00.`
          : 'Reminder off.'
        : res.msg ?? 'Could not set the reminder.',
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
      <Card>
        <H2>Appearance</H2>
        <Muted style={{ marginBottom: 8 }}>System follows your phone's light/dark setting.</Muted>
        <Seg
          options={[
            { v: 'system', label: 'System' },
            { v: 'light', label: 'Light' },
            { v: 'dark', label: 'Dark' },
          ]}
          value={themeMode}
          onChange={(v) => setThemeMode(v)}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ color: C.txt, fontSize: 13.5 }}>Colorblind mode</Text>
            <Muted>Up/down and P&L use blue/orange instead of green/red.</Muted>
          </View>
          <Switch
            value={colorblind}
            onValueChange={setColorblind}
            trackColor={{ true: C.accent, false: C.inset }}
            thumbColor="#fff"
          />
        </View>
      </Card>

      <Card>
        <H2>Profile & backup</H2>
        <Muted style={{ marginBottom: 8 }}>
          Progress lives on this device. Move it manually with a backup — export here, then
          paste-import on another phone or upload the file on the web app — or use Cloud Sync below.
        </Muted>
        <TextInput
          value={profileName}
          onChangeText={setProfileName}
          placeholder="Display name (optional)"
          placeholderTextColor={C.muted}
          maxLength={40}
          style={{
            color: C.txt,
            backgroundColor: C.inset,
            borderColor: C.line,
            borderWidth: 1,
            borderRadius: RADIUS.control,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 13.5,
            marginBottom: 10,
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn label="Export progress" kind="primary" onPress={() => void exportProgress()} style={{ flex: 1 }} />
          <Btn label="Import from clipboard" onPress={() => void importFromClipboard()} style={{ flex: 1 }} />
        </View>
        {backupMsg ? <Muted style={{ marginTop: 8 }}>{backupMsg}</Muted> : null}
      </Card>

      <Card>
        <H2>Cloud Sync</H2>
        {!sync ? (
          <>
            <Muted style={{ marginBottom: 8 }}>
              Link this phone and your browser with a private sync code — no email, no password.
              Purchases made on either device unlock Pro on both, and you can back up progress to
              the cloud. Create the code on the device where you bought Pro, then link the others.
            </Muted>
            <View style={{ gap: 8 }}>
              <Btn label="Create sync code" kind="primary" disabled={syncBusy} onPress={() => void syncCreate()} />
              {!linkOpen ? (
                <Btn label="Link with a code…" disabled={syncBusy} onPress={() => setLinkOpen(true)} />
              ) : (
                <>
                  <TextInput
                    value={linkCode}
                    onChangeText={setLinkCode}
                    placeholder="PD-XXXX-XXXX-XXXX-XXXX"
                    placeholderTextColor={C.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={{
                      color: C.txt,
                      backgroundColor: C.inset,
                      borderColor: C.line,
                      borderWidth: 1,
                      borderRadius: RADIUS.control,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 13.5,
                    }}
                  />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Btn label="Link" kind="primary" disabled={syncBusy || !linkCode.trim()} onPress={() => void syncLink()} style={{ flex: 1 }} />
                    <Btn label="Cancel" disabled={syncBusy} onPress={() => { setLinkOpen(false); setLinkCode(''); }} style={{ flex: 1 }} />
                  </View>
                </>
              )}
            </View>
          </>
        ) : (
          <>
            <Muted style={{ marginBottom: 8 }}>
              Enter this code on your other devices to link them. Anyone with the code can access
              this account, so keep it private.
            </Muted>
            <Text
              onPress={() => void copySyncCode()}
              style={{ color: C.txt, fontWeight: '700', fontSize: 14, marginBottom: 10 }}
            >
              {sync.code} <Muted>(tap to copy)</Muted>
            </Text>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn label="Back up now" kind="primary" disabled={syncBusy} onPress={() => void syncPush()} style={{ flex: 1 }} />
                <Btn label="Restore from cloud" disabled={syncBusy} onPress={() => void syncPull()} style={{ flex: 1 }} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn label="Unlink this device" disabled={syncBusy} onPress={() => saveSync(null)} style={{ flex: 1 }} />
                <Btn label="Delete cloud account…" kind="danger" disabled={syncBusy} onPress={syncDelete} style={{ flex: 1 }} />
              </View>
            </View>
          </>
        )}
        {syncMsg ? <Muted style={{ marginTop: 8 }}>{syncMsg}</Muted> : null}
      </Card>

      <Card>
        <H2>Session</H2>
        <Muted style={{ marginBottom: 8 }}>Which part of the trading day Realistic drills come from.</Muted>
        <Seg
          options={[
            { v: 'any', label: 'Any' },
            { v: 'rth', label: 'RTH' },
            { v: 'evening', label: 'Evening' },
            { v: 'overnight', label: 'Overnight' },
          ]}
          value={cfg.sessionFilter}
          onChange={(v) => setCfg({ sessionFilter: v })}
        />
        {cfg.sessionFilter === 'evening' && (
          <Stepper
            label="Evening window (hours after the 18:00 ET reopen)"
            value={cfg.eveningHours}
            onChange={(n) => setCfg({ eveningHours: n })}
            min={1}
            max={15}
          />
        )}
        <View style={{ height: 10 }} />
        <Muted style={{ marginBottom: 8 }}>VWAP anchor — where session VWAP resets.</Muted>
        <Seg
          options={[
            { v: 'rth', label: 'RTH open (09:30 ET)' },
            { v: 'globex', label: 'Globex reopen (18:00 ET)' },
          ]}
          value={cfg.vwapAnchor}
          onChange={(v) => setCfg({ vwapAnchor: v })}
        />
      </Card>

      <Card>
        <H2>Drills</H2>
        <Stepper
          label={'"No Setup" share of drills (passing is a skill)'}
          value={cfg.noSetupRate}
          onChange={(n) => setCfg({ noSetupRate: n })}
          min={0}
          max={0.5}
          step={0.05}
          fmt={(n) => `${Math.round(n * 100)}%`}
        />
        <Stepper label="Level zone tolerance (pts)" value={cfg.tol} onChange={(n) => setCfg({ tol: n })} min={2} max={50} />
        <Stepper label="Outcome bars revealed" value={cfg.outcomeBars} onChange={(n) => setCfg({ outcomeBars: n })} min={5} max={60} step={5} />
        <Muted style={{ marginTop: 8 }}>
          Detector-tolerance changes apply the next time the app rebuilds its dataset (restart the app).
        </Muted>
      </Card>

      <Card>
        <H2>Daily rep reminder</H2>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}>
          <Text style={{ color: C.txt, fontSize: 13.5 }}>Remind me every day</Text>
          <Switch
            value={reminder.enabled}
            onValueChange={(v) => void updateReminder(v, reminder.hour)}
            trackColor={{ true: C.accent, false: C.inset }}
            thumbColor="#fff"
          />
        </View>
        {reminder.enabled && (
          <Stepper
            label="Reminder hour (your local time)"
            value={reminder.hour}
            onChange={(n) => void updateReminder(true, n)}
            min={0}
            max={23}
            fmt={(n) => `${n}:00`}
          />
        )}
        {reminderMsg ? <Muted style={{ marginTop: 6 }}>{reminderMsg}</Muted> : null}
      </Card>

      <Card>
        <H2>About the data</H2>
        <Muted>
          Mobile drills run on generated MNQ-like charts: real CME session structure (RTH, the 17:00
          ET maintenance halt, overnight Globex), plausible volatility, and stop-run behaviour around
          prior-day levels — but no licensed exchange data, so there's nothing to get in trouble
          over. The desktop web app can additionally import your own purchased MNQ data.
        </Muted>
      </Card>

      <Card>
        <H2>PropDrills Pro</H2>
        <Muted style={{ marginBottom: 8 }}>
          {isPro
            ? `Pro active ✓${proSource === 'mock' ? ' (mock — sandbox build)' : ''} — unlimited challenges, all sizes, all scenarios.`
            : 'Free plan — every drill is included; Pro unlocks unlimited Challenge Mode.'}
        </Muted>
        <Btn label={isPro ? 'Manage plan' : 'View Pro plans'} kind={isPro ? 'ghost' : 'primary'} onPress={showPaywall} />
      </Card>

      <Card>
        <H2>Danger zone</H2>
        <View style={{ gap: 8 }}>
          <Btn label="Restore default settings" onPress={() => setCfg({ ...DEFAULT_CONFIG })} />
          <Btn
            label="Reset all progress & stats…"
            kind="danger"
            onPress={() =>
              Alert.alert('Reset progress?', 'This permanently wipes your stats, spaced-repetition history, and any challenge in progress.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Wipe it', style: 'destructive', onPress: () => void resetProgress() },
              ])
            }
          />
        </View>
      </Card>

      <Card>
        <H2>About & legal</H2>
        {/* Tapping the version line 5× reveals the RevenueCat customer id for
            support lookups (comped Pro, refunds) — deliberately not a visible
            feature of the app. */}
        <Muted style={{ marginBottom: 4 }}>
          Veteran built, owned, and operated — made by a trader to drill his own read, priced so
          anyone can afford the reps.
        </Muted>
        <Pressable onPress={() => setSupportTaps((n) => n + 1)}>
          <Muted style={{ marginBottom: 8 }}>
            PropDrills {Constants.expoConfig?.version ?? ''} — support: {SUPPORT_EMAIL}
          </Muted>
        </Pressable>
        {supportTaps >= 5 && supportId ? (
          <Text onPress={() => void copySupportId()} style={{ color: C.muted, fontSize: 11.5, marginBottom: 8 }}>
            Support ID (tap to copy): {supportId}
          </Text>
        ) : null}
        {supportTaps >= 5 && supportIdMsg ? <Muted style={{ marginBottom: 8 }}>{supportIdMsg}</Muted> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <Btn label="Terms of Use" onPress={() => setLegalDoc('terms')} style={{ flex: 1 }} />
          <Btn label="Privacy Policy" onPress={() => setLegalDoc('privacy')} style={{ flex: 1 }} />
        </View>
        <Btn label="Replay the welcome tour" onPress={() => setOnboarded(false)} />
      </Card>

      <Muted style={{ textAlign: 'center', marginTop: 4 }}>
        Your data stays on this device unless you back it up with Cloud Sync. Education tool only —
        not financial advice; patterns fail often, and trading MNQ is leveraged and risky.
      </Muted>
      <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </ScrollView>
  );
}
