import { memo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, G, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { toET, type Bias, type Candle, type Level, type LevelCluster } from '../core';
import { tint, useTheme } from '../theme';

export interface UserMark {
  price: number;
  hit?: boolean | null;
  /** Short name shown on the chip, e.g. "PDH". Falls back to "mark". */
  label?: string;
}

/** Entry / stop / target / rule overlays for the trading sim. */
export interface TradeLine {
  price: number;
  kind: 'entry' | 'stop' | 'target' | 'fail' | 'goal';
  /** Chip text override, e.g. "entry +$120". Falls back to the kind. */
  label?: string;
}

/** On-bar trade markers: entries and exits, TopstepX-style. */
export interface TradeMarker {
  t: number;
  price: number;
  kind: 'buy' | 'sell' | 'exit';
  /** Colors an exit marker by outcome. */
  win?: boolean;
}

/** Small right-axis price tags (session high/low, prior close…). */
export interface AxisTag {
  price: number;
  label: string;
  color?: string;
}

/** Shaded horizontal price band (e.g. the danger zone below a fail line). */
export interface Zone {
  from: number;
  to: number;
  color: string;
  opacity?: number;
}

interface Props {
  bars: Candle[];
  outcome?: Candle[];
  levels?: Level[];
  clusters?: LevelCluster[];
  vwapSeries?: { t: number; value: number }[];
  /** Arrow on the last decision bar, drawn after reveal. */
  marker?: { bias: Bias } | null;
  userMarks?: UserMark[];
  tradeLines?: TradeLine[];
  tradeMarkers?: TradeMarker[];
  axisTags?: AxisTag[];
  zones?: Zone[];
  /** Extra prices the y-scale must include (e.g. drill targets off the candle range). */
  includePrices?: number[];
  height?: number;
  showTime?: boolean;
  onPricePress?: (price: number) => void;
  /** Which userMarks entry may be dragged (the selected one); null = none. */
  dragIndex?: number | null;
  /** Fires once, on release, with the dragged mark's final price. */
  onMarkMove?: (index: number, price: number) => void;
  /** Pinch zoom, discrete: +1 per zoom-in step, −1 per zoom-out step. */
  onZoomStep?: (dir: 1 | -1) => void;
  /**
   * Pinch zoom, continuous (preferred over onZoomStep when both given):
   * cumulative finger-distance scale since the pinch began — >1 means
   * zooming in. The parent maps it onto its span/zoom state.
   */
  onPinch?: (scale: number) => void;
  /** True while a drag/pinch owns the touch — freeze the parent ScrollView. */
  onGesture?: (active: boolean) => void;
}

interface Chip {
  y: number;
  text: string;
  color: string;
}

const DASH: Record<string, string | undefined> = {
  PDH: '6,5',
  PDL: '6,5',
  PC: '2,4',
  ONH: '6,5',
  ONL: '6,5',
  R50: '2,4',
  R100: '6,5',
  VWAP: undefined,
  SWING: '2,4',
};

const mL = 4;
const mR = 52;
const mT = 10;

/** Round-number price ticks: 1/2/2.5/5 × 10^k steps covering [min, max]. */
function niceTicks(min: number, max: number, target = 5): number[] {
  const range = max - min;
  if (range <= 0 || !isFinite(range)) return [];
  const rough = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = 10 * mag;
  for (const c of [1, 2, 2.5, 5, 10]) {
    if (c * mag >= rough) {
      step = c * mag;
      break;
    }
  }
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/**
 * Bar indices on round clock boundaries (:00/:30/…). Step is chosen from the
 * TIME SPAN (not the bar count) so aggregated bars label sanely; the ladder
 * runs to full days so multi-day views don't overflow with candidates. These
 * are candidates — the scene thins them to a minimum pixel gap.
 */
function timeTickIdx(bars: Candle[]): number[] {
  if (bars.length < 5) return [];
  const spanMin = Math.max(1, (bars[bars.length - 1].t - bars[0].t) / 60_000);
  let stepMin = 2880;
  for (const s of [15, 30, 60, 120, 240, 480, 720, 1440, 2880]) {
    if (spanMin / s <= 7) {
      stepMin = s;
      break;
    }
  }
  const idx: number[] = [];
  let prevBucket: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const p = toET(bars[i].t);
    const bucket = (p.y * 10000 + p.mo * 100 + p.d) * 10000 + Math.floor((p.hh * 60 + p.mm) / stepMin);
    if (prevBucket !== null && bucket !== prevBucket) idx.push(i);
    prevBucket = bucket;
  }
  return idx;
}

/** Index of the bar whose time bucket contains t (bars may be aggregated). */
function idxForTime(full: Candle[], t: number): number {
  if (!full.length || t < full[0].t) return -1;
  for (let i = full.length - 1; i >= 0; i--) {
    if (full[i].t <= t) return i;
  }
  return -1;
}

/** Price range of the visible candles plus everything the scale must include. */
function scaleOf(full: Candle[], includePrices: number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (const k of full) {
    min = Math.min(min, k.l);
    max = Math.max(max, k.h);
  }
  for (const p of includePrices) {
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  if (!isFinite(min)) {
    min = 0;
    max = 1;
  }
  const pad = (max - min) * 0.1 || 10;
  return { min: min - pad, max: max + pad };
}

interface SceneProps {
  bars: Candle[];
  outcome: Candle[];
  levels: Level[];
  clusters: LevelCluster[];
  vwapSeries?: { t: number; value: number }[];
  marker: { bias: Bias } | null;
  userMarks: UserMark[];
  /** Mark hidden while its live position renders on the drag overlay. */
  hideMark: number | null;
  tradeLines: TradeLine[];
  tradeMarkers: TradeMarker[];
  axisTags: AxisTag[];
  zones: Zone[];
  min: number;
  max: number;
  w: number;
  height: number;
  showTime: boolean;
  dragIndex: number | null;
}

/**
 * The full SVG scene, memoized: while a drag or pinch is in flight nothing in
 * here changes, so per-finger-move renders touch only the tiny drag overlay —
 * this is what makes dragging feel smooth instead of re-painting hundreds of
 * SVG nodes at 60 Hz.
 */
const Scene = memo(function Scene({
  bars,
  outcome,
  levels,
  clusters,
  vwapSeries,
  marker,
  userMarks,
  hideMark,
  tradeLines,
  tradeMarkers,
  axisTags,
  zones,
  min,
  max,
  w,
  height,
  showTime,
  dragIndex,
}: SceneProps) {
  const { c: C, levelColor } = useTheme();
  const mB = showTime ? 18 : 8;
  const plotW = Math.max(w - mL - mR, 10);
  const plotH = Math.max(height - mT - mB, 10);
  const range = max - min;
  const yOf = (p: number) => mT + plotH - ((p - min) / range) * plotH;

  const full = [...bars, ...outcome];
  const n = Math.max(full.length, 1);
  const step = plotW / n;
  const bw = Math.min(step * 0.65, 12);

  // left-side label chips (same rules as web: skip off-scale, nudge crowded)
  const chips: Chip[] = [];
  const rawChips: Chip[] = [];
  for (const lv of levels) {
    const y = yOf(lv.price);
    if (y < mT - 2 || y > mT + plotH + 2) continue;
    rawChips.push({ y, text: lv.label, color: levelColor[lv.id] ?? levelColor.SWING });
  }
  for (const cl of clusters) {
    const y = yOf(cl.price);
    if (y < mT - 2 || y > mT + plotH + 2) continue;
    rawChips.push({ y, text: `★ x${cl.members.length}`, color: C.gold });
  }
  userMarks.forEach((m, i) => {
    if (i === hideMark) return;
    const y = yOf(m.price);
    if (y < mT - 2 || y > mT + plotH + 2) return;
    const pending = m.hit === undefined || m.hit === null;
    const name = m.label ?? 'mark';
    rawChips.push({
      y,
      text: pending ? (i === dragIndex ? `${name} ↕` : name) : m.hit ? `${name} ✓` : `${name} ✗`,
      color: pending ? C.info : m.hit ? C.good : C.bad,
    });
  });
  const tradeLineColor = (kind: TradeLine['kind']) =>
    kind === 'entry' ? C.info : kind === 'stop' || kind === 'fail' ? C.bad : kind === 'goal' ? C.gold : C.good;
  for (const tl of tradeLines) {
    const y = yOf(tl.price);
    if (y < mT - 2 || y > mT + plotH + 2) continue;
    rawChips.push({ y, text: tl.label ?? tl.kind, color: tradeLineColor(tl.kind) });
  }
  rawChips.sort((a, b) => a.y - b.y);
  let prevY = -Infinity;
  for (const r of rawChips) {
    let y = Math.min(Math.max(r.y, mT + 7), mT + plotH - 7);
    if (y - prevY < 14) y = prevY + 14;
    if (y > mT + plotH - 5) continue;
    prevY = y;
    chips.push({ ...r, y });
  }

  // axes: two-weight price grid (faint minors + round-number majors, both
  // solid — pro charts keep gridlines as a subtle background layer) plus
  // clock-aligned time gridlines
  // denser price scale on taller charts — traders want prices, not blank space
  const priceTicks = niceTicks(min + range * 0.03, max - range * 0.03, Math.max(4, Math.round(plotH / 44)));
  const majorStep = priceTicks.length >= 2 ? priceTicks[1] - priceTicks[0] : 0;
  const minorTicks: number[] = [];
  if (majorStep > 0) {
    const div = (majorStep / range) * plotH >= 44 ? 4 : 2; // keep ≥ ~11px gaps
    const mStep = majorStep / div;
    for (let v = Math.ceil(min / mStep) * mStep; v <= max; v += mStep) {
      if (Math.abs(v / majorStep - Math.round(v / majorStep)) > 1e-6) minorTicks.push(v);
    }
  }
  // thin the clock-boundary candidates to an even ≥54px rhythm — session gaps
  // compress bar time unevenly, and crowded/overlapping labels read as broken
  const timeIdx: number[] = [];
  if (showTime) {
    let lastX = -Infinity;
    for (const i of timeTickIdx(bars)) {
      const x = mL + i * step + step / 2;
      if (x - lastX >= 54 && x <= w - mR - 16) {
        timeIdx.push(i);
        lastX = x;
      }
    }
  }
  // a tick that crosses into a new ET day shows the date instead of the time
  const fmtTick = (k: number) => {
    const p = toET(bars[timeIdx[k]].t);
    const prev = k > 0 ? toET(bars[timeIdx[k - 1]].t) : null;
    if (prev && (prev.d !== p.d || prev.mo !== p.mo)) return `${p.mo}/${p.d}`;
    return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
  };
  const gridCol = tint(C.line, 0.6);
  const gridColMinor = tint(C.line, 0.28);

  // vwap: bucket by (possibly aggregated) bar so each candle gets one point
  let vwapPts = '';
  if (vwapSeries && bars.length) {
    const byIdx = new Map<number, number>();
    for (const p of vwapSeries) {
      if (p.t < bars[0].t || p.t > full[full.length - 1].t) continue;
      const idx = idxForTime(full, p.t);
      if (idx >= 0) byIdx.set(idx, p.value); // last point in the bucket wins
    }
    vwapPts = [...byIdx.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, v]) => `${(mL + idx * step + step / 2).toFixed(1)},${yOf(v).toFixed(1)}`)
      .join(' ');
  }

  const last = bars[bars.length - 1];
  const lastY = last ? yOf(last.c) : 0;
  const lastUp = last ? last.c >= last.o : true;

  return (
    <Svg width={w} height={height}>
      {/* shaded zones (danger bands) — behind everything */}
      {zones.map((z, i) => {
        const yTop = Math.max(mT, Math.min(yOf(z.from), yOf(z.to)));
        const yBot = Math.min(mT + plotH, Math.max(yOf(z.from), yOf(z.to)));
        if (yBot <= yTop) return null;
        return (
          <Rect key={`zn${i}`} x={mL} y={yTop} width={plotW} height={yBot - yTop} fill={z.color} opacity={z.opacity ?? 0.07} />
        );
      })}
      {/* minor price gridlines */}
      {minorTicks.map((p, i) => {
        const y = yOf(p);
        if (y < mT || y > mT + plotH) return null;
        return <Line key={`mt${i}`} x1={mL} x2={w - mR} y1={y} y2={y} stroke={gridColMinor} strokeWidth={1} />;
      })}
      {/* major price gridlines + right axis */}
      {priceTicks.map((p, i) => {
        const y = yOf(p);
        return (
          <G key={`pt${i}`}>
            <Line x1={mL} x2={w - mR} y1={y} y2={y} stroke={gridCol} strokeWidth={1} />
            <Line x1={w - mR} x2={w - mR + 4} y1={y} y2={y} stroke={C.muted} strokeWidth={1} />
            <SvgText x={w - mR + 7} y={y + 3} fill={C.muted} fontSize={9}>
              {p.toFixed(0)}
            </SvgText>
          </G>
        );
      })}
      {/* time gridlines */}
      {timeIdx.map((i) => {
        const x = mL + i * step + step / 2;
        return (
          <Line key={`tg${i}`} x1={x} x2={x} y1={mT} y2={mT + plotH} stroke={gridCol} strokeWidth={1} />
        );
      })}
      {/* axis borders */}
      <Line x1={w - mR} x2={w - mR} y1={mT} y2={mT + plotH} stroke={C.line} strokeWidth={1} />
      <Line x1={mL} x2={w - mR} y1={mT + plotH} y2={mT + plotH} stroke={C.line} strokeWidth={1} />

      {/* level + cluster + mark lines */}
      {levels.map((lv, i) => {
        const y = yOf(lv.price);
        if (y < mT || y > mT + plotH) return null;
        return (
          <Line
            key={`lv${i}`}
            x1={mL}
            x2={w - mR}
            y1={y}
            y2={y}
            stroke={levelColor[lv.id] ?? levelColor.SWING}
            strokeWidth={1}
            strokeDasharray={DASH[lv.id]}
            opacity={0.75}
          />
        );
      })}
      {clusters.map((cl, i) => {
        const y = yOf(cl.price);
        if (y < mT || y > mT + plotH) return null;
        return <Line key={`cl${i}`} x1={mL} x2={w - mR} y1={y} y2={y} stroke={C.gold} strokeWidth={2} opacity={0.85} />;
      })}
      {userMarks.map((m, i) => {
        if (i === hideMark) return null;
        const y = yOf(m.price);
        if (y < mT || y > mT + plotH) return null;
        const pending = m.hit === undefined || m.hit === null;
        const col = pending ? C.info : m.hit ? C.good : C.bad;
        const selected = pending && i === dragIndex;
        return (
          <G key={`um${i}`}>
            {selected && (
              <Line x1={mL} x2={w - mR} y1={y} y2={y} stroke={col} strokeWidth={8} opacity={0.15} />
            )}
            <Line x1={mL} x2={w - mR} y1={y} y2={y} stroke={col} strokeWidth={selected ? 2.5 : 2} strokeDasharray="8,6" />
          </G>
        );
      })}

      {/* trade lines (entry / stop / target / rule levels) */}
      {tradeLines.map((tl, i) => {
        const y = yOf(tl.price);
        if (y < mT || y > mT + plotH) return null;
        return (
          <Line
            key={`tl${i}`}
            x1={mL}
            x2={w - mR}
            y1={y}
            y2={y}
            stroke={tradeLineColor(tl.kind)}
            strokeWidth={tl.kind === 'entry' ? 1.5 : tl.kind === 'goal' ? 1.5 : 2}
            strokeDasharray={
              tl.kind === 'entry' ? undefined : tl.kind === 'fail' ? '4,3' : tl.kind === 'goal' ? '10,4' : '7,5'
            }
            opacity={tl.kind === 'fail' ? 0.9 : 1}
          />
        );
      })}

      {/* vwap path */}
      {vwapPts ? <Polyline points={vwapPts} fill="none" stroke={tint(C.green, 0.8)} strokeWidth={1} /> : null}

      {/* outcome divider */}
      {outcome.length > 0 && (
        <>
          <Line
            x1={mL + bars.length * step}
            x2={mL + bars.length * step}
            y1={mT}
            y2={mT + plotH}
            stroke={tint(C.info, 0.4)}
            strokeWidth={1}
            strokeDasharray="3,3"
          />
          <SvgText x={mL + bars.length * step + 4} y={mT + 10} fill={tint(C.info, 0.7)} fontSize={9}>
            outcome →
          </SvgText>
        </>
      )}

      {/* candles */}
      {full.map((k, i) => {
        const x = mL + i * step + step / 2;
        const up = k.c >= k.o;
        const isOut = i >= bars.length;
        const col = up ? C.candleUp : C.candleDown;
        const yo = yOf(k.o);
        const yc = yOf(k.c);
        const top = Math.min(yo, yc);
        const h = Math.max(Math.abs(yo - yc), 1.2);
        return (
          <G key={`c${i}`} opacity={isOut ? 0.45 : 1}>
            <Line x1={x} x2={x} y1={yOf(k.h)} y2={yOf(k.l)} stroke={col} strokeWidth={1.1} />
            <Rect x={x - bw / 2} y={top} width={bw} height={h} fill={col} />
          </G>
        );
      })}

      {/* trade entry/exit markers on their bars (t-bucket match survives aggregation) */}
      {tradeMarkers.map((m, i) => {
        const idx = idxForTime(full, m.t);
        if (idx < 0) return null;
        const x = mL + idx * step + step / 2;
        const y = yOf(m.price);
        if (y < mT - 4 || y > mT + plotH + 4) return null;
        if (m.kind === 'exit') {
          const col = m.win === false ? C.bad : C.good;
          return (
            <G key={`mk${i}`}>
              <Circle cx={x} cy={y} r={3.4} fill={col} stroke={C.chartBg} strokeWidth={1} />
            </G>
          );
        }
        const buy = m.kind === 'buy';
        const col = buy ? C.candleUp : C.candleDown;
        const tip = buy ? y + 2 : y - 2;
        const base = buy ? tip + 8 : tip - 8;
        return (
          <Polygon
            key={`mk${i}`}
            points={`${x - 4.5},${base} ${x + 4.5},${base} ${x},${tip}`}
            fill={col}
            stroke={C.chartBg}
            strokeWidth={0.8}
          />
        );
      })}

      {/* right-axis price tags (session H/L, prior close…) */}
      {axisTags.map((tag, i) => {
        const y = yOf(tag.price);
        if (y < mT + 5 || y > mT + plotH - 5) return null;
        const col = tag.color ?? C.muted;
        return (
          <G key={`at${i}`}>
            <Line x1={w - mR - 4} x2={w - mR} y1={y} y2={y} stroke={col} strokeWidth={1.2} />
            <SvgText x={w - mR + 7} y={y + 2.5} fill={col} fontSize={7.5} fontWeight="700">
              {tag.label}
            </SvgText>
          </G>
        );
      })}

      {/* last-price tag on the axis */}
      {last && lastY >= mT && lastY <= mT + plotH && (
        <G>
          <Line x1={mL} x2={w - mR} y1={lastY} y2={lastY} stroke={lastUp ? C.candleUp : C.candleDown} strokeWidth={1} strokeDasharray="1,3" opacity={0.55} />
          <Rect x={w - mR + 1} y={lastY - 8} width={mR - 3} height={16} rx={3} fill={lastUp ? C.candleUp : C.candleDown} />
          <SvgText x={w - mR + 5} y={lastY + 3.5} fill={C.chartBg} fontSize={9.5} fontWeight="700">
            {last.c.toFixed(0)}
          </SvgText>
        </G>
      )}

      {/* decision-bar marker */}
      {marker && last && (
        marker.bias === 'none' ? (
          <Circle cx={mL + (bars.length - 1) * step + step / 2} cy={yOf(last.l) + 10} r={4} fill={C.muted} />
        ) : marker.bias === 'long' ? (
          <Polygon
            points={(() => {
              const x = mL + (bars.length - 1) * step + step / 2;
              const y = Math.min(yOf(last.l) + 6, mT + plotH - 2);
              return `${x - 5},${y + 9} ${x + 5},${y + 9} ${x},${y}`;
            })()}
            fill={C.good}
          />
        ) : (
          <Polygon
            points={(() => {
              const x = mL + (bars.length - 1) * step + step / 2;
              const y = Math.max(yOf(last.h) - 6, mT + 2);
              return `${x - 5},${y - 9} ${x + 5},${y - 9} ${x},${y}`;
            })()}
            fill={C.bad}
          />
        )
      )}

      {/* left label chips */}
      {chips.map((c, i) => {
        const cw = c.text.length * 5.4 + 10;
        return (
          <G key={`chip${i}`}>
            <Rect x={6} y={c.y - 7} width={cw} height={14} rx={3} fill={C.chipBg} stroke={c.color} strokeWidth={1} />
            <SvgText x={11} y={c.y + 3} fill={c.color} fontSize={9} fontWeight="600">
              {c.text}
            </SvgText>
          </G>
        );
      })}

      {/* time labels */}
      {timeIdx.map((i, k) => (
        <SvgText
          key={`tt${i}`}
          x={Math.min(Math.max(mL + i * step + step / 2 - 13, mL), w - mR - 28)}
          y={height - 5}
          fill={C.muted}
          fontSize={9}
        >
          {fmtTick(k)}
        </SvgText>
      ))}
    </Svg>
  );
});

const buzz = (fn: () => Promise<unknown>) => {
  fn().catch(() => {}); // haptics are garnish — never let them throw
};

export function SvgCandleChart({
  bars,
  outcome = [],
  levels = [],
  clusters = [],
  vwapSeries,
  marker = null,
  userMarks = [],
  tradeLines = [],
  tradeMarkers = [],
  axisTags = [],
  zones = [],
  includePrices = [],
  height = 300,
  showTime = false,
  onPricePress,
  dragIndex = null,
  onMarkMove,
  onZoomStep,
  onPinch,
  onGesture,
}: Props) {
  const [w, setW] = useState(0);
  const { c: C } = useTheme();
  // Live drag preview — the ONLY state that changes per finger move.
  const [preview, setPreview] = useState<{ y: number; price: number } | null>(null);
  const gesture = useRef<{
    mode: 'tap' | 'drag' | 'pinch';
    startPageY: number;
    startPrice: number;
    /** Live dragged price — ref, not state, so release never reads a stale frame. */
    curPrice: number;
    lastTickPrice: number;
    pinchDist: number;
    lastPinchEmit: number;
  } | null>(null);
  const pinchable = Boolean(onPinch ?? onZoomStep);

  const mB = showTime ? 18 : 8;
  const plotH = Math.max(height - mT - mB, 10);
  const full = [...bars, ...outcome];
  const { min, max } = scaleOf(full, includePrices);
  const range = max - min;
  const yOf = (p: number) => mT + plotH - ((p - min) / range) * plotH;
  const priceOf = (y: number) => min + ((mT + plotH - y) / plotH) * range;
  const clampY = (y: number) => Math.min(Math.max(y, mT), mT + plotH);

  const nearDraggable = (y: number): boolean =>
    dragIndex !== null &&
    dragIndex < userMarks.length &&
    Boolean(onMarkMove) &&
    Math.abs(yOf(userMarks[dragIndex].price) - y) <= 24;

  const touchDist = (e: { touches: { pageX: number; pageY: number }[] }): number => {
    const [a, b] = e.touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  };

  const endGesture = () => {
    gesture.current = null;
    setPreview(null);
    onGesture?.(false);
  };

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ width: '100%', height, backgroundColor: C.chartBg, borderRadius: 8, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}
    >
      {w > 0 && full.length > 0 && (
        <View
          pointerEvents="box-only"
          onStartShouldSetResponder={(e) => {
            const y = e.nativeEvent.locationY;
            if (y < mT - 8 || y > mT + plotH + 8) return false;
            return Boolean(onPricePress) || nearDraggable(y);
          }}
          // a second finger starts a pinch even when the touch began elsewhere
          onMoveShouldSetResponder={(e) => pinchable && e.nativeEvent.touches.length >= 2}
          onResponderGrant={(e) => {
            const y = e.nativeEvent.locationY;
            if (e.nativeEvent.touches.length >= 2 && pinchable) {
              gesture.current = { mode: 'pinch', startPageY: 0, startPrice: 0, curPrice: 0, lastTickPrice: 0, pinchDist: touchDist(e.nativeEvent), lastPinchEmit: 0 };
              onGesture?.(true);
              buzz(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
              return;
            }
            if (nearDraggable(y)) {
              const price = userMarks[dragIndex!].price;
              gesture.current = { mode: 'drag', startPageY: e.nativeEvent.pageY, startPrice: price, curPrice: price, lastTickPrice: Math.round(price), pinchDist: 0, lastPinchEmit: 0 };
              setPreview({ y: yOf(price), price });
              onGesture?.(true);
              buzz(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
              return;
            }
            gesture.current = { mode: 'tap', startPageY: e.nativeEvent.pageY, startPrice: 0, curPrice: 0, lastTickPrice: 0, pinchDist: 0, lastPinchEmit: 0 };
          }}
          onResponderMove={(e) => {
            const g = gesture.current;
            if (!g) return;
            // second finger landed mid-tap/drag → convert to a pinch
            if (e.nativeEvent.touches.length >= 2 && pinchable) {
              if (g.mode !== 'pinch') {
                gesture.current = { mode: 'pinch', startPageY: 0, startPrice: 0, curPrice: 0, lastTickPrice: 0, pinchDist: touchDist(e.nativeEvent), lastPinchEmit: 0 };
                setPreview(null);
                onGesture?.(true);
                return;
              }
              const d = touchDist(e.nativeEvent);
              const scale = d / g.pinchDist;
              if (onPinch) {
                // continuous: cumulative scale from a fixed baseline, throttled
                // to ~30 Hz so the scene re-render keeps up with the fingers
                const now = Date.now();
                if (now - g.lastPinchEmit >= 33) {
                  g.lastPinchEmit = now;
                  onPinch(scale);
                }
              } else if (onZoomStep && (scale >= 1.18 || scale <= 1 / 1.18)) {
                onZoomStep(scale > 1 ? 1 : -1);
                g.pinchDist = d; // incremental: re-baseline after each step
                buzz(() => Haptics.selectionAsync());
              }
              return;
            }
            if (g.mode !== 'drag' || dragIndex === null || !onMarkMove) return;
            const dy = e.nativeEvent.pageY - g.startPageY;
            const price = Math.min(Math.max(g.startPrice - dy * (range / plotH), min), max);
            g.curPrice = price;
            setPreview({ y: yOf(price), price });
            const tick = Math.round(price);
            if (tick !== g.lastTickPrice) {
              g.lastTickPrice = tick;
              buzz(() => Haptics.selectionAsync()); // 1-pt detents make the drag feel mechanical
            }
          }}
          onResponderRelease={(e) => {
            const g = gesture.current;
            if (g?.mode === 'drag' && dragIndex !== null && onMarkMove) {
              onMarkMove(dragIndex, g.curPrice);
            } else if (g?.mode === 'tap' && onPricePress && Math.abs(e.nativeEvent.pageY - g.startPageY) <= 8) {
              onPricePress(priceOf(clampY(e.nativeEvent.locationY)));
            }
            endGesture();
          }}
          // never let the ScrollView steal an in-flight drag or pinch
          onResponderTerminationRequest={() => gesture.current?.mode === 'tap' || gesture.current === null}
          onResponderTerminate={endGesture}
        >
          <Scene
            bars={bars}
            outcome={outcome}
            levels={levels}
            clusters={clusters}
            vwapSeries={vwapSeries}
            marker={marker}
            userMarks={userMarks}
            hideMark={preview ? dragIndex : null}
            tradeLines={tradeLines}
            tradeMarkers={tradeMarkers}
            axisTags={axisTags}
            zones={zones}
            min={min}
            max={max}
            w={w}
            height={height}
            showTime={showTime}
            dragIndex={dragIndex}
          />
          {/* drag overlay: the live line + price chip, repainted alone at 60 Hz */}
          {preview && dragIndex !== null && (
            <>
              <View
                pointerEvents="none"
                style={{ position: 'absolute', left: mL, right: mR, top: preview.y - 5, height: 10, backgroundColor: C.info, opacity: 0.15 }}
              />
              <View
                pointerEvents="none"
                style={{ position: 'absolute', left: mL, right: mR, top: preview.y - 1.25, height: 2.5, backgroundColor: C.info }}
              />
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 6,
                  top: preview.y - 11,
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  borderRadius: 4,
                  backgroundColor: C.chipBg,
                  borderWidth: 1,
                  borderColor: C.info,
                }}
              >
                <Text style={{ color: C.info, fontSize: 10.5, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {userMarks[dragIndex]?.label ?? 'mark'} · {(Math.round(preview.price * 4) / 4).toFixed(2)}
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}
