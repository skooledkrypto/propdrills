import { describe, expect, it } from 'vitest';
import { hasProEntitlement, inferPlanTier } from '../entitlement';

describe('hasProEntitlement', () => {
  it("accepts 'pro' or any active entitlement (single-tier product)", () => {
    expect(hasProEntitlement({ pro: {} })).toBe(true);
    expect(hasProEntitlement({ 'Prop Drills Pro': {} })).toBe(true);
    expect(hasProEntitlement({})).toBe(false);
    expect(hasProEntitlement(null)).toBe(false);
    expect(hasProEntitlement(undefined)).toBe(false);
  });
});

describe('inferPlanTier', () => {
  it('maps standardized RevenueCat package identifiers (web + mobile forms)', () => {
    expect(inferPlanTier('$rc_monthly', 'whatever')).toBe('monthly');
    expect(inferPlanTier('$rc_annual', 'whatever')).toBe('annual');
    expect(inferPlanTier('$rc_lifetime', 'whatever')).toBe('lifetime');
    expect(inferPlanTier('MONTHLY', 'x')).toBe('monthly');
    expect(inferPlanTier('ANNUAL', 'x')).toBe('annual');
    expect(inferPlanTier('LIFETIME', 'x')).toBe('lifetime');
  });

  it('falls back to product-id heuristics for custom packages', () => {
    // the actual products configured in the dashboard (2026-08-05)
    expect(inferPlanTier('CUSTOM', 'Prop_Drills_Pro')).toBe('monthly');
    expect(inferPlanTier('CUSTOM', 'Prop_Drills_Pro_Yearly')).toBe('annual');
    expect(inferPlanTier('CUSTOM', 'Prop_Drills_Pro_Lifetime')).toBe('lifetime');
    expect(inferPlanTier('', 'propdrills_pro_annual')).toBe('annual');
    expect(inferPlanTier('', 'unknown_product')).toBe('monthly');
  });
});
