import { create } from 'zustand';
import type { Attempt, BarsetMeta, DrillMode, DrillSource, PatternId, Progress } from '../core/types';
import { DEFAULT_CONFIG, type EngineConfig } from '../core/config';
import { applyResult, ensureProgress } from '../core/scheduler';
import type { BackupPayload } from '../core/backup';
import type { Campaign, ChallengeAttempt } from '../core/challenge';
import { adoptBillingUserId } from '../ui/purchases';
import {
  flagCount,
  getBarsetMeta,
  libraryCounts,
  loadAttempts,
  loadConfig,
  loadProgress,
  recordAttempt,
  replaceAttempts,
  saveConfig,
  saveProgress,
  wipeProgress,
} from '../storage/db';

export type View = 'learn' | 'drill' | 'levels' | 'fullsetup' | 'challenge' | 'stats' | 'data' | 'settings';

/** Challenge history is small JSON — localStorage, like theme prefs. */
const CHALLENGES_KEY = 'dm.challenges';
/** The in-flight multi-day campaign (day-start snapshot), same shape as mobile. */
const CAMPAIGN_KEY = 'dm.campaign';
/**
 * Local trader profile — a display name only, no account. Same 'dm.*' key NAMES
 * as mobile, but web stores raw strings while mobile JSON-encodes; the portable
 * cross-device format is the backup payload, not these keys.
 */
const PROFILE_KEY = 'dm.profile';
const ONBOARDED_KEY = 'dm.onboarded';

function loadChallengeAttempts(): ChallengeAttempt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHALLENGES_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as ChallengeAttempt[]) : [];
  } catch {
    return [];
  }
}

function loadCampaign(): Campaign | null {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Campaign;
    return parsed && typeof parsed.day === 'number' && parsed.state ? parsed : null;
  } catch {
    return null;
  }
}

interface AppState {
  ready: boolean;
  view: View;
  cfg: EngineConfig;
  progress: Progress;
  attempts: Attempt[];
  meta: BarsetMeta | null;
  libCounts: Record<string, number>;
  flaggedCount: number;
  challengeAttempts: ChallengeAttempt[];
  campaign: Campaign | null;
  profileName: string;
  onboarded: boolean;
  paywallOpen: boolean;
  // session-scoped scoreboard (resets on reload, like v1)
  sessionSeen: number;
  sessionCorrect: number;
  streak: number;
  best: number;

  init: () => Promise<void>;
  setView: (v: View) => void;
  setCfg: (patch: Partial<EngineConfig>) => void;
  answer: (args: {
    patternId: PatternId;
    correct: boolean;
    mode: DrillMode;
    source: DrillSource;
    realizedMove?: number;
  }) => void;
  addChallengeAttempt: (a: ChallengeAttempt) => void;
  saveCampaign: (c: Campaign | null) => void;
  setProfileName: (name: string) => void;
  setOnboarded: (done: boolean) => void;
  openPaywall: () => void;
  closePaywall: () => void;
  refreshData: () => Promise<void>;
  resetProgress: () => Promise<void>;
  importBackup: (payload: BackupPayload) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  view: 'learn',
  cfg: DEFAULT_CONFIG,
  progress: ensureProgress({ perPattern: {} }),
  attempts: [],
  meta: null,
  libCounts: {},
  flaggedCount: 0,
  challengeAttempts: [],
  campaign: null,
  profileName: '',
  onboarded: false,
  paywallOpen: false,
  sessionSeen: 0,
  sessionCorrect: 0,
  streak: 0,
  best: 0,

  init: async () => {
    const [savedCfg, progress, attempts, meta, counts, flagged] = await Promise.all([
      loadConfig(),
      loadProgress(),
      loadAttempts(),
      getBarsetMeta(),
      libraryCounts(),
      flagCount(),
    ]);
    set({
      ready: true,
      cfg: { ...DEFAULT_CONFIG, ...(savedCfg ?? {}) },
      progress: ensureProgress(progress),
      attempts,
      meta: meta ?? null,
      libCounts: counts,
      flaggedCount: flagged,
      challengeAttempts: loadChallengeAttempts(),
      campaign: loadCampaign(),
      profileName: localStorage.getItem(PROFILE_KEY) ?? '',
      onboarded: localStorage.getItem(ONBOARDED_KEY) === '1',
    });
  },

  setProfileName: (name) => {
    const trimmed = name.slice(0, 40);
    set({ profileName: trimmed });
    try {
      if (trimmed.trim()) localStorage.setItem(PROFILE_KEY, trimmed);
      else localStorage.removeItem(PROFILE_KEY);
    } catch {
      // storage full — name survives in memory for this session
    }
  },

  setOnboarded: (done) => {
    set({ onboarded: done });
    try {
      if (done) localStorage.setItem(ONBOARDED_KEY, '1');
      else localStorage.removeItem(ONBOARDED_KEY);
    } catch {
      // storage full — tour just shows again next visit
    }
  },

  setView: (view) => set({ view }),

  addChallengeAttempt: (a) => {
    const challengeAttempts = [...get().challengeAttempts, a].slice(-200);
    set({ challengeAttempts });
    try {
      localStorage.setItem(CHALLENGES_KEY, JSON.stringify(challengeAttempts));
    } catch {
      // storage full — history survives in memory for this session
    }
  },

  saveCampaign: (c) => {
    set({ campaign: c });
    try {
      if (c) localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(c));
      else localStorage.removeItem(CAMPAIGN_KEY);
    } catch {
      // storage full — campaign survives in memory for this session
    }
  },

  openPaywall: () => set({ paywallOpen: true }),
  closePaywall: () => set({ paywallOpen: false }),

  setCfg: (patch) => {
    const cfg = { ...get().cfg, ...patch };
    set({ cfg });
    void saveConfig(cfg);
  },

  answer: ({ patternId, correct, mode, source, realizedMove }) => {
    const now = Date.now();
    const progress = { ...get().progress, perPattern: { ...get().progress.perPattern } };
    applyResult(progress, patternId, correct, now);
    const attempt: Attempt = { t: now, patternId, correct, mode, source, realizedMove };
    const streak = correct ? get().streak + 1 : 0;
    set({
      progress,
      attempts: [...get().attempts, attempt],
      sessionSeen: get().sessionSeen + 1,
      sessionCorrect: get().sessionCorrect + (correct ? 1 : 0),
      streak,
      best: Math.max(get().best, streak),
    });
    void saveProgress(progress);
    void recordAttempt(attempt);
  },

  refreshData: async () => {
    const [meta, counts, flagged] = await Promise.all([getBarsetMeta(), libraryCounts(), flagCount()]);
    set({ meta: meta ?? null, libCounts: counts, flaggedCount: flagged });
  },

  importBackup: async (payload) => {
    const progress = ensureProgress(payload.progress);
    set({ progress, attempts: payload.attempts });
    if (payload.profileName && !get().profileName) get().setProfileName(payload.profileName);
    if (payload.rcUserId) await adoptBillingUserId(payload.rcUserId);
    await Promise.all([saveProgress(progress), replaceAttempts(payload.attempts)]);
  },

  resetProgress: async () => {
    await wipeProgress();
    try {
      localStorage.removeItem(CHALLENGES_KEY);
      localStorage.removeItem(CAMPAIGN_KEY);
    } catch {
      // ignore — history already cleared from state below
    }
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
