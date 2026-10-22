import { Platform, useColorScheme, type ViewStyle } from 'react-native';
import { useApp } from './store';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

/**
 * Semantic palette. Enforced meanings — do not repurpose:
 *  - green/red (`green`/`red`/`good`/`bad`) → MARKET & P&L ONLY: candles,
 *    profit/loss, buy/sell, correct/wrong. Never for decoration. Win/loss is
 *    always paired with a symbol or label (+/−, ▲/▼, ✓/✗, PASS/FAIL), never
 *    hue alone.
 *  - accent (brand green) → primary CTA. `onAccent` keeps CTA text ≥4.5:1.
 *  - gold → premium/paywall highlights (and, by long trader convention, the
 *    PDH/PDL/confluence chart annotations — chart layer only).
 *  - info (blue) → neutral interactive accents: active tabs, links, overnight
 *    levels, "your mark".
 *  - red also covers destructive actions.
 * Colorblind mode swaps market up/down to blue/orange (never touches CTA).
 */
export interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  inset: string;
  chrome: string;
  line: string;
  txt: string;
  muted: string;
  accent: string;
  onAccent: string;
  info: string;
  accent2: string;
  green: string;
  red: string;
  gold: string;
  good: string;
  bad: string;
  /** Candle body/wick colors — TradingView convention, chart layer only. */
  candleUp: string;
  candleDown: string;
  chartBg: string;
  chipBg: string;
}

const DARK_BASE: Palette = {
  bg: '#0A0E12',
  panel: '#12181B',
  panel2: '#1B2228',
  inset: '#0A0E12',
  chrome: '#0D1316',
  line: '#263038',
  txt: '#E6EDF3',
  muted: '#8A97A3',
  accent: '#21C77A',
  onAccent: '#08130D',
  info: '#4C9EFF',
  accent2: '#8B7CFF',
  green: '#21C77A',
  red: '#F6465D',
  gold: '#E4B53C',
  good: '#21C77A',
  bad: '#F6465D',
  candleUp: '#26A69A',
  candleDown: '#EF5350',
  chartBg: '#060809',
  chipBg: '#0A0E12e6',
};

const LIGHT_BASE: Palette = {
  bg: '#FFFFFF',
  panel: '#F6F8FA',
  panel2: '#ECF0F3',
  inset: '#E9EEF2',
  chrome: '#FBFCFD',
  line: '#E2E8ED',
  txt: '#0B0F14',
  muted: '#5A6673',
  accent: '#0B7A55',
  onAccent: '#FFFFFF',
  info: '#2563EB',
  accent2: '#6D5BD0',
  green: '#0E9F6E',
  red: '#E0334B',
  gold: '#C08A1E',
  good: '#0E9F6E',
  bad: '#E0334B',
  candleUp: '#26A69A',
  candleDown: '#EF5350',
  chartBg: '#FFFFFF',
  chipBg: '#ffffffeb',
};

/** Colorblind overlay: market up/down become blue/orange. */
const CB_UP_DOWN: Record<Scheme, { up: string; down: string }> = {
  dark: { up: '#4C9EFF', down: '#FF9E3D' },
  light: { up: '#2563EB', down: '#B45309' },
};

function withColorblind(scheme: Scheme, p: Palette): Palette {
  const { up, down } = CB_UP_DOWN[scheme];
  return { ...p, green: up, red: down, good: up, bad: down, candleUp: up, candleDown: down };
}

/** Translucent tint of a #rrggbb color, for chip/stat backgrounds. */
export function tint(hex: string, alpha = 0.14): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex.slice(0, 7)}${a}`;
}

export const RADIUS = { card: 16, control: 12, inner: 10 } as const;

export interface Theme {
  scheme: Scheme;
  colorblind: boolean;
  c: Palette;
  shadow: ViewStyle;
  levelColor: Record<string, string>;
}

function makeShadow(scheme: Scheme): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: scheme === 'dark' ? '#000' : '#31404b',
      shadowOpacity: scheme === 'dark' ? 0.35 : 0.1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
    },
    default: { elevation: scheme === 'dark' ? 4 : 2 },
  });
}

function makeTheme(scheme: Scheme, colorblind: boolean): Theme {
  const base = scheme === 'dark' ? DARK_BASE : LIGHT_BASE;
  const c = colorblind ? withColorblind(scheme, base) : base;
  return {
    scheme,
    colorblind,
    c,
    shadow: makeShadow(scheme),
    levelColor: {
      PDH: c.gold,
      PDL: c.gold,
      PC: c.muted,
      ONH: c.info,
      ONL: c.info,
      R50: c.accent2,
      R100: c.accent2,
      VWAP: c.green,
      SWING: scheme === 'dark' ? '#55616b' : '#a2adb6',
    },
  };
}

const THEME_CACHE: Record<string, Theme> = {
  'dark:0': makeTheme('dark', false),
  'dark:1': makeTheme('dark', true),
  'light:0': makeTheme('light', false),
  'light:1': makeTheme('light', true),
};

export const THEMES: Record<Scheme, Theme> = { dark: THEME_CACHE['dark:0'], light: THEME_CACHE['light:0'] };

/** Resolved theme: Settings choice (falling back to the OS scheme) + colorblind flag. */
export function useTheme(): Theme {
  const mode = useApp((s) => s.themeMode);
  const colorblind = useApp((s) => s.colorblind);
  const system = useColorScheme();
  const scheme: Scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  return THEME_CACHE[`${scheme}:${colorblind ? 1 : 0}`];
}
