import { describe, expect, it } from 'vitest';
import { parseCsv, wallClockToUtc } from '../csv';

describe('parseCsv', () => {
  it('parses epoch-second rows with a header', () => {
    const t0 = Math.floor(Date.UTC(2026, 5, 1, 22, 0) / 1000);
    const text = [
      'timestamp,open,high,low,close,volume',
      `${t0},21500,21510,21495,21505,1200`,
      `${t0 + 60},21505,21512,21500,21508,900`,
    ].join('\n');
    const r = parseCsv(text, 'utc');
    expect(r.bars).toHaveLength(2);
    expect(r.bars[0].t).toBe(t0 * 1000);
    expect(r.bars[1].c).toBe(21508);
    expect(r.skipped).toBe(0);
  });

  it('interprets naive timestamps in the declared timezone (ET, DST-aware)', () => {
    const text = ['timestamp,open,high,low,close,volume', '2026-06-01 18:00,21500,21510,21495,21505,100'].join('\n');
    const r = parseCsv(text, 'et');
    expect(r.bars[0].t).toBe(wallClockToUtc('America/New_York', 2026, 6, 1, 18, 0));
    // EDT: 18:00 ET == 22:00 UTC
    expect(r.bars[0].t).toBe(Date.UTC(2026, 5, 1, 22, 0));
  });

  it('sorts, dedupes, and skips malformed rows', () => {
    const t0 = Date.UTC(2026, 5, 1, 22, 0);
    const text = [
      `${t0 + 60000},21505,21512,21500,21508,900`,
      `${t0},21500,21510,21495,21505,1200`,
      `${t0},21501,21511,21496,21506,1100`, // duplicate timestamp
      `${t0 + 120000},bad,21512,21500,21508,900`, // malformed
      `${t0 + 180000},21510,21505,21512,21508,900`, // high < low
    ].join('\n');
    const r = parseCsv(text, 'utc');
    expect(r.bars).toHaveLength(2);
    expect(r.duplicates).toBe(1);
    expect(r.skipped).toBe(2);
    expect(r.bars[0].t).toBe(t0);
  });

  it('reports large intraday gaps', () => {
    const t0 = Date.UTC(2026, 5, 1, 22, 0);
    const rows = [`${t0},21500,21510,21495,21505,100`, `${t0 + 4 * 3600 * 1000},21505,21512,21500,21508,100`];
    const r = parseCsv(rows.join('\n'), 'utc');
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].minutes).toBe(240);
  });

  it('maps Databento-style headers (ts_event)', () => {
    const t0 = Math.floor(Date.UTC(2026, 5, 1, 22, 0) / 1000) * 1_000_000_000;
    const text = ['ts_event,rtype,open,high,low,close,volume', `${t0},33,21500,21510,21495,21505,100`].join('\n');
    const r = parseCsv(text, 'utc');
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0].t).toBe(Date.UTC(2026, 5, 1, 22, 0));
    expect(r.bars[0].o).toBe(21500);
  });
});
