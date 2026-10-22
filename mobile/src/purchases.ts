import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { hasProEntitlement, inferPlanTier } from './core';
import { useApp } from './store';

/**
 * RevenueCat adapter with a graceful mock fallback.
 *
 * Real mode needs (a) a RevenueCat public API key in EXPO_PUBLIC_RC_IOS_KEY /
 * EXPO_PUBLIC_RC_ANDROID_KEY and (b) a dev/store build — react-native-purchases
 * is a native module, so it can NEVER run inside Expo Go.
 *
 * Mode rules (App Review–safe):
 *  - 'native': key present and the native module configured. Store truth.
 *  - 'mock':   ONLY in Expo Go or a __DEV__ build. The paywall works
 *              end-to-end and "purchases" persist a local entitlement,
 *              clearly labeled as simulated.
 *  - 'unavailable': a RELEASE build where billing can't run (no key, or the
 *              native module failed). Nothing can be bought, nothing is
 *              granted, and any mock entitlement persisted by an earlier
 *              Expo Go session is revoked. Shipping a build that "sells" Pro
 *              without real StoreKit/Play Billing is an App Store rejection.
 *
 * Entitlement truth flows one way: RevenueCat customer info → store.setPro().
 * RevenueCat's listener keeps the entitlement synced across devices.
 */

export type PurchasesMode = 'native' | 'mock' | 'unavailable';

export type PlanId = 'monthly' | 'annual' | 'lifetime';

export interface PlanInfo {
  id: PlanId;
  title: string;
  price: string;
  period: string;
  trial: string | null;
  /** RevenueCat package handle in native mode; null in mock mode. */
  pkg: unknown;
}

const MOCK_PLANS: PlanInfo[] = [
  { id: 'monthly', title: 'Monthly', price: '$9.99', period: '/ month', trial: null, pkg: null },
  { id: 'annual', title: 'Annual', price: '$59.99', period: '/ year', trial: null, pkg: null },
  { id: 'lifetime', title: 'Lifetime', price: '$99.99', period: 'one-time', trial: null, pkg: null },
];

/** Simulated purchases are for development only: Expo Go or a __DEV__ build. */
const MOCK_ALLOWED = Constants.appOwnership === 'expo' || __DEV__;

let mode: PurchasesMode = MOCK_ALLOWED ? 'mock' : 'unavailable';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Purchases: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCustomerInfo(info: any): void {
  const isPro = hasProEntitlement(info?.entitlements?.active);
  useApp.getState().setPro(isPro, isPro ? 'revenuecat' : null);
}

export async function initPurchases(): Promise<void> {
  const apiKey =
    Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_RC_IOS_KEY : process.env.EXPO_PUBLIC_RC_ANDROID_KEY;
  if (apiKey) {
    try {
      // Resolves in any build; only *works* where the native module exists.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Purchases = require('react-native-purchases').default;
      Purchases.configure({ apiKey });
      mode = 'native';
      applyCustomerInfo(await Purchases.getCustomerInfo());
      Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
      return;
    } catch {
      Purchases = null; // Expo Go or misconfigured build — fall through
    }
  }
  mode = MOCK_ALLOWED ? 'mock' : 'unavailable';
  // A release build must never honor a locally persisted mock entitlement
  // (e.g. carried over from Expo Go via backup or a dev install).
  const s = useApp.getState();
  if (!MOCK_ALLOWED && s.proSource === 'mock') s.setPro(false, null);
}

export function purchasesMode(): PurchasesMode {
  return mode;
}

/**
 * The RevenueCat app user id for this install (anonymous unless we ever log
 * users in). Surfaced in Settings as a "Support ID" so a customer can be
 * located in the RevenueCat dashboard for support (refunds, comp'd Pro).
 */
export async function getAppUserId(): Promise<string | null> {
  if (mode === 'native' && Purchases) {
    try {
      return String(await Purchases.getAppUserID());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Log this install in as a specific RevenueCat customer (Cloud Sync link).
 * RevenueCat then surfaces that customer's entitlements here — including ones
 * bought on other platforms. No-op outside native mode (Expo Go / dev).
 */
export async function linkPurchaseUser(id: string): Promise<void> {
  if (mode === 'native' && Purchases) {
    const current = await getAppUserId();
    if (current === id) return;
    try {
      const { customerInfo } = await Purchases.logIn(id);
      applyCustomerInfo(customerInfo);
    } catch {
      // offline — the SDK retries the identity switch on next launch
    }
  }
}

export async function getPlans(): Promise<PlanInfo[]> {
  if (mode === 'native' && Purchases) {
    try {
      const offerings = await Purchases.getOfferings();
      const packages: unknown[] = offerings?.current?.availablePackages ?? [];
      if (packages.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return packages.map((pkg: any) => {
          const product = pkg.product;
          // packageType is 'MONTHLY' | 'ANNUAL' | 'LIFETIME' | … on mobile
          const id = inferPlanTier(String(pkg.packageType ?? pkg.identifier ?? ''), String(product?.identifier ?? ''));
          return {
            id,
            title: id === 'monthly' ? 'Monthly' : id === 'annual' ? 'Annual' : 'Lifetime',
            price: String(product?.priceString ?? ''),
            period: id === 'monthly' ? '/ month' : id === 'annual' ? '/ year' : 'one-time',
            trial: product?.introPrice ? 'Free trial' : null,
            pkg,
          };
        });
      }
    } catch {
      // offerings unavailable — fall through
    }
  }
  if (mode === 'mock') return MOCK_PLANS;
  // native-with-no-offerings or unavailable: nothing purchasable to show
  return [];
}

export async function purchase(plan: PlanInfo): Promise<{ ok: boolean; error?: string }> {
  if (mode === 'native' && Purchases && plan.pkg) {
    try {
      const { customerInfo } = await Purchases.purchasePackage(plan.pkg);
      applyCustomerInfo(customerInfo);
      return { ok: hasProEntitlement(customerInfo?.entitlements?.active) };
    } catch (e) {
      const err = e as { userCancelled?: boolean; message?: string };
      if (err.userCancelled) return { ok: false };
      return { ok: false, error: err.message ?? 'Purchase failed.' };
    }
  }
  if (mode === 'mock') {
    // Simulate a successful sandbox purchase, clearly labeled in the UI.
    useApp.getState().setPro(true, 'mock');
    return { ok: true };
  }
  return { ok: false, error: 'Purchases are not available in this build.' };
}

export async function restore(): Promise<{ ok: boolean; error?: string }> {
  if (mode === 'native' && Purchases) {
    try {
      applyCustomerInfo(await Purchases.restorePurchases());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? 'Restore failed.' };
    }
  }
  if (mode === 'mock') return { ok: true }; // local entitlement already reflects reality
  return { ok: false, error: 'Purchases are not available in this build.' };
}
