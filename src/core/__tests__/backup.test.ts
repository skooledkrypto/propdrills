import { describe, expect, it } from 'vitest';
import { describeBackup, parseBackup, serializeBackup } from '../backup';
import type { Progress } from '../types';

const progress: Progress = {
  perPattern: {
    pin: { seen: 12, correct: 9, streak: 3, lastSeenAt: 1000, box: 2, dueAt: 2000 },
    sweep: { seen: 4, correct: 2, streak: 0, lastSeenAt: 900, box: 1, dueAt: 1800 },
  },
};

describe('backup round-trip', () => {
  it('serializes and parses back losslessly', () => {
    const raw = serializeBackup({
      platform: 'mobile',
      progress,
      attempts: [
        { t: 1, patternId: 'pin', correct: true, mode: 'drill', source: 'real', realizedMove: 4.5 },
        { t: 2, patternId: 'sweep', correct: false, mode: 'levelDrill', source: 'synthetic' },
      ],
      profileName: 'Connor',
      now: 1234,
    });
    const res = parseBackup(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.exportedAt).toBe(1234);
    expect(res.payload.platform).toBe('mobile');
    expect(res.payload.profileName).toBe('Connor');
    expect(res.payload.progress.perPattern.pin.correct).toBe(9);
    expect(res.payload.attempts).toHaveLength(2);
    expect(res.payload.attempts[0].realizedMove).toBe(4.5);
    expect(res.payload.attempts[1].realizedMove).toBeUndefined();
  });

  it('carries the web billing id when present, drops junk values', () => {
    const raw = serializeBackup({ platform: 'web', progress, attempts: [], rcUserId: 'abc-123-uuid' });
    const res = parseBackup(raw);
    expect(res.ok && res.payload.rcUserId).toBe('abc-123-uuid');
    // absent stays absent; oversized is dropped rather than truncated
    const bare = parseBackup(serializeBackup({ platform: 'web', progress, attempts: [] }));
    expect(bare.ok && bare.payload.rcUserId).toBeFalsy();
    const junk = parseBackup(
      JSON.stringify({ kind: 'propdrills-backup', v: 1, exportedAt: 1, platform: 'web', rcUserId: 'x'.repeat(80), progress, attempts: [] }),
    );
    expect(junk.ok && junk.payload.rcUserId).toBeFalsy();
  });

  it('writes the propdrills kind but still accepts pre-rebrand drillmafia backups', () => {
    expect(JSON.parse(serializeBackup({ platform: 'web', progress, attempts: [] })).kind).toBe('propdrills-backup');
    const legacy = JSON.stringify({ kind: 'drillmafia-backup', v: 1, exportedAt: 1, platform: 'web', progress, attempts: [] });
    expect(parseBackup(legacy).ok).toBe(true);
  });

  it('rejects non-JSON and foreign payloads', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"kind":"something-else"}').ok).toBe(false);
    expect(parseBackup('{"kind":"drillmafia-backup","v":99}').ok).toBe(false);
  });

  it('drops unknown patterns and malformed rows instead of failing', () => {
    const raw = JSON.stringify({
      kind: 'drillmafia-backup',
      v: 1,
      exportedAt: 5,
      platform: 'web',
      progress: {
        perPattern: {
          pin: { seen: 3, correct: 2, streak: 1, lastSeenAt: 1, box: 9, dueAt: 1 },
          bogus: { seen: 3 },
        },
      },
      attempts: [
        { t: 1, patternId: 'pin', correct: true, mode: 'nope', source: 'nope' },
        { t: 2, patternId: 'bogus', correct: true },
        'garbage',
      ],
    });
    const res = parseBackup(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.payload.progress.perPattern)).toEqual(['pin']);
    expect(res.payload.progress.perPattern.pin.box).toBe(5); // clamped
    expect(res.payload.attempts).toHaveLength(1);
    expect(res.payload.attempts[0].mode).toBe('drill');
  });

  it('describes a payload', () => {
    const res = parseBackup(serializeBackup({ platform: 'web', progress, attempts: [], now: 1 }));
    if (!res.ok) throw new Error('parse failed');
    expect(describeBackup(res.payload)).toContain('2 patterns');
  });
});
