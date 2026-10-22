/**
 * All tunable domain constants live here — no magic numbers in the engine code.
 * Values marked (Settings) are user-editable in the Settings screen.
 */
export interface EngineConfig {
  /** Zone tolerance in points: "at a level" means within this distance. (Settings) */
  tol: number;
  /** Confluence: levels within this many points cluster into one stronger zone. (Settings) */
  confluenceTol: number;
  /** Sweep detector: wick must pierce a level by at least this many points. */
  sweepPts: number;
  /** Sweep detector: close must reclaim past the level by at least this many points. */
  reclaimPts: number;
  /** Pin bar: rejection wick must be >= this multiple of the body. */
  pinRatio: number;
  /** Double top/bottom: min/max bars between the two touches. */
  doubleMinBars: number;
  doubleMaxBars: number;
  /** Break & retest: how many bars back to look for the break. */
  brWindow: number;
  /** Inside bar: bars ahead allowed for the mother-bar break that labels direction. */
  insideBreakWindow: number;
  /** FVG: max bars between gap creation and its retest. */
  fvgWindow: number;
  /** VWAP bounce: bars of one-sided trend required before the touch. */
  vwapTrendBars: number;
  /** Round-number levels: multiples of 50 within this many points of price. */
  roundWindow: number;
  /** Swing pivots: strength (bars each side) and lookback. */
  swingStrength: number;
  swingLookback: number;
  /** Drill windows: lead-in bars shown, outcome bars revealed. */
  leadInBars: number;
  outcomeBars: number;
  /** Detector hygiene: min bars between two instances of the same pattern. */
  dedupeGapBars: number;
  /** Max real instances kept per pattern per trading day. */
  maxPerPatternPerDay: number;
  /** VWAP anchor session. (Settings) */
  vwapAnchor: 'rth' | 'globex';
  /** Share of 'no setup' negatives the scheduler mixes in. (Settings) */
  noSetupRate: number;
  /** Drill sampling session filter. (Settings) */
  sessionFilter: 'any' | 'rth' | 'evening' | 'overnight';
  /** "Evening" = first N hours after the 18:00 ET Globex reopen. (Settings) */
  eveningHours: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  tol: 15,
  confluenceTol: 15,
  sweepPts: 4,
  reclaimPts: 2,
  pinRatio: 2,
  doubleMinBars: 5,
  doubleMaxBars: 60,
  brWindow: 45,
  insideBreakWindow: 10,
  fvgWindow: 45,
  vwapTrendBars: 20,
  roundWindow: 120,
  swingStrength: 5,
  swingLookback: 240,
  leadInBars: 60,
  outcomeBars: 20,
  dedupeGapBars: 30,
  maxPerPatternPerDay: 6,
  vwapAnchor: 'rth',
  noSetupRate: 0.2,
  sessionFilter: 'any',
  eveningHours: 6,
};

/** Leitner review intervals in days, by box 1..5. Box 1 = every session (0 days). */
export const LEITNER_INTERVALS_DAYS: Record<number, number> = {
  1: 0,
  2: 1,
  3: 3,
  4: 7,
  5: 14,
};

export const DAY_MS = 24 * 60 * 60 * 1000;
