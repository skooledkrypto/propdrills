import { createSyncAccount, type SyncAccount } from '../core/sync';
import { getBillingUserId, linkBillingUser } from './purchases';

/** Local record of the linked Cloud Sync account — shared by Settings and the welcome tour. */
export const SYNC_KEY = 'dm.sync';

export function readSyncAccount(): SyncAccount | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncAccount;
    return parsed.code && parsed.userId ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSyncAccount(acct: SyncAccount | null): void {
  if (acct) localStorage.setItem(SYNC_KEY, JSON.stringify(acct));
  else localStorage.removeItem(SYNC_KEY);
}

/** Mint an account, adopt its billing identity, and persist the local record. */
export async function createAndLinkSyncAccount(): Promise<SyncAccount> {
  const acct = await createSyncAccount(getBillingUserId());
  await linkBillingUser(acct.userId);
  saveSyncAccount(acct);
  return acct;
}
