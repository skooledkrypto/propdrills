import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_CONFIG,
  applyResult,
  ensureProgress,
  type Attempt,
  type BackupPayload,
  type Campaign,
  type DrillMode,
  type DrillSource,
  type EngineConfig,
  type ChallengeAttempt,
  type PatternId,
  type Progress,
} from './core';
import type { ThemeMode } from './theme';

const K = {
  cfg: 'dm.cfg',
  progress: 'dm.progress',
  attempts: 'dm.attempts',
  reminder: 'dm.reminder',
  profile: 'dm.profile',
  theme: 'dm.theme',
  colorblind: 'dm.cb',
  challenges: 'dm.challenges',
  campaign: 'dm.campaign',
  onboarded: 'dm.onboarded',
  pro: 'dm.pro',
} as const;

export type ProSource = 'revenuecat' | 'mock' | null;

export interface ReminderPrefs {
  enabled: boolean;
  hour: number; // local device hour 0-23
}

interface AppState {
  ready: boolean;
  cfg: EngineConfig;
  progress: Progress;
  attempts: Attempt[];
  reminder: ReminderPrefs;
  profileName: string;
  themeMode: ThemeMode;
  colorblind: boolean;
  challengeAttempts: ChallengeAttempt[];
  /** Active multi-day evaluation, or null. Saved at day boundaries. */
  campaign: Campaign | null;
  onboarded: boolean;
  isPro: boolean;
  proSource: ProSource;
  paywallVisible: boolean;
  sessionSeen: number;
  sessionCorrect: number;
  streak: number;
  best: number;

  init: () => Promise<void>;
  setCfg: (patch: Partial<EngineConfig>) => void;
  setReminder: (r: ReminderPrefs) => void;
  setProfileName: (name: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setColorblind: (on: boolean) => void;
  addChallengeAttempt: (a: ChallengeAttempt) => void;
  saveCampaign: (c: Campaign | null) => void;
  setOnboarded: (done: boolean) => void;
  setPro: (isPro: boolean, source: ProSource) => void;
  showPaywall: () => void;
  hidePaywall: () => void;
  importBackup: (payload: BackupPayload) => void;
  answer: (args: {
    patternId: PatternId;
    correct: boolean;
    mode: DrillMode;
    source: DrillSource;
    realizedMove?: number;
  }) => void;
  resetProgress: () => Promise<void>;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  void AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  cfg: DEFAULT_CONFIG,
  progress: ensureProgress({ perPattern: {} }),
  attempts: [],
  reminder: { enabled: false, hour: 18 },
  profileName: '',
  themeMode: 'system',
  colorblind: false,
  challengeAttempts: [],
  campaign: null,
  onboarded: false,
  isPro: false,
  proSource: null,
  paywallVisible: false,
  sessionSeen: 0,
  sessionCorrect: 0,
  streak: 0,
  best: 0,

  init: async () => {
    const [cfg, progress, attempts, reminder, profileName, themeMode, colorblind, challenges, campaign, onboarded, pro] =
      await Promise.all([
        readJson<Partial<EngineConfig>>(K.cfg),
        readJson<Progress>(K.progress),
        readJson<Attempt[]>(K.attempts),
        readJson<ReminderPrefs>(K.reminder),
        readJson<string>(K.profile),
        readJson<ThemeMode>(K.theme),
        readJson<boolean>(K.colorblind),
        readJson<ChallengeAttempt[]>(K.challenges),
        readJson<Campaign>(K.campaign),
        readJson<boolean>(K.onboarded),
        readJson<{ isPro: boolean; source: ProSource }>(K.pro),
      ]);
    set({
      ready: true,
      cfg: { ...DEFAULT_CONFIG, ...(cfg ?? {}) },
      progress: ensureProgress(progress ?? { perPattern: {} }),
      attempts: attempts ?? [],
      reminder: reminder ?? { enabled: false, hour: 18 },
      profileName: typeof profileName === 'string' ? profileName : '',
      themeMode: themeMode === 'light' || themeMode === 'dark' ? themeMode : 'system',
      colorblind: colorblind === true,
      challengeAttempts: challenges ?? [],
      campaign: campaign && campaign.state ? campaign : null,
      // pre-onboarding installs with a profile shouldn't see the tour
      onboarded: onboarded === true || (typeof profileName === 'string' && profileName.length > 0),
      isPro: pro?.isPro === true,
      proSource: pro?.source ?? null,
    });
  },

  setCfg: (patch) => {
    const cfg = { ...get().cfg, ...patch };
    set({ cfg });
    writeJson(K.cfg, cfg);
  },

  setReminder: (reminder) => {
    set({ reminder });
    writeJson(K.reminder, reminder);
  },

  setProfileName: (name) => {
    const profileName = name.trim().slice(0, 40);
    set({ profileName });
    writeJson(K.profile, profileName);
  },

  setThemeMode: (themeMode) => {
    set({ themeMode });
    writeJson(K.theme, themeMode);
  },

  setColorblind: (colorblind) => {
    set({ colorblind });
    writeJson(K.colorblind, colorblind);
  },

  addChallengeAttempt: (a) => {
    const challengeAttempts = [...get().challengeAttempts, a].slice(-200);
    set({ challengeAttempts });
    writeJson(K.challenges, challengeAttempts);
  },

  saveCampaign: (campaign) => {
    set({ campaign });
    if (campaign) writeJson(K.campaign, campaign);
    else void AsyncStorage.removeItem(K.campaign).catch(() => {});
  },

  setOnboarded: (onboarded) => {
    set({ onboarded });
    writeJson(K.onboarded, onboarded);
  },

  setPro: (isPro, proSource) => {
    set({ isPro, proSource });
    writeJson(K.pro, { isPro, source: proSource });
  },

  showPaywall: () => set({ paywallVisible: true }),
  hidePaywall: () => set({ paywallVisible: false }),

  importBackup: (payload) => {
    const progress = ensureProgress(payload.progress);
    const attempts = payload.attempts.slice(-2000);
    const patch: Partial<AppState> = { progress, attempts };
    if (payload.profileName && !get().profileName) {
      patch.profileName = payload.profileName;
      writeJson(K.profile, payload.profileName);
    }
    set(patch);
    writeJson(K.progress, progress);
    writeJson(K.attempts, attempts);
  },

  answer: ({ patternId, correct, mode, source, realizedMove }) => {
    const now = Date.now();
    const progress = { ...get().progress, perPattern: { ...get().progress.perPattern } };
    applyResult(progress, patternId, correct, now);
    const attempt: Attempt = { t: now, patternId, correct, mode, source, realizedMove };
    const attempts = [...get().attempts, attempt].slice(-2000);
    const streak = correct ? get().streak + 1 : 0;
    set({
      progress,
      attempts,
      sessionSeen: get().sessionSeen + 1,
      sessionCorrect: get().sessionCorrect + (correct ? 1 : 0),
      streak,
      best: Math.max(get().best, streak),
    });
    writeJson(K.progress, progress);
    writeJson(K.attempts, attempts);
  },

  resetProgress: async () => {
    await AsyncStorage.multiRemove([K.progress, K.attempts, K.challenges, K.campaign]).catch(() => {});
    set({
      progress: ensureProgress({ perPattern: {} }),
      attempts: [],
      challengeAttempts: [],
      campaign: null,
      sessionSeen: 0,
      sessionCorrect: 0,
      streak: 0,
      best: 0,
    });
  },
}));
