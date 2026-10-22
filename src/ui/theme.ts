import { useSyncExternalStore } from 'react';

/**
 * Web theming. The user's preference ('system' | 'light' | 'dark') lives in
 * localStorage under the same key the mobile app uses in AsyncStorage; the
 * resolved scheme is stamped on <html data-theme="..."> (an inline script in
 * index.html does the first stamp before paint, so there is no flash).
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

const KEY = 'dm.theme';
const CB_KEY = 'dm.cb';
const media = window.matchMedia('(prefers-color-scheme: light)');
const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  const raw = localStorage.getItem(KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function resolvedScheme(): Scheme {
  const pref = getThemePref();
  if (pref !== 'system') return pref;
  return media.matches ? 'light' : 'dark';
}

export function getColorblind(): boolean {
  return localStorage.getItem(CB_KEY) === '1';
}

function apply(): void {
  document.documentElement.dataset.theme = resolvedScheme();
  document.documentElement.dataset.cb = getColorblind() ? '1' : '0';
  for (const fn of listeners) fn();
}

export function setThemePref(pref: ThemePref): void {
  if (pref === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, pref);
  apply();
}

export function setColorblind(on: boolean): void {
  if (on) localStorage.setItem(CB_KEY, '1');
  else localStorage.removeItem(CB_KEY);
  apply();
}

export function initTheme(): void {
  apply();
  media.addEventListener('change', () => {
    if (getThemePref() === 'system') apply();
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: the currently resolved scheme, re-rendering on change. */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribe, resolvedScheme);
}

/** React hook: colorblind mode (market up/down as blue/orange). */
export function useColorblind(): boolean {
  return useSyncExternalStore(subscribe, getColorblind);
}

/**
 * Chart colors per scheme — mirrors the mobile palette. up/down carry market
 * meaning only; `info` (blue) marks interactive annotations; gold marks
 * PDH/PDL/confluence lines (chart layer) and premium in the UI.
 */
export interface ChartPalette {
  bg: string;
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  accent: string;
  info: string;
  accent2: string;
  gold: string;
  good: string;
  bad: string;
  muted: string;
  swing: string;
  vwap: string;
}

const CHART_BASE: Record<Scheme, ChartPalette> = {
  dark: {
    bg: '#060809',
    text: '#8a97a3',
    grid: '#1a2228',
    border: '#263038',
    up: '#21c77a',
    down: '#f6465d',
    accent: '#21c77a',
    info: '#4c9eff',
    accent2: '#8b7cff',
    gold: '#e4b53c',
    good: '#21c77a',
    bad: '#f6465d',
    muted: '#8a97a3',
    swing: '#55616b',
    vwap: '#21c77a',
  },
  light: {
    bg: '#ffffff',
    text: '#5a6673',
    grid: '#e7edf2',
    border: '#e2e8ed',
    up: '#0e9f6e',
    down: '#e0334b',
    accent: '#0b7a55',
    info: '#2563eb',
    accent2: '#6d5bd0',
    gold: '#c08a1e',
    good: '#0e9f6e',
    bad: '#e0334b',
    muted: '#5a6673',
    swing: '#a2adb6',
    vwap: '#0e9f6e',
  },
};

const CB_UP_DOWN: Record<Scheme, { up: string; down: string }> = {
  dark: { up: '#4c9eff', down: '#ff9e3d' },
  light: { up: '#2563eb', down: '#b45309' },
};

const CHART_CB: Record<Scheme, ChartPalette> = {
  dark: { ...CHART_BASE.dark, ...CB_UP_DOWN.dark, good: CB_UP_DOWN.dark.up, bad: CB_UP_DOWN.dark.down, vwap: CB_UP_DOWN.dark.up },
  light: { ...CHART_BASE.light, ...CB_UP_DOWN.light, good: CB_UP_DOWN.light.up, bad: CB_UP_DOWN.light.down, vwap: CB_UP_DOWN.light.up },
};

export function chartPalette(scheme: Scheme, colorblind: boolean): ChartPalette {
  return colorblind ? CHART_CB[scheme] : CHART_BASE[scheme];
}

/** @deprecated kept for call sites that don't care about colorblind mode. */
export const CHART_COLORS: Record<Scheme, ChartPalette> = CHART_BASE;

export function levelColorsFor(p: ChartPalette): Record<string, string> {
  return {
    PDH: p.gold,
    PDL: p.gold,
    PC: p.muted,
    ONH: p.info,
    ONL: p.info,
    R50: p.accent2,
    R100: p.accent2,
    VWAP: p.vwap,
    SWING: p.swing,
  };
}
