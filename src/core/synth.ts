import type { Bias, Candle, DrillInstance, LevelId, LevelSet, PatternId } from './types';

/**
 * Synthetic chart generation, ported from v1 (`setup-trainer.html`) and extended
 * with vwap_bounce + fvg builders and a multi-day 1-min sample-series generator.
 * This is the "Fundamentals" rung; real data is the harder rung on top.
 */

export type Rng = () => number;

export function mulberry32(a: number): Rng {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const L = 21500; // the synthetic level — everything forms here (v1 convention)

interface Scn {
  candles: Omit<Candle, 't' | 'v'>[];
  hl: [number, number];
  bias: Bias;
  id: PatternId;
}

function C(o: number, h: number, l: number, c: number): Omit<Candle, 't' | 'v'> {
  return { o, h, l, c };
}

function rnd(R: Rng, a: number, b: number): number {
  return a + R() * (b - a);
}

function leadIn(R: Rng, n: number, startP: number, endP: number, vol = 9) {
  const arr: Omit<Candle, 't' | 'v'>[] = [];
  let prev = startP;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n;
    const target = startP + (endP - startP) * t;
    const o = prev;
    const cl = target + rnd(R, -vol, vol);
    const hi = Math.max(o, cl) + rnd(R, 2, vol);
    const lo = Math.min(o, cl) - rnd(R, 2, vol);
    arr.push(C(o, hi, lo, cl));
    prev = cl;
  }
  return arr;
}

/* ---------- pattern builders (bullish base; mirror() makes the bearish twin) ---------- */

function buildSweep(R: Rng): Scn {
  const lead = leadIn(R, 13, L + 135, L + 18);
  const c1 = C(L + 18, L + 22, L + 4, L + 8);
  const c2 = C(L + 9, L + 29, L - 22, L + 26); // spike below L, close back above
  const cs = [...lead, c1, c2];
  return { candles: cs, hl: [cs.length - 1, cs.length - 1], bias: 'long', id: 'sweep' };
}

function buildPin(R: Rng): Scn {
  const lead = leadIn(R, 13, L + 135, L + 20);
  const c1 = C(L + 20, L + 24, L + 8, L + 12);
  const pin = C(L + 21, L + 28, L - 14, L + 25); // small body up top, long lower wick under L
  const cs = [...lead, c1, pin];
  return { candles: cs, hl: [cs.length - 1, cs.length - 1], bias: 'long', id: 'pin' };
}

function buildEngulf(R: Rng): Scn {
  const lead = leadIn(R, 12, L + 135, L + 22);
  const down = C(L + 22, L + 25, L + 5, L + 9);
  const up = C(L + 6, L + 33, L + 3, L + 30); // green body engulfs the red body
  const cs = [...lead, down, up];
  return { candles: cs, hl: [cs.length - 2, cs.length - 1], bias: 'long', id: 'engulf' };
}

function buildInside(R: Rng): Scn {
  const lead = leadIn(R, 12, L + 120, L + 8);
  const big = C(L + 6, L + 50, L + 2, L + 46);
  const ins = C(L + 34, L + 40, L + 20, L + 26); // coil within big's range
  const cs = [...lead, big, ins];
  return { candles: cs, hl: [cs.length - 1, cs.length - 1], bias: 'long', id: 'inside' };
}

function buildBR(R: Rng): Scn {
  const lead = leadIn(R, 12, L - 115, L - 12);
  const brk = C(L - 10, L + 28, L - 12, L + 24);
  const rt1 = C(L + 22, L + 24, L + 2, L + 6);
  const rt2 = C(L + 7, L + 23, L + 3, L + 20);
  const cs = [...lead, brk, rt1, rt2];
  return { candles: cs, hl: [cs.length - 2, cs.length - 1], bias: 'long', id: 'br' };
}

function buildDouble(R: Rng): Scn {
  const lead = leadIn(R, 9, L + 120, L + 8);
  const t1 = C(L + 8, L + 19, L - 4, L + 16);
  const u1 = C(L + 16, L + 37, L + 13, L + 34);
  const u2 = C(L + 34, L + 38, L + 26, L + 30);
  const d1 = C(L + 30, L + 32, L + 10, L + 14);
  const t2 = C(L + 14, L + 23, L - 3, L + 20); // second touch holds
  const cs = [...lead, t1, u1, u2, d1, t2];
  return { candles: cs, hl: [cs.length - 5, cs.length - 1], bias: 'long', id: 'double' };
}

function buildVwapBounce(R: Rng): Scn {
  // Uptrend riding above VWAP (drawn as the level), first pullback tags it and rejects.
  const lead = leadIn(R, 11, L - 140, L + 55, 7);
  const p1 = C(L + 52, L + 56, L + 28, L + 32); // pullback toward vwap
  const p2 = C(L + 32, L + 34, L + 8, L + 14);
  const tag = C(L + 14, L + 26, L - 6, L + 24); // touch of vwap, rejection close back up
  const cs = [...lead, p1, p2, tag];
  return { candles: cs, hl: [cs.length - 1, cs.length - 1], bias: 'long', id: 'vwap_bounce' };
}

function buildFvg(R: Rng): Scn {
  // Displacement leaves a gap (a.h < c.l); later pullback into the gap zone rejects.
  const lead = leadIn(R, 9, L - 60, L - 30, 6);
  const a = C(L - 30, L - 18, L - 38, L - 22);
  const b = C(L - 22, L + 55, L - 24, L + 50); // displacement
  const cGap = C(L + 50, L + 68, L + 6, L + 60); // gap zone = (a.h=L-18 ... cGap.l=L+6)
  const d1 = C(L + 60, L + 62, L + 34, L + 38);
  const d2 = C(L + 38, L + 40, L + 12, L + 16); // drifts back into the gap
  const rej = C(L + 16, L + 42, L - 12, L + 38); // rejects from inside the gap
  const cs = [...lead, a, b, cGap, d1, d2, rej];
  return { candles: cs, hl: [cs.length - 1, cs.length - 1], bias: 'long', id: 'fvg' };
}

function buildNo(R: Rng): Scn {
  const lead = leadIn(R, 12, L + 80, L + 2, 7);
  const chop = [
    C(L + 2, L + 6, L - 8, L - 4),
    C(L - 4, L + 7, L - 7, L + 3),
    C(L + 3, L + 6, L - 6, L - 2),
    C(L - 2, L + 5, L - 5, L + 2),
  ];
  const cs = [...lead, ...chop];
  return { candles: cs, hl: [cs.length - 4, cs.length - 1], bias: 'none', id: 'no' };
}

export const BUILDERS: Record<PatternId, (R: Rng) => Scn> = {
  sweep: buildSweep,
  pin: buildPin,
  engulf: buildEngulf,
  inside: buildInside,
  br: buildBR,
  double: buildDouble,
  vwap_bounce: buildVwapBounce,
  fvg: buildFvg,
  no: buildNo,
};

export function mirror(scn: Scn): Scn {
  const cs = scn.candles.map((k) => C(2 * L - k.o, 2 * L - k.l, 2 * L - k.h, 2 * L - k.c));
  return {
    candles: cs,
    hl: [scn.hl[0], scn.hl[1]],
    bias: scn.bias === 'long' ? 'short' : scn.bias === 'short' ? 'long' : 'none',
    id: scn.id,
  };
}

export function continuation(
  R: Rng,
  lastClose: number,
  bias: Bias,
  n = 6,
  vol = 7,
): Omit<Candle, 't' | 'v'>[] {
  const dir = bias === 'long' ? 1 : bias === 'short' ? -1 : 0;
  const arr: Omit<Candle, 't' | 'v'>[] = [];
  let prev = lastClose;
  for (let i = 0; i < n; i++) {
    const o = prev;
    const cl = o + dir * rnd(R, 7, 17) + rnd(R, -vol, vol);
    const hi = Math.max(o, cl) + rnd(R, 2, vol);
    const lo = Math.min(o, cl) - rnd(R, 2, vol);
    arr.push(C(o, hi, lo, cl));
    prev = cl;
  }
  return arr;
}

const SYNTH_LEVEL_IDS: LevelId[] = ['PDH', 'PDL', 'ONH', 'ONL', 'PC', 'R100'];

/** Wrap a builder scenario into a full DrillInstance (fake timestamps + volume). */
export function synthDrill(
  patternId: PatternId,
  opts: { difficulty: 'easy' | 'hard'; rng?: Rng; allowMirror?: boolean },
): DrillInstance {
  const R = opts.rng ?? Math.random;
  let scn = BUILDERS[patternId](R);
  if (patternId !== 'no' && (opts.allowMirror ?? true) && R() < 0.5) scn = mirror(scn);
  const outcome = continuation(
    R,
    scn.candles[scn.candles.length - 1].c,
    scn.bias,
    6,
    opts.difficulty === 'hard' ? 9 : 5,
  );
  const baseT = Date.UTC(2026, 0, 6, 1, 0, 0); // arbitrary; synthetic charts don't show clock time
  const stamp = (cs: Omit<Candle, 't' | 'v'>[], offset: number): Candle[] =>
    cs.map((k, i) => ({ ...k, t: baseT + (offset + i) * 60000, v: Math.round(rnd(R, 300, 1600)) }));
  const bars = stamp(scn.candles, 0);
  const outcomeBars = stamp(outcome, scn.candles.length);
  // FVG anchors to its own gap zone rather than a session level.
  const levelId: LevelId =
    patternId === 'fvg' ? 'SWING' : SYNTH_LEVEL_IDS[Math.floor(R() * SYNTH_LEVEL_IDS.length)];
  const isVwap = patternId === 'vwap_bounce';
  const levelLabel = isVwap ? 'VWAP' : patternId === 'fvg' ? 'FVG zone' : levelId;
  const level = {
    id: isVwap ? ('VWAP' as LevelId) : levelId,
    price: L,
    label: `${levelLabel} ${L}`,
  };
  const levelSet: LevelSet = { levels: [level], clusters: [], vwap: isVwap ? L : null };
  return {
    id: `synth-${patternId}-${Math.floor(R() * 1e9)}`,
    patternId,
    bias: scn.bias,
    bars,
    outcomeBars,
    hl: scn.hl,
    levelSet,
    levelHit: patternId === 'no' ? null : level,
    confluent: false,
    source: 'synthetic',
  };
}

/* ---------------------------------------------------------------------------
 * Multi-day synthetic 1-min series with REAL timestamps and CME session hours.
 * Lets the whole real-data pipeline (sessions -> levels -> detector -> drills)
 * run out of the box with zero licensing concerns.
 * ------------------------------------------------------------------------- */

function tradingMinute(utcMs: number, toET: (ms: number) => { y: number; mo: number; d: number; hh: number; mm: number }): boolean {
  const p = toET(utcMs);
  const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay(); // ET calendar weekday
  const m = p.hh * 60 + p.mm;
  if (wd === 6) return false; // Saturday
  if (wd === 5 && m >= 17 * 60) return false; // after Friday close
  if (wd === 0 && m < 18 * 60) return false; // before Sunday reopen
  if (m >= 17 * 60 && m < 18 * 60) return false; // daily maintenance
  return true;
}

/**
 * Volatility multiplier by ET minute-of-day, calibrated against Databento MNQ
 * 1-min stats (Feb–Jul 2025): quiet 00–02h, Europe-open bump, pre-market ramp,
 * 9:30 surge, lunch lull, close pickup, 18:00 reopen blip.
 */
function volProfile(m: number): number {
  if (m >= 570 && m < 960) {
    if (m < 675) return 3.4; // 9:30–11:15 open surge
    if (m < 900) return 2.35; // lunch / early afternoon
    return 2.8; // 15:00–16:00 close
  }
  if (m >= 480 && m < 570) return 2.0; // pre-market ramp
  if (m >= 960 && m < 1020) return 1.4; // 16:00–17:00 settlement drift
  if (m >= 1080 && m < 1200) return 1.5; // 18:00 reopen
  if (m >= 1200 || m < 120) return m >= 1200 ? 1.1 : 0.85; // evening taper / dead zone
  if (m >= 120 && m < 300) return 1.55; // Europe open
  return 1.35; // 5:00–8:00
}

export function generateSampleSeries(
  nCalendarDays: number,
  seed: number,
  toET: (ms: number) => { y: number; mo: number; d: number; hh: number; mm: number },
): Candle[] {
  const R = mulberry32(seed);
  const tick = (x: number) => Math.round(x * 4) / 4;
  // Start on a Monday 18:00 ET (2026-06-01 was a Monday; 18:00 EDT = 22:00 UTC).
  const start = Date.UTC(2026, 5, 1, 22, 0, 0);
  const end = start + nCalendarDays * 24 * 60 * 60 * 1000;
  const bars: Candle[] = [];
  const BASE = 4.8; // 1-min vol unit before the session multiplier
  let price = 21500;

  // day regime, rolled at each 18:00 ET reopen
  let dayType: 'trend' | 'range' | 'spike' = 'range';
  let drift = 0;
  let rangeAnchor = price;
  let spikeMinute = -1;

  // level bookkeeping so the walk interacts with the same levels the app draws
  let inRth = false;
  let curRthHi = -Infinity;
  let curRthLo = Infinity;
  let pdh = NaN;
  let pdl = NaN;
  let pc = NaN;
  let onh = -Infinity;
  let onl = Infinity;

  let impulse = 0;
  let barIdx = 0;
  let started = false;
  const lastDecision = new Map<string, number>(); // level key -> bar index of last reject/accept call

  for (let t = start; t < end; t += 60000) {
    if (!tradingMinute(t, toET)) continue;
    const p = toET(t);
    const m = p.hh * 60 + p.mm;
    const isRTH = m >= 570 && m < 960;

    if (!started || m === 1080) {
      started = true;
      const r = R();
      dayType = r < 0.42 ? 'trend' : r < 0.85 ? 'range' : 'spike';
      drift = (R() < 0.5 ? -1 : 1) * rnd(R, 0.1, 0.3);
      rangeAnchor = price;
      spikeMinute = 585 + Math.floor(R() * 350); // some RTH minute
      onh = -Infinity;
      onl = Infinity;
    }
    if (isRTH && !inRth) {
      inRth = true;
      curRthHi = -Infinity;
      curRthLo = Infinity;
    }
    if (!isRTH && inRth) {
      inRth = false;
      pdh = curRthHi;
      pdl = curRthLo;
      pc = bars.length ? bars[bars.length - 1].c : price;
    }

    const mult = volProfile(m);
    const vol = BASE * mult;
    let step = (R() - 0.5) * 2 * vol;
    if (R() < 0.06) step *= 1.8 + R() * 2.2; // fat tails
    if (dayType === 'trend') step += drift * mult;
    if (dayType === 'range') step -= (price - rangeAnchor) * 0.004 * mult;
    if (dayType === 'spike' && isRTH && m === spikeMinute) {
      impulse = (R() < 0.5 ? 1 : -1) * rnd(R, 35, 75); // news burst
    }

    // active levels: prior-day statics, overnight extremes (during RTH), round 50s
    const levels: [string, number][] = [['R', Math.round(price / 50) * 50]];
    if (!Number.isNaN(pdh)) levels.push(['PDH', pdh], ['PDL', pdl], ['PC', pc]);
    if (isRTH && onh > -Infinity) levels.push(['ONH', onh], ['ONL', onl]);

    let nearLevel: number | null = null;
    let nearDist = Infinity;
    for (const [key, L] of levels) {
      const d = price - L;
      const ad = Math.abs(d);
      if (ad < nearDist) {
        nearDist = ad;
        nearLevel = L;
      }
      if (ad < 2.5 * vol) step -= d * 0.05; // magnetism: levels attract price
      // reject-or-accept: decide once per approach when the close would cross the level
      const crossed = (price - L) * (price + step - L) < 0;
      if (crossed && barIdx - (lastDecision.get(key) ?? -1e9) > 25) {
        lastDecision.set(key, barIdx);
        const away = Math.sign(d) || (R() < 0.5 ? -1 : 1);
        if (R() < 0.62) {
          impulse = away * vol * rnd(R, 1.2, 3.0); // rejection: snap back to the original side
        } else {
          impulse = -away * vol * rnd(R, 0.8, 2.0); // acceptance: break through (magnet gives the retest)
        }
      }
    }

    step += impulse * 0.45;
    if (impulse !== 0) {
      impulse *= 0.55;
      if (Math.abs(impulse) < 1) impulse = 0;
    }

    const o = tick(price);
    const c = tick(price + step);
    let wickUp = R() * vol * 0.45 + 0.25;
    let wickDn = R() * vol * 0.45 + 0.25;
    // occasional long probe wick; near a level it aims AT the level (stop-run anatomy)
    if (R() < 0.1) {
      const big = vol * rnd(R, 1.0, 2.6);
      if (nearLevel !== null && nearDist < 2 * vol) {
        if (nearLevel <= Math.min(o, c)) wickDn += big;
        else if (nearLevel >= Math.max(o, c)) wickUp += big;
        else if (R() < 0.5) wickUp += big;
        else wickDn += big;
      } else if (R() < 0.5) wickUp += big;
      else wickDn += big;
    }
    const h = tick(Math.max(o, c) + wickUp);
    const l = tick(Math.min(o, c) - wickDn);
    const v = Math.round((isRTH ? 350 * mult * mult : 300 * mult) * (0.6 + 0.8 * R()));
    bars.push({ t, o, h, l, c, v });
    price = c;
    barIdx++;
    if (isRTH) {
      curRthHi = Math.max(curRthHi, h);
      curRthLo = Math.min(curRthLo, l);
    } else if (m >= 1080 || m < 570) {
      onh = Math.max(onh, h);
      onl = Math.min(onl, l);
    }
  }
  return bars;
}
