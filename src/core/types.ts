/** A single OHLCV bar. `t` is UTC epoch milliseconds of the bar OPEN. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type PatternId =
  | 'sweep'
  | 'pin'
  | 'engulf'
  | 'inside'
  | 'br'
  | 'double'
  | 'vwap_bounce'
  | 'fvg'
  | 'no';

export type Bias = 'long' | 'short' | 'none';

export type LevelId =
  | 'PDH'
  | 'PDL'
  | 'PC'
  | 'ONH'
  | 'ONL'
  | 'VWAP'
  | 'R50'
  | 'R100'
  | 'SWING';

export interface Level {
  id: LevelId;
  price: number;
  /** Human label for chart drawing, e.g. "PDH 21540" */
  label: string;
}

export interface LevelCluster {
  price: number;
  members: LevelId[];
}

export interface LevelSet {
  levels: Level[];
  clusters: LevelCluster[];
  /** VWAP value at the anchor bar (also present in `levels` as id VWAP). */
  vwap: number | null;
  /** VWAP series aligned to the bars it was computed over (for drawing). */
  vwapSeries?: { t: number; value: number }[];
}

export type DrillSource = 'synthetic' | 'real';

export interface DrillInstance {
  id: string;
  patternId: PatternId;
  bias: Bias;
  /** Bars shown to the user (lead-in + trigger bars). Last bar is the decision point. */
  bars: Candle[];
  /** Bars revealed after answering. Real data => actual forward bars. */
  outcomeBars: Candle[];
  /** Index range [from, to] of the pattern bars within `bars` for highlight. */
  hl: [number, number];
  levelSet: LevelSet;
  /** The level the setup formed at (null for pure chop 'no' instances). */
  levelHit: Level | null;
  /** Whether the anchor level is part of a confluence cluster. */
  confluent: boolean;
  source: DrillSource;
  /** Realized move over outcome bars in points, signed by bias (real data only). */
  realizedMove?: number;
  /** Session the anchor bar sits in (real data only) — used by the session filter. */
  sessionTag?: SessionTag;
}

export interface PatternInfo {
  id: PatternId;
  name: string;
  short: string;
  cat: 'Trigger' | 'Skill';
  def: string;
  why: string;
  look: string;
  trap: string;
  entry: string;
  stop: string;
  target: string;
  evidence?: string;
  /** Correct answer key for the full-setup stop-placement question. */
  stopKey: 'beyondExtreme' | 'backThroughLevel' | 'oppositeInside' | 'none';
}

export interface PatternProgress {
  seen: number;
  correct: number;
  streak: number;
  lastSeenAt: number;
  /** Leitner box 1..5. 0 = never seen. */
  box: number;
  /** Epoch ms when this pattern is next due for review. */
  dueAt: number;
}

export type DrillMode = 'drill' | 'levelDrill' | 'fullSetup';

export interface Attempt {
  t: number;
  patternId: PatternId;
  correct: boolean;
  mode: DrillMode;
  source: DrillSource;
  /** For real drills where the user called a setup: realized move in points. */
  realizedMove?: number;
}

export interface Progress {
  perPattern: Record<string, PatternProgress>;
}

export interface BarsetMeta {
  id: string;
  symbol: string;
  source: string;
  firstBar: number;
  lastBar: number;
  count: number;
  importedAt: number;
}

export interface LabelFlag {
  instanceId: string;
  reason: string;
  t: number;
}

/** Session classification of a single bar (America/New_York rules). */
export type SessionTag = 'rth' | 'postrth' | 'overnight' | 'maintenance';

export interface BarSessionInfo {
  /** minutes since ET midnight of bar open */
  etMinutes: number;
  /** ET calendar date as yyyymmdd number */
  etDate: number;
  tag: SessionTag;
  /** yyyymmdd of the overnight session this bar belongs to (date of the 18:00 open), or 0 */
  overnightKey: number;
  /** yyyymmdd of the RTH session this bar belongs to, or 0 */
  rthKey: number;
}
