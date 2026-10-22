import { useSyncExternalStore } from 'react';
import { hasProEntitlement, inferPlanTier } from '../core/entitlement';

/**
 * Web RevenueCat adapter with a graceful mock fallback — the browser twin of
 * mobile/src/purchases.ts.
 *
 * Real mode needs a RevenueCat Web Billing public key in VITE_RC_WEB_KEY; the
 * SDK is dynamically imported so builds without a key never ship it. With no
 * key (or any SDK failure), DEV builds run in MOCK mode (paywall works
 * end-to-end, "purchases" persist a clearly-labeled local entitlement) while
 * production builds go UNAVAILABLE: nothing is buyable and any stale mock
 * entitlement is revoked — a keyless deploy must never give Pro away.
 *
 * Entitlement truth flows one way: RevenueCat customer info → setPro() →
 * useEntitlement() subscribers (same listeners pattern as ui/theme.ts).
 */

export type PurchasesMode = 'web' | 'mock' | 'unavailable';

export type PlanId = 'monthly' | 'annual' | 'lifetime';

export interface PlanInfo {
  id: PlanId;
  title: string;
  price: string;
  period: string;
  trial: string | null;
  /** RevenueCat package handle in web mode; null in mock mode. */
  pkg: unknown;
}

const PRO_KEY = 'dm.pro';
const UID_KEY = 'dm.rcuid';

const MOCK_PLANS: PlanInfo[] = [
  { id: 'monthly', title: 'Monthly', price: '$9.99', period: '/ month', trial: null, pkg: null },
  { id: 'annual', title: 'Annual', price: '$59.99', period: '/ year', trial: null, pkg: null },
  { id: 'lifetime', title: 'Lifetime', price: '$99.99', period: 'one-time', trial: null, pkg: null },
];

/** Mock purchases exist for development only — a keyless production build must never grant Pro. */
const MOCK_ALLOWED = import.meta.env.DEV;

let mode: PurchasesMode = MOCK_ALLOWED ? 'mock' : 'unavailable';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rc: any = null;

const listeners = new Set<() => void>();
let pro = MOCK_ALLOWED ? readMockPro() : false;

function readMockPro(): boolean {
  return localStorage.getItem(PRO_KEY) === '1';
}

function setPro(next: boolean): void {
  if (pro === next) return;
  pro = next;
  for (const fn of listeners) fn();
}

/** Anonymous RevenueCat app user id, generated once and pinned in localStorage. */
function anonUserId(): string {
  let id = localStorage.getItem(UID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(UID_KEY, id);
  }
  return id;
}

/** The billing id if one exists — for backup export. Never mints a new one. */
export function getBillingUserId(): string | null {
  return localStorage.getItem(UID_KEY);
}

/**
 * Adopt a billing id carried in an imported backup so a paid web entitlement
 * survives a browser wipe. Only fills a vacancy — an existing local id (which
 * may itself hold purchases) is never overwritten.
 */
export async function adoptBillingUserId(id: string): Promise<void> {
  if (localStorage.getItem(UID_KEY)) return;
  localStorage.setItem(UID_KEY, id);
  if (mode === 'web' && rc) {
    try {
      applyCustomerInfo(await rc.changeUser(id));
    } catch {
      // offline — entitlement re-syncs on next launch with the adopted id
    }
  }
}

/**
 * Switch this browser to a specific RevenueCat customer (Cloud Sync link).
 * Unlike adoptBillingUserId this overwrites any existing local id — linking a
 * sync account is an explicit user action that says "be this customer", which
 * is what lets an App Store purchase unlock Pro here.
 */
export async function linkBillingUser(id: string): Promise<void> {
  localStorage.setItem(UID_KEY, id);
  if (mode === 'web' && rc) {
    try {
      applyCustomerInfo(await rc.changeUser(id));
    } catch {
      // offline — entitlement re-syncs on next launch with the linked id
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCustomerInfo(info: any): void {
  setPro(hasProEntitlement(info?.entitlements?.active));
}

export async function initPurchases(): Promise<void> {
  const apiKey = import.meta.env.VITE_RC_WEB_KEY as string | undefined;
  if (apiKey) {
    try {
      const { Purchases } = await import('@revenuecat/purchases-js');
      rc = Purchases.configure({ apiKey, appUserId: anonUserId() });
      mode = 'web';
      localStorage.removeItem(PRO_KEY); // retire any mock entitlement left by an earlier keyless session
      applyCustomerInfo(await rc.getCustomerInfo());
      return;
    } catch {
      rc = null; // bad key / offline — fall through
    }
  }
  if (MOCK_ALLOWED) {
    mode = 'mock';
    setPro(readMockPro());
  } else {
    // Production without working billing: nothing is buyable, and any persisted
    // mock entitlement is revoked (mirrors mobile's 'unavailable' mode).
    mode = 'unavailable';
    localStorage.removeItem(PRO_KEY);
    setPro(false);
  }
}

export function purchasesMode(): PurchasesMode {
  return mode;
}

export async function getPlans(): Promise<PlanInfo[]> {
  if (mode === 'web' && rc) {
    try {
      const offerings = await rc.getOfferings();
      const packages: unknown[] = offerings?.current?.availablePackages ?? [];
      if (packages.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return packages.map((pkg: any) => {
          const product = pkg.webBillingProduct;
          const id = inferPlanTier(String(pkg.identifier ?? ''), String(product?.identifier ?? ''));
          return {
            id,
            title: id === 'monthly' ? 'Monthly' : id === 'annual' ? 'Annual' : 'Lifetime',
            price: String(product?.currentPrice?.formattedPrice ?? ''),
            period: id === 'monthly' ? '/ month' : id === 'annual' ? '/ year' : 'one-time',
            trial: product?.trial ? 'Free trial' : null,
            pkg,
          };
        });
      }
    } catch {
      return []; // offerings unreachable — show nothing buyable rather than fake prices
    }
  }
  return mode === 'mock' ? MOCK_PLANS : [];
}

export async function purchase(plan: PlanInfo): Promise<{ ok: boolean; error?: string }> {
  if (mode === 'web' && rc && plan.pkg) {
    try {
      const { customerInfo } = await rc.purchase({ rcPackage: plan.pkg });
      applyCustomerInfo(customerInfo);
      return { ok: hasProEntitlement(customerInfo?.entitlements?.active) };
    } catch (e) {
      const err = e as { errorCode?: number; message?: string };
      if (err.errorCode === 1) return { ok: false }; // ErrorCode.UserCancelledError
      return { ok: false, error: err.message ?? 'Purchase failed.' };
    }
  }
  if (mode !== 'mock') return { ok: false, error: 'Purchases are unavailable right now.' };
  // Mock: simulate a successful sandbox purchase, clearly labeled in the UI.
  localStorage.setItem(PRO_KEY, '1');
  setPro(true);
  return { ok: true };
}

export async function restore(): Promise<{ ok: boolean; error?: string }> {
  if (mode === 'web' && rc) {
    try {
      // Web Billing has no separate restore call — re-syncing customer info
      // re-activates any entitlement tied to this app user id.
      applyCustomerInfo(await rc.getCustomerInfo());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? 'Restore failed.' };
    }
  }
  if (mode !== 'mock') return { ok: false, error: 'Purchases are unavailable right now.' };
  setPro(readMockPro()); // mock: the local entitlement already reflects reality
  return { ok: true };
}

/** Settings dev toggle — flips the MOCK entitlement only. */
export function setProForDev(on: boolean): void {
  if (mode !== 'mock') return;
  if (on) localStorage.setItem(PRO_KEY, '1');
  else localStorage.removeItem(PRO_KEY);
  setPro(on);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Current entitlement outside React (e.g. right after an awaited restore). */
export function getEntitlement(): boolean {
  return pro;
}

/** React hook: the pro entitlement, re-rendering on change. */
export function useEntitlement(): boolean {
  return useSyncExternalStore(subscribe, getEntitlement);
}
