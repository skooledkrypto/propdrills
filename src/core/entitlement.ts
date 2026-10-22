import { ACCOUNT_SIZES, type AccountSize, type ScenarioType } from './challenge';

/**
 * Freemium gating — pure logic shared by web and mobile. Platform layers
 * (RevenueCat adapters) decide WHETHER the user is pro; this module decides
 * WHAT pro means. Keep every gate here so the rules never drift between
 * platforms.
 */

/** The single RevenueCat entitlement identifier. */
export const ENTITLEMENT_ID = 'pro';

/**
 * Is this RevenueCat `entitlements.active` map "Pro"? PropDrills is a
 * single-tier product, so ANY active entitlement counts — the dashboard's
 * entitlement is free to be named 'pro', 'Prop Drills Pro', or anything else
 * without stranding paying customers.
 */
export function hasProEntitlement(active: Record<string, unknown> | null | undefined): boolean {
  if (!active) return false;
  return Boolean(active[ENTITLEMENT_ID]) || Object.keys(active).length > 0;
}

/**
 * Canonical App Store product IDs (as actually created in App Store Connect,
 * 2026-08-05). Documentation only — matching does not depend on these:
 * inferPlanTier() resolves whatever is configured in the dashboards (the
 * RevenueCat Test Store uses Prop_Drills_Pro / _Yearly / _Lifetime).
 * No free trial is offered; trial display is driven entirely by store data.
 */
export const PRODUCT_IDS = {
  monthly: 'propdrills_pro_monthly',
  annual: 'propdrills_pro_yearly',
  lifetime: 'propdrills_pro_lifetime',
} as const;

export type PlanTier = 'monthly' | 'annual' | 'lifetime';

/**
 * Map a RevenueCat package to a plan tier. Prefers the standardized package
 * identifier/type ('$rc_annual' on web, 'ANNUAL' on mobile…), falling back to
 * heuristics on the store product id — so whatever products are actually
 * configured in the dashboard (e.g. 'Prop_Drills_Pro_Yearly') resolve without
 * the app depending on exact product naming.
 */
export function inferPlanTier(packageId: string, productId: string): PlanTier {
  const pk = packageId.toLowerCase();
  if (pk.includes('annual') || pk.includes('year')) return 'annual';
  if (pk.includes('lifetime')) return 'lifetime';
  if (pk.includes('month')) return 'monthly';
  const pr = productId.toLowerCase();
  if (pr.includes('annual') || pr.includes('year')) return 'annual';
  if (pr.includes('life')) return 'lifetime';
  return 'monthly';
}

/**
 * Feature flag for A/B-ing the paywall layout. 'monthly-first' leads with the
 * low-commitment monthly plan; 'lifetime-first' leads with the one-time
 * unlock. Flip here (or override via remote config later).
 */
export type PaywallVariant = 'monthly-first' | 'lifetime-first';
export const PAYWALL_VARIANT: PaywallVariant = 'monthly-first';

/** Free users get a taste: this many Challenge Mode attempts, ever. */
export const FREE_CHALLENGE_ATTEMPTS = 2;

/** Free users can only run the $50k evaluation. */
export const FREE_ACCOUNT_SIZES: AccountSize[] = [50000];

/** How much history/analytics free users see. */
export const FREE_HISTORY_LIMIT = 3;

export type GateReason = 'attempt-limit' | 'account-size' | 'scenario-picker' | 'history';

export interface GateResult {
  allowed: boolean;
  reason?: GateReason;
}

export function canStartChallenge(isPro: boolean, attemptsUsed: number): GateResult {
  if (isPro || attemptsUsed < FREE_CHALLENGE_ATTEMPTS) return { allowed: true };
  return { allowed: false, reason: 'attempt-limit' };
}

export function canUseAccountSize(isPro: boolean, size: AccountSize): GateResult {
  if (isPro || FREE_ACCOUNT_SIZES.includes(size)) return { allowed: true };
  return { allowed: false, reason: 'account-size' };
}

/** Scenario picker (trend/chop/spike/reversal) is pro; free runs random tape. */
export function canPickScenario(isPro: boolean, scenario: ScenarioType | null): GateResult {
  if (isPro || scenario === null) return { allowed: true };
  return { allowed: false, reason: 'scenario-picker' };
}

export function visibleHistoryCount(isPro: boolean, total: number): number {
  return isPro ? total : Math.min(total, FREE_HISTORY_LIMIT);
}

export function accountSizeChoices(isPro: boolean): { size: AccountSize; locked: boolean }[] {
  return ACCOUNT_SIZES.map((size) => ({ size, locked: !canUseAccountSize(isPro, size).allowed }));
}

/** Attempts used = finished attempts of any result (abandons count — the tape was consumed). */
export function challengeAttemptsUsed(results: { result: string }[]): number {
  return results.length;
}
