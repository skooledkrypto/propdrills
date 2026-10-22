import { detect } from '../core/detect';
import type { Candle } from '../core/types';
import type { EngineConfig } from '../core/config';

/**
 * Runs the rule-based labeler off the main thread so scanning a year of
 * 1-min bars never freezes the UI.
 */

export interface DetectRequest {
  bars: Candle[];
  cfg: EngineConfig;
}

export type DetectResponse =
  | { type: 'progress'; frac: number }
  | { type: 'done'; instances: ReturnType<typeof detect> }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  try {
    const { bars, cfg } = e.data;
    const instances = detect(bars, cfg, (frac) => {
      (self as unknown as Worker).postMessage({ type: 'progress', frac } satisfies DetectResponse);
    });
    (self as unknown as Worker).postMessage({ type: 'done', instances } satisfies DetectResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies DetectResponse);
  }
};
