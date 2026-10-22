import type { DrillInstance, PatternId } from '../core/types';
import type { EngineConfig } from '../core/config';
import { synthDrill } from '../core/synth';
import { toET } from '../core/sessions';
import { sampleInstance } from '../storage/db';

/** Session-filter predicate for a real instance, from its anchor timestamp. */
export function instancePassesFilter(inst: DrillInstance, cfg: EngineConfig): boolean {
  if (cfg.sessionFilter === 'any') return true;
  const anchor = inst.bars[inst.bars.length - 1];
  const p = toET(anchor.t);
  const m = p.hh * 60 + p.mm;
  switch (cfg.sessionFilter) {
    case 'rth':
      return inst.sessionTag === 'rth';
    case 'overnight':
      return inst.sessionTag === 'overnight';
    case 'evening': {
      if (inst.sessionTag !== 'overnight') return false;
      const sinceOpen = m >= 18 * 60 ? m - 18 * 60 : m + 24 * 60 - 18 * 60;
      return sinceOpen < cfg.eveningHours * 60;
    }
    default:
      return true;
  }
}

/**
 * Serve the next drill for a chosen pattern. Realistic mode samples the
 * detector library (session-filtered, flagged excluded) and falls back to
 * synthetic when the library has nothing for that pattern.
 */
export async function getDrill(
  patternId: PatternId,
  source: 'synthetic' | 'real',
  cfg: EngineConfig,
  difficulty: 'easy' | 'hard',
  exclude: Set<string>,
): Promise<DrillInstance> {
  if (source === 'real') {
    const inst = await sampleInstance(patternId, {
      exclude,
      sessionFilter: (i) => instancePassesFilter(i, cfg),
    });
    if (inst) return inst;
  }
  return synthDrill(patternId, { difficulty });
}
