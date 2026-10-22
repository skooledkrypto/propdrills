import type { Attempt, DrillMode, DrillSource, PatternId, Progress } from './types';
import { PATTERNS } from './patterns';

/**
 * Portable progress backup — the same JSON payload on web and mobile, so
 * progress can move between devices today and sync through an account
 * backend later without a format change.
 */

export const BACKUP_KIND = 'propdrills-backup';
/** Pre-rebrand exports must keep importing forever — never remove this alias. */
export const LEGACY_BACKUP_KIND = 'drillmafia-backup';

export interface BackupPayload {
  kind: typeof BACKUP_KIND;
  v: 1;
  exportedAt: number;
  platform: 'web' | 'mobile';
  profileName?: string;
  /**
   * RevenueCat customer id — web's billing id (localStorage 'dm.rcuid') or
   * mobile's anonymous app user id. Carried so a paid entitlement follows the
   * backup: importing on a device with no billing id yet re-links the same
   * RevenueCat customer, whose entitlements are shared across platforms.
   */
  rcUserId?: string;
  progress: Progress;
  attempts: Attempt[];
}

export function serializeBackup(args: {
  platform: 'web' | 'mobile';
  progress: Progress;
  attempts: Attempt[];
  profileName?: string;
  rcUserId?: string;
  now?: number;
}): string {
  const payload: BackupPayload = {
    kind: BACKUP_KIND,
    v: 1,
    exportedAt: args.now ?? Date.now(),
    platform: args.platform,
    ...(args.profileName ? { profileName: args.profileName } : {}),
    ...(args.rcUserId ? { rcUserId: args.rcUserId } : {}),
    progress: args.progress,
    attempts: args.attempts,
  };
  return JSON.stringify(payload);
}

const MODES: DrillMode[] = ['drill', 'levelDrill', 'fullSetup'];
const SOURCES: DrillSource[] = ['synthetic', 'real'];

function num(x: unknown, fallback = 0): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

/**
 * Parse untrusted backup text (pasted, shared, or read from a file).
 * Unknown patterns and malformed rows are dropped rather than failing the
 * whole import; a hard error is returned only when the payload is not a
 * PropDrills backup at all.
 */
export function parseBackup(raw: string): { ok: true; payload: BackupPayload } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    return { ok: false, error: 'Not valid JSON — make sure the whole backup text was copied.' };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'Not a PropDrills backup.' };
  const d = data as Record<string, unknown>;
  if (d.kind !== BACKUP_KIND && d.kind !== LEGACY_BACKUP_KIND) {
    return { ok: false, error: 'Not a PropDrills backup.' };
  }
  if (d.v !== 1) return { ok: false, error: `Backup version ${String(d.v)} is newer than this app understands.` };

  const knownIds = new Set(Object.keys(PATTERNS));

  const perPatternRaw =
    typeof d.progress === 'object' && d.progress !== null
      ? ((d.progress as Record<string, unknown>).perPattern as Record<string, unknown> | undefined)
      : undefined;
  const perPattern: Progress['perPattern'] = {};
  if (perPatternRaw && typeof perPatternRaw === 'object') {
    for (const [id, v] of Object.entries(perPatternRaw)) {
      if (!knownIds.has(id) || typeof v !== 'object' || v === null) continue;
      const p = v as Record<string, unknown>;
      perPattern[id] = {
        seen: num(p.seen),
        correct: num(p.correct),
        streak: num(p.streak),
        lastSeenAt: num(p.lastSeenAt),
        box: Math.min(5, Math.max(0, num(p.box))),
        dueAt: num(p.dueAt),
      };
    }
  }

  const attempts: Attempt[] = [];
  if (Array.isArray(d.attempts)) {
    for (const a of d.attempts as unknown[]) {
      if (typeof a !== 'object' || a === null) continue;
      const r = a as Record<string, unknown>;
      if (!knownIds.has(String(r.patternId))) continue;
      attempts.push({
        t: num(r.t),
        patternId: r.patternId as PatternId,
        correct: r.correct === true,
        mode: MODES.includes(r.mode as DrillMode) ? (r.mode as DrillMode) : 'drill',
        source: SOURCES.includes(r.source as DrillSource) ? (r.source as DrillSource) : 'synthetic',
        ...(typeof r.realizedMove === 'number' && Number.isFinite(r.realizedMove)
          ? { realizedMove: r.realizedMove }
          : {}),
      });
    }
  }

  return {
    ok: true,
    payload: {
      kind: BACKUP_KIND,
      v: 1,
      exportedAt: num(d.exportedAt),
      platform: d.platform === 'mobile' ? 'mobile' : 'web',
      ...(typeof d.profileName === 'string' && d.profileName.trim()
        ? { profileName: d.profileName.trim().slice(0, 40) }
        : {}),
      ...(typeof d.rcUserId === 'string' && d.rcUserId.trim() && d.rcUserId.trim().length <= 64
        ? { rcUserId: d.rcUserId.trim() }
        : {}),
      progress: { perPattern },
      attempts,
    },
  };
}

/** One-line human summary shown before the user confirms an import. */
export function describeBackup(p: BackupPayload): string {
  const patterns = Object.values(p.progress.perPattern).filter((x) => x.seen > 0).length;
  const when = p.exportedAt ? new Date(p.exportedAt).toLocaleDateString() : 'unknown date';
  const who = p.profileName ? ` for ${p.profileName}` : '';
  return `Backup${who} from ${p.platform} (${when}): ${p.attempts.length} attempts across ${patterns} patterns.`;
}
