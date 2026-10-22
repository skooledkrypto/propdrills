import type { PatternId, PatternProgress, Progress } from './types';
import { DAY_MS, LEITNER_INTERVALS_DAYS } from './config';
import { TRIGGERS } from './patterns';

/**
 * Leitner spaced repetition (brief §8).
 * Boxes 1..5; new/failed -> box 1; correct -> promote; wrong -> back to box 1.
 * Next-drill weight ∝ (1 - accuracy) + overdueFactor, with 'no'-setup
 * negatives held at a fixed share of the mix.
 */

export function emptyPatternProgress(): PatternProgress {
  return { seen: 0, correct: 0, streak: 0, lastSeenAt: 0, box: 0, dueAt: 0 };
}

export function ensureProgress(p: Progress, ids: PatternId[] = TRIGGERS): Progress {
  for (const id of ids) if (!p.perPattern[id]) p.perPattern[id] = emptyPatternProgress();
  if (!p.perPattern['no']) p.perPattern['no'] = emptyPatternProgress();
  return p;
}

/** Apply one answered drill to progress. Returns the updated per-pattern record. */
export function applyResult(
  p: Progress,
  patternId: PatternId,
  correct: boolean,
  now: number,
): PatternProgress {
  ensureProgress(p);
  const pp = p.perPattern[patternId];
  pp.seen++;
  if (correct) {
    pp.correct++;
    pp.streak++;
    pp.box = Math.min(pp.box === 0 ? 1 : pp.box + 1, 5);
  } else {
    pp.streak = 0;
    pp.box = 1;
  }
  pp.lastSeenAt = now;
  pp.dueAt = now + LEITNER_INTERVALS_DAYS[pp.box] * DAY_MS;
  return pp;
}

export function accuracy(pp: PatternProgress): number {
  return pp.seen ? pp.correct / pp.seen : 0;
}

/** 0 when not due; grows past due date (capped at 2). */
export function overdueFactor(pp: PatternProgress, now: number): number {
  if (pp.box === 0) return 1.5; // never seen: high priority
  if (now < pp.dueAt) return 0;
  const interval = Math.max(LEITNER_INTERVALS_DAYS[pp.box], 0.5) * DAY_MS;
  return Math.min((now - pp.dueAt) / interval, 2);
}

export function dueCount(p: Progress, now: number, ids: PatternId[] = TRIGGERS): number {
  ensureProgress(p, ids);
  return ids.filter((id) => {
    const pp = p.perPattern[id];
    return pp.box === 0 || now >= pp.dueAt;
  }).length;
}

export interface SamplerOptions {
  /** Share of 'no setup' negatives (0..1). */
  noSetupRate: number;
  /** Restrict to a single pattern (focus mode) — negatives still mixed in. */
  focus?: PatternId | null;
  /** Candidate trigger patterns (defaults to all). */
  pool?: PatternId[];
  rng?: () => number;
}

/** Pick the next drill's pattern. Focus mode bypasses scheduling (brief §8). */
export function nextPattern(p: Progress, now: number, opts: SamplerOptions): PatternId {
  const R = opts.rng ?? Math.random;
  if (R() < opts.noSetupRate) return 'no';
  if (opts.focus && opts.focus !== 'no') return opts.focus;
  const pool = opts.pool ?? TRIGGERS;
  ensureProgress(p, pool);
  const weights = pool.map((id) => {
    const pp = p.perPattern[id];
    return Math.max(1 - accuracy(pp), 0.05) + overdueFactor(pp, now);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = R() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
