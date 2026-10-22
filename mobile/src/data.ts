import {
  detect,
  generateSampleSeries,
  sessionInfo,
  synthDrill,
  toET,
  type BarSessionInfo,
  type Candle,
  type DrillInstance,
  type EngineConfig,
  type PatternId,
} from './core';

/**
 * On-device dataset service. Per the product owner's call, the phone app
 * drills on GENERATED MNQ-like data (real CME session structure, plausible
 * volatility, stop-run behaviour around prior-day levels) — zero licensing
 * exposure, and the full levels->detector->outcomes pipeline still runs for
 * real: the "Realistic" tier uses detector-labeled instances with actual
 * forward bars from the generated series.
 */

export interface Dataset {
  bars: Candle[];
  info: BarSessionInfo[];
  instances: DrillInstance[];
  byPattern: Map<string, DrillInstance[]>;
}

const DATASET_DAYS = 30;
const DATASET_SEED = 20260731;

let cache: Dataset | null = null;
let building: Promise<Dataset> | null = null;

export function getDataset(cfg: EngineConfig): Promise<Dataset> {
  if (cache) return Promise.resolve(cache);
  if (!building) {
    building = new Promise<Dataset>((resolve) => {
      // yield a frame so spinners can paint before the scan blocks the JS thread
      setTimeout(() => {
        const bars = generateSampleSeries(DATASET_DAYS, DATASET_SEED, toET);
        const info = sessionInfo(bars);
        const instances = detect(bars, cfg);
        const byPattern = new Map<string, DrillInstance[]>();
        for (const inst of instances) {
          const arr = byPattern.get(inst.patternId) ?? [];
          arr.push(inst);
          byPattern.set(inst.patternId, arr);
        }
        cache = { bars, info, instances, byPattern };
        resolve(cache);
      }, 50);
    });
  }
  return building;
}

function passesFilter(inst: DrillInstance, cfg: EngineConfig): boolean {
  if (cfg.sessionFilter === 'any') return true;
  if (cfg.sessionFilter === 'rth') return inst.sessionTag === 'rth';
  if (cfg.sessionFilter === 'overnight') return inst.sessionTag === 'overnight';
  // evening: first N hours after the 18:00 ET reopen
  if (inst.sessionTag !== 'overnight') return false;
  const p = toET(inst.bars[inst.bars.length - 1].t);
  const m = p.hh * 60 + p.mm;
  const sinceOpen = m >= 18 * 60 ? m - 18 * 60 : m + 24 * 60 - 18 * 60;
  return sinceOpen < cfg.eveningHours * 60;
}

/** Serve a drill: detector-labeled ("real" pipeline) or v1-style synthetic. */
export async function getDrill(
  patternId: PatternId,
  source: 'synthetic' | 'real',
  cfg: EngineConfig,
  difficulty: 'easy' | 'hard',
  exclude: Set<string>,
): Promise<DrillInstance> {
  if (source === 'real') {
    const ds = await getDataset(cfg);
    let pool = (ds.byPattern.get(patternId) ?? []).filter((i) => !exclude.has(i.id));
    const filtered = pool.filter((i) => passesFilter(i, cfg));
    if (filtered.length) pool = filtered;
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return synthDrill(patternId, { difficulty });
}
