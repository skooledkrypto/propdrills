import type { Candle } from './types';

/**
 * Robust importer for `timestamp,open,high,low,close,volume` CSVs
 * (FirstRateData, Databento ohlcv-1m exports, broker exports).
 *
 * Timestamp forms accepted:
 *  - epoch seconds / milliseconds / nanoseconds (auto-detected by magnitude)
 *  - ISO 8601 with offset or Z ("2026-03-09T18:00:00-05:00")
 *  - "YYYY-MM-DD HH:MM[:SS]" — interpreted in the timezone the user declares
 */

export interface CsvReport {
  bars: Candle[];
  rows: number;
  skipped: number;
  duplicates: number;
  gaps: { fromT: number; toT: number; minutes: number }[];
  firstBar: number | null;
  lastBar: number | null;
  warnings: string[];
}

export type DeclaredTz = 'utc' | 'et' | 'pt';

const TZ_NAME: Record<DeclaredTz, string> = {
  utc: 'UTC',
  et: 'America/New_York',
  pt: 'America/Los_Angeles',
};

/** Offset (ms) of `tz` from UTC at the given UTC instant (DST-aware). */
function tzOffsetMs(tz: string, utcMs: number): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = f.formatToParts(utcMs);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - utcMs;
}

/** Convert a wall-clock time in `tz` to UTC ms (DST-aware, iterative). */
export function wallClockToUtc(tz: string, y: number, mo: number, d: number, hh: number, mm: number, ss = 0): number {
  let guess = Date.UTC(y, mo - 1, d, hh, mm, ss);
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMs(tz, guess);
    const next = Date.UTC(y, mo - 1, d, hh, mm, ss) - off;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

function parseTimestamp(raw: string, tz: DeclaredTz): number | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const num = Number(s);
    if (s.length >= 18) return Math.floor(num / 1e6); // ns
    if (s.length >= 12) return num; // ms
    return num * 1000; // s
  }
  // ISO with explicit offset/Z: trust it
  if (/[tT].*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  // "YYYY-MM-DD HH:MM[:SS]" or ISO without offset -> declared tz
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ tT](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return wallClockToUtc(
      TZ_NAME[tz],
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? 0),
    );
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function parseCsv(text: string, tz: DeclaredTz): CsvReport {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  let startIdx = 0;
  // header detection + column mapping
  let cols = { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };
  if (lines.length && /[a-zA-Z]{3}/.test(lines[0])) {
    const heads = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const find = (...names: string[]) => {
      for (const nm of names) {
        const i = heads.findIndex((h) => h === nm || h.startsWith(nm));
        if (i >= 0) return i;
      }
      return -1;
    };
    const t = find('timestamp', 'ts_event', 'time', 'date', 'datetime');
    const o = find('open');
    const h = find('high');
    const l = find('low');
    const c = find('close');
    const v = find('volume', 'vol');
    if (t >= 0 && o >= 0 && h >= 0 && l >= 0 && c >= 0) {
      cols = { t, o, h, l, c, v: v >= 0 ? v : -1 };
      startIdx = 1;
    } else {
      warnings.push('Could not map header row; assuming column order timestamp,open,high,low,close,volume.');
      startIdx = 1;
    }
  }

  const bars: Candle[] = [];
  let skipped = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    const t = parseTimestamp(parts[cols.t] ?? '', tz);
    const o = Number(parts[cols.o]);
    const h = Number(parts[cols.h]);
    const l = Number(parts[cols.l]);
    const c = Number(parts[cols.c]);
    const v = cols.v >= 0 ? Number(parts[cols.v]) : 0;
    if (
      t === null ||
      [o, h, l, c].some((x) => !Number.isFinite(x)) ||
      h < l ||
      o <= 0 ||
      h <= 0
    ) {
      skipped++;
      continue;
    }
    bars.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }

  bars.sort((a, b) => a.t - b.t);
  // dedupe
  let duplicates = 0;
  const deduped: Candle[] = [];
  for (const b of bars) {
    if (deduped.length && deduped[deduped.length - 1].t === b.t) {
      duplicates++;
      deduped[deduped.length - 1] = b;
    } else deduped.push(b);
  }

  // gap report (> 90 min between consecutive bars, excluding the daily
  // maintenance hour and weekend closes which are expected)
  const gaps: CsvReport['gaps'] = [];
  for (let i = 1; i < deduped.length; i++) {
    const dtMin = (deduped[i].t - deduped[i - 1].t) / 60000;
    if (dtMin > 90 && dtMin < 45 * 60) {
      gaps.push({ fromT: deduped[i - 1].t, toT: deduped[i].t, minutes: Math.round(dtMin) });
    }
  }
  if (gaps.length > 25) {
    warnings.push(`${gaps.length} intraday gaps > 90 min found — check the export's session coverage.`);
  }
  const sane = deduped.filter((b) => b.c > 1000 && b.c < 100000).length;
  if (deduped.length && sane / deduped.length < 0.95) {
    warnings.push('Many prices fall outside a plausible MNQ range — is this the right instrument/units?');
  }

  return {
    bars: deduped,
    rows: bars.length + skipped,
    skipped,
    duplicates,
    gaps: gaps.slice(0, 50),
    firstBar: deduped.length ? deduped[0].t : null,
    lastBar: deduped.length ? deduped[deduped.length - 1].t : null,
    warnings,
  };
}
