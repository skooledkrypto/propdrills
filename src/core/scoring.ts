import type { Attempt, PatternId } from './types';

export interface PatternStats {
  patternId: PatternId;
  seen: number;
  correct: number;
  accuracy: number;
}

export function perPatternStats(attempts: Attempt[]): PatternStats[] {
  const map = new Map<PatternId, { seen: number; correct: number }>();
  for (const a of attempts) {
    const s = map.get(a.patternId) ?? { seen: 0, correct: 0 };
    s.seen++;
    if (a.correct) s.correct++;
    map.set(a.patternId, s);
  }
  return [...map.entries()].map(([patternId, s]) => ({
    patternId,
    seen: s.seen,
    correct: s.correct,
    accuracy: s.seen ? s.correct / s.seen : 0,
  }));
}

export interface TrendPoint {
  /** yyyy-mm-dd (local) */
  day: string;
  seen: number;
  correct: number;
  accuracy: number;
}

/** Daily accuracy trend, optionally for a single pattern. */
export function accuracyTrend(attempts: Attempt[], patternId?: PatternId): TrendPoint[] {
  const byDay = new Map<string, { seen: number; correct: number }>();
  for (const a of attempts) {
    if (patternId && a.patternId !== patternId) continue;
    const d = new Date(a.t);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const s = byDay.get(day) ?? { seen: 0, correct: 0 };
    s.seen++;
    if (a.correct) s.correct++;
    byDay.set(day, s);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, s]) => ({ day, ...s, accuracy: s.seen ? s.correct / s.seen : 0 }));
}

/**
 * Expectancy of the user's *called* setups on real data: average realized
 * forward move (in points) across real-mode attempts where they called a
 * setup. Illustrative/historical — never a prediction.
 */
export function calledSetupExpectancy(attempts: Attempt[]): { n: number; avgMove: number } {
  const calls = attempts.filter(
    (a) => a.source === 'real' && a.realizedMove !== undefined && a.patternId !== 'no',
  );
  if (!calls.length) return { n: 0, avgMove: 0 };
  return {
    n: calls.length,
    avgMove: calls.reduce((s, a) => s + (a.realizedMove ?? 0), 0) / calls.length,
  };
}
