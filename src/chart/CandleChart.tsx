import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Level, LevelCluster } from '../core/types';
import { chartPalette, levelColorsFor, useColorblind, useScheme } from '../ui/theme';

export interface UserMark {
  price: number;
  hit?: boolean | null; // null = unscored
  /** Short name shown on the chip, e.g. "PDH". Falls back to "your mark". */
  label?: string;
}

export interface TradeLine {
  price: number;
  kind: 'entry' | 'stop' | 'target' | 'fail' | 'goal';
  /** Chip text override, e.g. "entry +$120" or "⛔ liq". Defaults to the kind. */
  label?: string;
}

/** Entry/exit arrows for replayed trades, anchored to their bar time. */
export interface TradeMarker {
  t: number;
  kind: 'buy' | 'sell' | 'exit';
  win?: boolean;
}

interface Props {
  bars: Candle[];
  /** Faded continuation bars, drawn after reveal. */
  outcome?: Candle[];
  levels?: Level[];
  clusters?: LevelCluster[];
  vwapSeries?: { t: number; value: number }[];
  markers?: { t: number; bias: 'long' | 'short' | 'none' }[];
  userMarks?: UserMark[];
  /** Live position lines for Challenge Mode replay (entry/stop/target/fail/goal). */
  tradeLines?: TradeLine[];
  /** Entry/exit arrows for trades replayed so far. */
  tradeMarkers?: TradeMarker[];
  /** Extra prices the y-scale must include (e.g. drill targets off the candle range). */
  includePrices?: number[];
  height?: number;
  showTime?: boolean;
  onPriceClick?: (price: number) => void;
  /** Which userMarks entry may be dragged (the selected one); null = none. */
  dragIndex?: number | null;
  /** Fires live while the dragIndex mark is being dragged. */
  onMarkMove?: (index: number, price: number) => void;
}

const LEVEL_DASH: Record<string, LineStyle> = {
  PDH: LineStyle.Dashed,
  PDL: LineStyle.Dashed,
  PC: LineStyle.Dotted,
  ONH: LineStyle.Dashed,
  ONL: LineStyle.Dashed,
  R50: LineStyle.Dotted,
  R100: LineStyle.Dashed,
  VWAP: LineStyle.Solid,
  SWING: LineStyle.Dotted,
};

const ts = (ms: number) => (ms / 1000) as UTCTimestamp;

const tradeLineColor = (kind: TradeLine['kind'], pal: ReturnType<typeof chartPalette>): string =>
  kind === 'entry' ? pal.info : kind === 'stop' || kind === 'fail' ? pal.bad : kind === 'goal' ? pal.gold : pal.good;

// Axis and crosshair clocks in ET — the session timezone every level and rule
// in the app is defined in (lightweight-charts would otherwise render UTC).
const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const ET_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const ET_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' });

const tickMarkFormatter = (time: Time, type: TickMarkType): string => {
  const ms = (time as number) * 1000;
  if (type === TickMarkType.Year) return ET_YEAR.format(ms);
  if (type === TickMarkType.Month || type === TickMarkType.DayOfMonth) return ET_DAY.format(ms);
  return ET_TIME.format(ms);
};

/**
 * Level labels are rendered as our own chips pinned to the LEFT side of the
 * chart (lightweight-charts draws price-line titles at the right edge, where
 * they cover the newest candles — the exact bars being judged).
 */
interface LabelChip {
  key: string;
  y: number;
  text: string;
  color: string;
}

export function CandleChart({
  bars,
  outcome = [],
  levels = [],
  clusters = [],
  vwapSeries,
  markers = [],
  userMarks = [],
  tradeLines = [],
  tradeMarkers = [],
  includePrices = [],
  height = 380,
  showTime = true,
  onPriceClick,
  dragIndex = null,
  onMarkMove,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const clickRef = useRef(onPriceClick);
  clickRef.current = onPriceClick;
  const moveRef = useRef(onMarkMove);
  moveRef.current = onMarkMove;
  const userMarksRef = useRef(userMarks);
  userMarksRef.current = userMarks;
  const dragIndexRef = useRef(dragIndex);
  dragIndexRef.current = dragIndex;
  const scaleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [chips, setChips] = useState<LabelChip[]>([]);
  const scheme = useScheme();
  const colorblind = useColorblind();
  const pal = chartPalette(scheme, colorblind);
  const levelColor = levelColorsFor(pal);

  // Positions the left-side label chips against current price coordinates.
  // Stored in a ref so chart subscriptions always call the latest closure.
  const recomputeChipsRef = useRef<() => void>(() => {});
  recomputeChipsRef.current = () => {
    const series = seriesRef.current;
    const el = elRef.current;
    if (!series || !el) return;
    const h = el.clientHeight;
    const raw: Omit<LabelChip, 'key'>[] = [];
    for (const lv of levels) {
      const y = series.priceToCoordinate(lv.price);
      if (y !== null) raw.push({ y: y as number, text: lv.label, color: levelColor[lv.id] ?? levelColor.SWING });
    }
    for (const c of clusters) {
      const y = series.priceToCoordinate(c.price);
      if (y !== null) raw.push({ y: y as number, text: `★ confluence ×${c.members.length}`, color: pal.gold });
    }
    userMarks.forEach((m, i) => {
      const y = series.priceToCoordinate(m.price);
      if (y === null) return;
      const pendingMark = m.hit === undefined || m.hit === null;
      const name = m.label ?? 'your mark';
      raw.push({
        y: y as number,
        text: pendingMark ? (i === dragIndex ? `${name} ↕` : name) : m.hit ? `${name} ✓ hit` : `${name} ✗ miss`,
        color: pendingMark ? pal.info : m.hit ? pal.good : pal.bad,
      });
    });
    for (const tl of tradeLines) {
      const y = series.priceToCoordinate(tl.price);
      if (y !== null) {
        raw.push({ y: y as number, text: tl.label ?? tl.kind, color: tradeLineColor(tl.kind, pal) });
      }
    }
    raw.sort((a, b) => a.y - b.y);
    // drop chips whose level is outside the visible price range (a pinned chip
    // for an off-screen line is misleading), then nudge close ones apart
    let prevY = -Infinity;
    const placed: LabelChip[] = [];
    for (const r of raw) {
      if (r.y < 2 || r.y > h - 2) continue;
      let y = Math.min(Math.max(r.y, 9), h - 9);
      if (y - prevY < 15) y = prevY + 15;
      if (y > h - 7) continue;
      prevY = y;
      placed.push({ ...r, y, key: `${r.text}@${r.color}#${placed.length}` });
    }
    setChips((old) =>
      old.length === placed.length &&
      old.every((o, i) => o.y === placed[i].y && o.text === placed[i].text && o.color === placed[i].color)
        ? old
        : placed,
    );
  };

  // create once
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      // logo replaced by the TradingView attribution link in the app footer
      layout: { fontSize: 11, attributionLogo: false },
      timeScale: { timeVisible: true, secondsVisible: false, tickMarkFormatter },
      localization: {
        timeFormatter: (time: Time) => {
          const ms = (time as number) * 1000;
          return `${ET_DAY.format(ms)} ${ET_TIME.format(ms)} ET`;
        },
      },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addCandlestickSeries({ borderVisible: false });
    chart.subscribeClick((param) => {
      if (!param.point || !clickRef.current || !seriesRef.current) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (price !== null) clickRef.current(price as number);
    });
    // Drag-to-move the SELECTED user mark (dragIndex): capture-phase pointer
    // handlers so a grab near that line beats the chart's own pan handling.
    let dragIdx: number | null = null;
    const yFromEvent = (ev: PointerEvent) => ev.clientY - el.getBoundingClientRect().top;
    const canGrab = (y: number): boolean => {
      const s = seriesRef.current;
      const idx = dragIndexRef.current;
      if (!s || idx === null || !moveRef.current) return false;
      const m = userMarksRef.current[idx];
      if (!m) return false;
      const my = s.priceToCoordinate(m.price);
      return my !== null && Math.abs((my as number) - y) <= 12;
    };
    const onPointerDown = (ev: PointerEvent) => {
      if (!canGrab(yFromEvent(ev))) return;
      dragIdx = dragIndexRef.current;
      ev.preventDefault();
      ev.stopPropagation();
      el.setPointerCapture(ev.pointerId);
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (dragIdx === null) {
        el.style.cursor = canGrab(yFromEvent(ev)) ? 'ns-resize' : '';
        return;
      }
      const s = seriesRef.current;
      if (!s || !moveRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      const price = s.coordinateToPrice(yFromEvent(ev));
      if (price !== null) moveRef.current(dragIdx, price as number);
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (dragIdx !== null) ev.stopPropagation();
      dragIdx = null;
    };
    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove, true);
    el.addEventListener('pointerup', onPointerUp, true);
    // re-place label chips on pan/zoom and container resize
    const onRange = () => recomputeChipsRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const ro = new ResizeObserver(() => recomputeChipsRef.current());
    ro.observe(el);
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', onPointerUp, true);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      vwapRef.current = null;
      scaleRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // stretch the y-scale to include off-range prices via an invisible series
  // (price lines don't participate in autoscale)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (includePrices.length > 0 && bars.length > 1) {
      if (!scaleRef.current) {
        scaleRef.current = chart.addLineSeries({
          color: 'rgba(0,0,0,0)',
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      scaleRef.current.setData([
        { time: ts(bars[0].t), value: Math.min(...includePrices) },
        { time: ts(bars[bars.length - 1].t), value: Math.max(...includePrices) },
      ]);
    } else if (scaleRef.current) {
      scaleRef.current.setData([]);
    }
    requestAnimationFrame(() => recomputeChipsRef.current());
  }, [includePrices, bars]);

  // theme colors (initial + whenever the light/dark scheme flips)
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: pal.bg }, textColor: pal.text },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      timeScale: { borderColor: pal.border },
      rightPriceScale: { borderColor: pal.border },
    });
    series.applyOptions({
      upColor: pal.up,
      downColor: pal.down,
      wickUpColor: pal.up,
      wickDownColor: pal.down,
    });
    vwapRef.current?.applyOptions({ color: pal.vwap });
    requestAnimationFrame(() => recomputeChipsRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pal]);

  // data + markers
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const fadedUp = `${pal.up}73`;
    const fadedDn = `${pal.down}73`;
    const data = [
      ...bars.map((b) => ({ time: ts(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
      ...outcome.map((b) => {
        const up = b.c >= b.o;
        const col = up ? fadedUp : fadedDn;
        return {
          time: ts(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          color: col,
          wickColor: col,
          borderColor: col,
        };
      }),
    ];
    series.setData(data);
    const mk: SeriesMarker<Time>[] = [
      ...markers.map(
        (m): SeriesMarker<Time> => ({
          time: ts(m.t),
          position: m.bias === 'short' ? 'aboveBar' : 'belowBar',
          color: m.bias === 'long' ? pal.good : m.bias === 'short' ? pal.bad : pal.muted,
          shape: m.bias === 'long' ? 'arrowUp' : m.bias === 'short' ? 'arrowDown' : 'circle',
          text: m.bias === 'none' ? 'chop' : 'setup',
        }),
      ),
      // snap each trade to the last visible candle at-or-before its time —
      // on 5m/15m views the raw timestamp falls inside a bucket and a marker
      // with no matching bar time would be dropped by the chart
      ...tradeMarkers
        .map((m) => {
          let t = -1;
          for (const b of data) {
            if ((b.time as number) <= m.t / 1000) t = b.time as number;
            else break;
          }
          return t < 0 ? null : { ...m, t: t * 1000 };
        })
        .filter((m): m is TradeMarker => m !== null)
        .map(
          (m): SeriesMarker<Time> => ({
            time: ts(m.t),
            position: m.kind === 'sell' ? 'aboveBar' : 'belowBar',
            color: m.kind === 'buy' ? pal.good : m.kind === 'sell' ? pal.bad : m.win ? pal.good : pal.bad,
            shape: m.kind === 'buy' ? 'arrowUp' : m.kind === 'sell' ? 'arrowDown' : 'circle',
            text: m.kind === 'exit' ? 'exit' : m.kind,
          }),
        ),
    ].sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(mk);
    // Synthetic charts carry arbitrary timestamps — hide the whole time axis
    // rather than print a meaningless (and repeating) fake date under them.
    chart.timeScale().applyOptions({ visible: showTime, timeVisible: true });
    chart.timeScale().fitContent();
    requestAnimationFrame(() => recomputeChipsRef.current());
  }, [bars, outcome, markers, tradeMarkers, showTime, pal]);

  // level lines + user marks
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const pl of priceLinesRef.current) series.removePriceLine(pl);
    priceLinesRef.current = [];
    for (const lv of levels) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: lv.price,
          color: levelColor[lv.id] ?? levelColor.SWING,
          lineWidth: 1,
          lineStyle: LEVEL_DASH[lv.id] ?? LineStyle.Dotted,
          axisLabelVisible: true,
          title: '', // labels are our own left-side chips, not right-edge titles
        }),
      );
    }
    for (const c of clusters) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: c.price,
          color: pal.gold,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: '',
        }),
      );
    }
    for (const m of userMarks) {
      const color = m.hit === undefined || m.hit === null ? pal.info : m.hit ? pal.good : pal.bad;
      priceLinesRef.current.push(
        series.createPriceLine({
          price: m.price,
          color,
          lineWidth: 2,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: '',
        }),
      );
    }
    for (const tl of tradeLines) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: tl.price,
          color: tradeLineColor(tl.kind, pal),
          lineWidth: tl.kind === 'entry' ? 1 : 2,
          lineStyle: tl.kind === 'entry' || tl.kind === 'fail' ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        }),
      );
    }
    requestAnimationFrame(() => recomputeChipsRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, clusters, userMarks, tradeLines, pal]);

  // the selected-mark ↕ chip depends on dragIndex alone
  useEffect(() => {
    recomputeChipsRef.current();
  }, [dragIndex]);

  // vwap line
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (vwapSeries && vwapSeries.length) {
      if (!vwapRef.current) {
        vwapRef.current = chart.addLineSeries({
          color: pal.vwap,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      // clip to the visible window
      const minT = bars.length ? bars[0].t : 0;
      vwapRef.current.setData(
        vwapSeries.filter((p) => p.t >= minT).map((p) => ({ time: ts(p.t), value: p.value })),
      );
    } else if (vwapRef.current) {
      vwapRef.current.setData([]);
    }
  }, [vwapSeries, bars]);

  return (
    <div className="chart-wrap">
      <div ref={elRef} className="chart" style={{ height }} />
      <div className="chart-labels" aria-hidden="true">
        {chips.map((c) => (
          <span key={c.key} className="lvl-chip" style={{ top: c.y, color: c.color, borderColor: c.color }}>
            {c.text}
          </span>
        ))}
      </div>
    </div>
  );
}
