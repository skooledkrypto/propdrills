#!/usr/bin/env node
/**
 * Download MNQ 1-minute OHLCV bars from Databento into data/mnq-1m.csv.
 *
 * Usage:
 *   npm run fetch-data -- --start 2025-02-01 --end 2025-07-31
 *   node scripts/fetch-databento.mjs --start 2025-02-01 --end 2025-07-31 [--symbol MNQ.c.0] [--out data/mnq-1m.csv] [--yes]
 *
 * Reads DATABENTO_API_KEY from .env (gitignored). The output lands in the
 * gitignored data/ folder — CME data is licensed: keep it local, never commit
 * or redistribute it.
 */
import { readFileSync, mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvKey() {
  if (process.env.DATABENTO_API_KEY) return process.env.DATABENTO_API_KEY.trim();
  const envPath = resolve(root, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*DATABENTO_API_KEY\s*=\s*(.+?)\s*$/);
      if (m && m[1]) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}

const key = loadEnvKey();
if (!key) {
  console.error('No API key found. Put DATABENTO_API_KEY=db-... in the .env file (it is gitignored).');
  process.exit(1);
}

const start = arg('start');
const end = arg('end');
if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? '')) {
  console.error('Provide --start YYYY-MM-DD and --end YYYY-MM-DD (end is exclusive).');
  process.exit(1);
}
const symbol = arg('symbol', 'MNQ.c.0'); // continuous front month by open interest... (.c.0 = calendar-lead)
const out = resolve(root, arg('out', 'data/mnq-1m.csv'));
const autoYes = process.argv.includes('--yes');

const base = 'https://hist.databento.com/v0';
const auth = 'Basic ' + Buffer.from(`${key}:`).toString('base64');
const common = {
  dataset: 'GLBX.MDP3',
  symbols: symbol,
  stype_in: 'continuous',
  schema: 'ohlcv-1m',
  start,
  end,
};

function qs(params) {
  return new URLSearchParams(params).toString();
}

async function main() {
  // 1) price the request first — no surprises on a pay-as-you-go account
  console.log(`Pricing ${symbol} ohlcv-1m ${start} → ${end} …`);
  const costRes = await fetch(`${base}/metadata.get_cost?${qs({ ...common, mode: 'historical' })}`, {
    headers: { Authorization: auth },
  });
  if (!costRes.ok) {
    console.error(`Cost check failed (${costRes.status}): ${await costRes.text()}`);
    process.exit(1);
  }
  const cost = Number(await costRes.text());
  console.log(`Estimated cost: $${cost.toFixed(4)} (billed against your Databento credit)`);
  if (cost > 2 && !autoYes) {
    console.error('Cost is above $2 — re-run with --yes to confirm, or narrow the date range.');
    process.exit(1);
  }

  // 2) stream the CSV down
  mkdirSync(dirname(out), { recursive: true });
  console.log(`Downloading to ${out} …`);
  const res = await fetch(
    `${base}/timeseries.get_range?${qs({
      ...common,
      encoding: 'csv',
      pretty_px: 'true',
      pretty_ts: 'true',
      map_symbols: 'true',
    })}`,
    { headers: { Authorization: auth } },
  );
  if (!res.ok || !res.body) {
    console.error(`Download failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  console.log('Done.');
  console.log('Next: open the app -> Data tab -> "Choose CSV file…" and import this file.');
  console.log('Timestamps in the file are UTC (ISO); pick "UTC" in the import dialog.');
  console.log('Reminder: this file is licensed CME data — it stays in the gitignored data/ folder.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
