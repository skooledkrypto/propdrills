import type { Bias, Candle, DrillInstance, PatternId } from './types';
import type { EngineConfig } from './config';
import { computeLevels, isConfluent, nearestLevel, type PrecomputedSessions } from './levels';
import { overnightSessions, rthSessions, sessionInfo } from './sessions';

/**
 * Rule-based ground-truth labeler (brief §4.2). Scans historical OHLCV once,
 * maintaining the level state a disciplined trader would have had at each bar
 * (no lookahead, except where a label inherently needs it — the inside-bar
 * break direction). Emits DrillInstances with REAL forward outcomes.
 *
 * Philosophy: conservative tolerances, honest labels, and a flagging flow in
 * the UI — never tuning until everything "looks right".
 */

interface Candidate {
  patternId: PatternId;
  bias: Bias;
  anchorIdx: number;
  levelPrice: number | null;
  /** How many trailing bars to highlight as "the pattern". */
  hlSpan: number;
}

export function detect(
  bars: Candle[],
  cfg: EngineConfig,
  onProgress?: (frac: number) => void,
): DrillInstance[] {
  const n = bars.length;
  if (n < cfg.leadInBars + cfg.outcomeBars + 10) return [];
  const info = sessionInfo(bars);
  const pre: PrecomputedSessions = { rth: rthSessions(info), on: overnightSessions(info) };

  // rolling average bar range (volatility yardstick)
  const avgRange: number[] = new Array(n).fill(0);
  {
    let sum = 0;
    const W = 14;
    for (let i = 0; i < n; i++) {
      sum += bars[i].h - bars[i].l;
      if (i >= W) sum -= bars[i - W].h - bars[i - W].l;
      avgRange[i] = sum / Math.min(i + 1, W);
    }
  }

  // ---- rolling level state ----
  let rthPtr = -1;
  let pdh = NaN;
  let pdl = NaN;
  let pc = NaN;
  let onKey = 0;
  let onh = NaN;
  let onl = NaN;
  let vwapPV = 0;
  let vwapVol = 0;
  const vwapHist: number[] = new Array(n).fill(NaN);
  const openMin = cfg.vwapAnchor === 'rth' ? 570 : 1080;

  interface BrState {
    dir: 1 | -1;
    breakIdx: number;
  }
  const brStates = new Map<string, BrState>();
  const lastCloseSide = new Map<string, 1 | -1>();
  const lowTouch = new Map<string, number>();
  const highTouch = new Map<string, number>();

  interface Gap {
    top: number;
    bot: number;
    dir: 1 | -1;
    createdIdx: number;
  }
  let gaps: Gap[] = [];

  const candidates: Candidate[] = [];
  const lastEmit = new Map<string, number>();
  let lastAnyEmit = -Infinity;
  const perDayCount = new Map<string, number>();

  const tryEmit = (c: Candidate): boolean => {
    const last = lastEmit.get(c.patternId) ?? -Infinity;
    if (c.anchorIdx - last < cfg.dedupeGapBars) return false;
    const dayKey = `${c.patternId}|${info[c.anchorIdx].etDate}`;
    const dayN = perDayCount.get(dayKey) ?? 0;
    if (dayN >= cfg.maxPerPatternPerDay) return false;
    lastEmit.set(c.patternId, c.anchorIdx);
    lastAnyEmit = c.anchorIdx;
    perDayCount.set(dayKey, dayN + 1);
    candidates.push(c);
    return true;
  };

  const start = cfg.leadInBars;
  const endEx = n - cfg.outcomeBars;
  let lastNoIdx = -Infinity;
  let crossings = 0;
  let crossKey = '';

  for (let i = 1; i < endEx; i++) {
    if (onProgress && i % 20000 === 0) onProgress(i / endEx);
    const bi = info[i];
    const b = bars[i];
    const prev = bars[i - 1];

    // ---- maintain prior-RTH statics ----
    while (rthPtr + 1 < pre.rth.length && pre.rth[rthPtr + 1].to < i) {
      rthPtr++;
      const s = pre.rth[rthPtr];
      let hi = -Infinity;
      let lo = Infinity;
      for (let k = s.from; k <= s.to; k++) {
        hi = Math.max(hi, bars[k].h);
        lo = Math.min(lo, bars[k].l);
      }
      pdh = hi;
      pdl = lo;
      pc = bars[s.to].c;
    }

    // ---- maintain overnight extremes ----
    if (bi.tag === 'overnight') {
      if (bi.overnightKey !== onKey) {
        onKey = bi.overnightKey;
        onh = b.h;
        onl = b.l;
      } else {
        onh = Math.max(onh, b.h);
        onl = Math.min(onl, b.l);
      }
    }

    // ---- maintain VWAP ----
    const m = bi.etMinutes;
    const prevM = info[i - 1].etMinutes;
    if (m >= openMin && (prevM < openMin || prevM > m)) {
      vwapPV = 0;
      vwapVol = 0;
    }
    const tp = (b.h + b.l + b.c) / 3;
    const vv = b.v > 0 ? b.v : 1;
    vwapPV += tp * vv;
    vwapVol += vv;
    vwapHist[i] = vwapPV / vwapVol;

    if (i < start) continue;
    if (bi.tag === 'maintenance') continue;

    // ---- active static levels at this bar ----
    const active: { key: string; price: number }[] = [];
    if (!Number.isNaN(pdh)) {
      active.push({ key: 'PDH', price: pdh }, { key: 'PDL', price: pdl }, { key: 'PC', price: pc });
    }
    if (!Number.isNaN(onh)) {
      active.push({ key: 'ONH', price: onh }, { key: 'ONL', price: onl });
    }
    const r50 = Math.round(b.c / 50) * 50;
    active.push({ key: `R${r50}`, price: r50 });

    const body = Math.abs(b.c - b.o);
    const range = Math.max(b.h - b.l, 0.25);
    const ar = Math.max(avgRange[i], 0.75);
    const lowerWick = Math.min(b.o, b.c) - b.l;
    const upperWick = b.h - Math.max(b.o, b.c);
    let emitted = false;

    for (const lv of active) {
      if (emitted) break;
      const P = lv.price;

      // --- sweep: wick pierces the level, close reclaims the original side ---
      if (b.o > P && b.l < P - cfg.sweepPts && b.c > P + cfg.reclaimPts) {
        emitted = tryEmit({ patternId: 'sweep', bias: 'long', anchorIdx: i, levelPrice: P, hlSpan: 1 });
        if (emitted) break;
      }
      if (b.o < P && b.h > P + cfg.sweepPts && b.c < P - cfg.reclaimPts) {
        emitted = tryEmit({ patternId: 'sweep', bias: 'short', anchorIdx: i, levelPrice: P, hlSpan: 1 });
        if (emitted) break;
      }

      // --- engulfing at the level ---
      const prevRed = prev.c < prev.o;
      const prevGreen = prev.c > prev.o;
      if (
        prevRed &&
        b.c > b.o &&
        b.o <= prev.c &&
        b.c >= prev.o &&
        body >= 0.8 * ar &&
        Math.abs(Math.min(b.l, prev.l) - P) <= cfg.tol
      ) {
        emitted = tryEmit({ patternId: 'engulf', bias: 'long', anchorIdx: i, levelPrice: P, hlSpan: 2 });
        if (emitted) break;
      }
      if (
        prevGreen &&
        b.c < b.o &&
        b.o >= prev.c &&
        b.c <= prev.o &&
        body >= 0.8 * ar &&
        Math.abs(Math.max(b.h, prev.h) - P) <= cfg.tol
      ) {
        emitted = tryEmit({ patternId: 'engulf', bias: 'short', anchorIdx: i, levelPrice: P, hlSpan: 2 });
        if (emitted) break;
      }

      // --- pin bar rejecting the level ---
      if (
        lowerWick >= cfg.pinRatio * Math.max(body, 0.25) &&
        upperWick <= lowerWick * 0.5 &&
        Math.abs(b.l - P) <= cfg.tol &&
        b.c >= b.l + 0.66 * range &&
        range >= ar
      ) {
        emitted = tryEmit({ patternId: 'pin', bias: 'long', anchorIdx: i, levelPrice: P, hlSpan: 1 });
        if (emitted) break;
      }
      if (
        upperWick >= cfg.pinRatio * Math.max(body, 0.25) &&
        lowerWick <= upperWick * 0.5 &&
        Math.abs(b.h - P) <= cfg.tol &&
        b.c <= b.h - 0.66 * range &&
        range >= ar
      ) {
        emitted = tryEmit({ patternId: 'pin', bias: 'short', anchorIdx: i, levelPrice: P, hlSpan: 1 });
        if (emitted) break;
      }

      // --- break & retest state machine ---
      const side: 1 | -1 = b.c > P ? 1 : -1;
      const prevSide = lastCloseSide.get(lv.key);
      if (prevSide !== undefined && side !== prevSide) {
        if (side === 1 && b.c > P + cfg.reclaimPts) brStates.set(lv.key, { dir: 1, breakIdx: i });
        if (side === -1 && b.c < P - cfg.reclaimPts) brStates.set(lv.key, { dir: -1, breakIdx: i });
      }
      lastCloseSide.set(lv.key, side);
      const st = brStates.get(lv.key);
      if (st && i - st.breakIdx >= 3 && i - st.breakIdx <= cfg.brWindow) {
        if (
          st.dir === 1 &&
          b.l <= P + cfg.tol &&
          b.l >= P - cfg.tol / 2 &&
          b.c > P + cfg.reclaimPts &&
          b.c > b.o
        ) {
          emitted = tryEmit({ patternId: 'br', bias: 'long', anchorIdx: i, levelPrice: P, hlSpan: 3 });
          brStates.delete(lv.key);
          if (emitted) break;
        }
        if (
          st.dir === -1 &&
          b.h >= P - cfg.tol &&
          b.h <= P + cfg.tol / 2 &&
          b.c < P - cfg.reclaimPts &&
          b.c < b.o
        ) {
          emitted = tryEmit({ patternId: 'br', bias: 'short', anchorIdx: i, levelPrice: P, hlSpan: 3 });
          brStates.delete(lv.key);
          if (emitted) break;
        }
      }
      if (st && (i - st.breakIdx > cfg.brWindow || (st.dir === 1 ? b.c < P - cfg.tol : b.c > P + cfg.tol))) {
        brStates.delete(lv.key);
      }

      // --- double bottom / top ---
      if (Math.abs(b.l - P) <= cfg.tol) {
        const prevT = lowTouch.get(lv.key);
        if (
          prevT !== undefined &&
          i - prevT >= cfg.doubleMinBars &&
          i - prevT <= cfg.doubleMaxBars &&
          b.c >= b.l + 0.5 * range &&
          b.c > b.o
        ) {
          let bounced = false;
          let brokeDown = false;
          for (let k = prevT + 1; k < i; k++) {
            if (bars[k].c > P + 2 * cfg.tol) bounced = true;
            if (bars[k].c < P - cfg.tol) brokeDown = true;
          }
          if (bounced && !brokeDown) {
            emitted = tryEmit({
              patternId: 'double',
              bias: 'long',
              anchorIdx: i,
              levelPrice: P,
              hlSpan: Math.min(i - prevT + 1, cfg.leadInBars - 2),
            });
          }
        }
        lowTouch.set(lv.key, i);
        if (emitted) break;
      }
      if (Math.abs(b.h - P) <= cfg.tol) {
        const prevT = highTouch.get(lv.key);
        if (
          prevT !== undefined &&
          i - prevT >= cfg.doubleMinBars &&
          i - prevT <= cfg.doubleMaxBars &&
          b.c <= b.h - 0.5 * range &&
          b.c < b.o
        ) {
          let bounced = false;
          let brokeUp = false;
          for (let k = prevT + 1; k < i; k++) {
            if (bars[k].c < P - 2 * cfg.tol) bounced = true;
            if (bars[k].c > P + cfg.tol) brokeUp = true;
          }
          if (bounced && !brokeUp) {
            emitted = tryEmit({
              patternId: 'double',
              bias: 'short',
              anchorIdx: i,
              levelPrice: P,
              hlSpan: Math.min(i - prevT + 1, cfg.leadInBars - 2),
            });
          }
        }
        highTouch.set(lv.key, i);
        if (emitted) break;
      }

      // --- inside bar compressing against the level ---
      if (
        !emitted &&
        b.h < prev.h &&
        b.l > prev.l &&
        prev.h - prev.l >= 1.5 * ar &&
        (Math.abs(prev.l - P) <= cfg.tol || Math.abs(prev.h - P) <= cfg.tol)
      ) {
        let dir: Bias | null = null;
        for (let k = i + 1; k <= Math.min(i + cfg.insideBreakWindow, endEx - 1); k++) {
          if (bars[k].c > prev.h) {
            dir = 'long';
            break;
          }
          if (bars[k].c < prev.l) {
            dir = 'short';
            break;
          }
        }
        if (dir) {
          emitted = tryEmit({ patternId: 'inside', bias: dir, anchorIdx: i, levelPrice: P, hlSpan: 2 });
          if (emitted) break;
        }
      }
    }

    // --- vwap bounce (first touch in a one-sided trend) ---
    const vw = vwapHist[i];
    if (!emitted && !Number.isNaN(vw) && i - cfg.vwapTrendBars >= 0) {
      let above = true;
      let below = true;
      let touched = false;
      for (let k = i - cfg.vwapTrendBars; k < i; k++) {
        const kv = vwapHist[k];
        if (Number.isNaN(kv)) {
          above = below = false;
          break;
        }
        if (bars[k].c <= kv) above = false;
        if (bars[k].c >= kv) below = false;
        if (bars[k].l <= kv + cfg.tol / 2 && bars[k].h >= kv - cfg.tol / 2) touched = true;
      }
      if (above && !touched && b.l <= vw + cfg.tol / 2 && b.c > vw && b.c > b.o) {
        emitted = tryEmit({ patternId: 'vwap_bounce', bias: 'long', anchorIdx: i, levelPrice: vw, hlSpan: 1 });
      } else if (below && !touched && b.h >= vw - cfg.tol / 2 && b.c < vw && b.c < b.o) {
        emitted = tryEmit({ patternId: 'vwap_bounce', bias: 'short', anchorIdx: i, levelPrice: vw, hlSpan: 1 });
      }
    }

    // --- fair value gaps: creation, retest, invalidation ---
    if (i >= 2) {
      const c1 = bars[i - 2];
      const mid = bars[i - 1];
      const midBody = Math.abs(mid.c - mid.o);
      if (c1.h < b.l && midBody >= 1.5 * ar && mid.c > mid.o) {
        gaps.push({ bot: c1.h, top: b.l, dir: 1, createdIdx: i });
      }
      if (c1.l > b.h && midBody >= 1.5 * ar && mid.c < mid.o) {
        gaps.push({ bot: b.h, top: c1.l, dir: -1, createdIdx: i });
      }
    }
    if (gaps.length) {
      const kept: Gap[] = [];
      for (const g of gaps) {
        if (i - g.createdIdx > cfg.fvgWindow) continue;
        if (g.createdIdx === i) {
          kept.push(g);
          continue;
        }
        if (g.dir === 1) {
          if (b.c < g.bot) continue; // invalidated
          if (!emitted && b.l <= g.top && b.l >= g.bot - cfg.tol / 2 && b.c > g.top && b.c > b.o) {
            emitted = tryEmit({
              patternId: 'fvg',
              bias: 'long',
              anchorIdx: i,
              levelPrice: (g.top + g.bot) / 2,
              hlSpan: 1,
            });
            continue; // consumed
          }
        } else {
          if (b.c > g.top) continue;
          if (!emitted && b.h >= g.bot && b.h <= g.top + cfg.tol / 2 && b.c < g.bot && b.c < b.o) {
            emitted = tryEmit({
              patternId: 'fvg',
              bias: 'short',
              anchorIdx: i,
              levelPrice: (g.top + g.bot) / 2,
              hlSpan: 1,
            });
            continue;
          }
        }
        kept.push(g);
      }
      gaps = kept;
    }

    // --- 'no setup' negatives: chop across a level, nothing qualifying nearby ---
    if (!emitted && active.length) {
      let nearest = active[0];
      for (const lv of active) {
        if (Math.abs(lv.price - b.c) < Math.abs(nearest.price - b.c)) nearest = lv;
      }
      if (nearest.key !== crossKey) {
        crossKey = nearest.key;
        crossings = 0;
      }
      if (Math.abs(nearest.price - b.c) <= cfg.tol * 2) {
        const sPrev = prev.c > nearest.price ? 1 : -1;
        const sCur = b.c > nearest.price ? 1 : -1;
        if (sPrev !== sCur && body <= 0.6 * ar) crossings++;
      }
      if (
        crossings >= 4 &&
        i - lastNoIdx >= 60 &&
        i - lastAnyEmit >= cfg.dedupeGapBars &&
        body <= 0.6 * ar
      ) {
        if (tryEmit({ patternId: 'no', bias: 'none', anchorIdx: i, levelPrice: nearest.price, hlSpan: 6 })) {
          lastNoIdx = i;
          crossings = 0;
        }
      }
    }
  }

  // ---- materialize instances ----
  const out: DrillInstance[] = [];
  for (let ci = 0; ci < candidates.length; ci++) {
    const c = candidates[ci];
    if (onProgress && ci % 200 === 0) onProgress(0.9 + 0.1 * (ci / candidates.length));
    const a = c.anchorIdx;
    const view = bars.slice(a - cfg.leadInBars, a + 1);
    const outcome = bars.slice(a + 1, a + 1 + cfg.outcomeBars);
    const levelSet = computeLevels(bars, info, a, cfg, pre);
    let levelHit =
      c.levelPrice !== null ? nearestLevel(levelSet, c.levelPrice, cfg.tol * 1.5) : null;
    if (!levelHit && c.levelPrice !== null) {
      levelHit = {
        id: 'SWING',
        price: c.levelPrice,
        label: c.patternId === 'fvg' ? `FVG zone ${c.levelPrice.toFixed(0)}` : `level ${c.levelPrice.toFixed(0)}`,
      };
    }
    const dir = c.bias === 'long' ? 1 : c.bias === 'short' ? -1 : 0;
    const realizedMove =
      dir === 0 || !outcome.length ? 0 : (outcome[outcome.length - 1].c - bars[a].c) * dir;
    out.push({
      id: `real-${c.patternId}-${bars[a].t}`,
      patternId: c.patternId,
      bias: c.bias,
      bars: view,
      outcomeBars: outcome,
      hl: [view.length - c.hlSpan, view.length - 1],
      levelSet,
      levelHit,
      confluent: levelHit ? isConfluent(levelSet, levelHit.price, cfg.confluenceTol) : false,
      source: 'real',
      realizedMove,
      sessionTag: info[a].tag,
    });
  }
  if (onProgress) onProgress(1);
  return out;
}
