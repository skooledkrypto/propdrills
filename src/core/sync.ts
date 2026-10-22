/**
 * Cloud Sync client — talks to the propdrills.com Pages Functions API
 * (functions/api/sync/). An "account" is nothing but a random sync code plus a
 * RevenueCat app user id: no email, no password, no personal data. The code is
 * the bearer secret; whoever holds it owns the account.
 *
 * Identity rule (avoids purchase-transfer edge cases): the device that CREATES
 * the account contributes its existing RevenueCat id, so a paying device never
 * switches users. Devices that LINK adopt that id, which makes RevenueCat
 * surface the same entitlements everywhere — App Store and Web Billing alike.
 *
 * Progress sync is deliberately explicit in v1: "Back up" pushes the standard
 * backup payload, "Restore" pulls and imports it. Last write wins.
 */

export const SYNC_API = 'https://propdrills.com/api/sync';

export interface SyncAccount {
  code: string;
  userId: string;
}

export interface SyncStatus {
  userId: string;
  /** ms epoch of the last cloud backup, or null if none stored yet. */
  updatedAt: number | null;
  /** The stored backup JSON string, or null. */
  backup: string | null;
}

const CODE_RE = /^PD(-[A-Z2-9]{4}){4}$/;

/** Forgive pasted lowercase/spaces; returns null if it still isn't a code. */
export function normalizeSyncCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  const dashed = /^PD[A-Z2-9]{16}$/.test(cleaned)
    ? `PD-${cleaned.slice(2, 6)}-${cleaned.slice(6, 10)}-${cleaned.slice(10, 14)}-${cleaned.slice(14, 18)}`
    : cleaned;
  return CODE_RE.test(dashed) ? dashed : null;
}

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${SYNC_API}${path}`, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error page — leave body null
  }
  return { status: res.status, body };
}

/** Mint a new account. Pass the creating device's RevenueCat id if it has one. */
export async function createSyncAccount(userId?: string | null): Promise<SyncAccount> {
  const { status, body } = await call('/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userId ? { userId } : {}),
  });
  if (status !== 200 || !body?.code) throw new Error('Could not create a sync account. Try again.');
  return { code: body.code, userId: body.userId };
}

export async function fetchSyncStatus(code: string): Promise<SyncStatus> {
  const { status, body } = await call(`/${code}`);
  if (status === 404) throw new Error('That sync code was not found. Check it and try again.');
  if (status !== 200 || !body?.userId) throw new Error('Cloud sync is unreachable right now.');
  return { userId: body.userId, updatedAt: body.updatedAt ?? null, backup: body.backup ?? null };
}

export async function pushSyncBackup(code: string, backupJson: string): Promise<number> {
  const { status, body } = await call(`/${code}`, { method: 'PUT', body: backupJson });
  if (status !== 200 || !body?.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : 'Cloud backup failed. Try again.');
  }
  return body.updatedAt as number;
}

export async function deleteSyncAccount(code: string): Promise<void> {
  const { status } = await call(`/${code}`, { method: 'DELETE' });
  if (status !== 200 && status !== 404) throw new Error('Could not delete the cloud account. Try again.');
}
