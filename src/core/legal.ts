/**
 * Canonical Terms of Use and Privacy Policy text, bundled into both apps so
 * legal pages always work in-app (App Review requires reachable terms/privacy;
 * the GitHub repo is private, so external links there would 404 for users).
 *
 * docs/TERMS.md and docs/PRIVACY.md are the human-readable copies for public
 * hosting — keep them in sync with this file whenever either changes.
 */

export const LEGAL_LAST_UPDATED = '2026-08-17';

export const SUPPORT_EMAIL = 'propdrills@gmail.com';

export const TERMS_TEXT = `PropDrills — Terms of Use
Last updated: ${LEGAL_LAST_UPDATED}

1. Education only. PropDrills is a simulated-trading education tool. It provides no financial, investment, or trading advice, no brokerage services, and no real-money trading. Nothing in the app is a recommendation to buy or sell any financial instrument.

2. Simulated results. All drills, challenges, statistics, and profit/loss figures are simulated or hypothetical. Simulated performance does not reflect, predict, or guarantee real trading results. Trading futures involves substantial risk of loss and is not suitable for everyone.

3. No affiliation. PropDrills is not affiliated with, endorsed by, or connected to any proprietary trading firm, exchange, or broker. Challenge rule presets are generic examples and do not represent any real firm's evaluation.

4. Subscriptions and purchases. Paid subscriptions auto-renew until cancelled in your App Store, Google Play, or web billing account settings. Payment is charged to your store account at purchase confirmation. If a free trial is ever offered, it converts to a paid subscription unless cancelled at least 24 hours before the trial ends. "Lifetime" is a one-time purchase, not a subscription. Prices may change with notice; changes never apply retroactively to a completed purchase.

5. Acceptable use. You may use the app for personal, non-commercial training. Don't reverse-engineer, resell, scrape, or misrepresent the app or its output, and don't present simulated results as real trading performance.

6. Your content and data. Your training progress is stored on your device (see the Privacy Policy). You are responsible for backups you export.

7. Changes to the app or these terms. Features may change, be added, or be removed over time. If these terms change materially, the "Last updated" date above changes and the new terms apply from your next use of the app.

8. Warranty and liability. The app is provided "as is" without warranties of any kind. To the maximum extent permitted by law, the developer is not liable for any losses — including trading losses — arising from use of the app.

9. Contact. Questions about these terms: ${SUPPORT_EMAIL}`;

export const PRIVACY_TEXT = `PropDrills — Privacy Policy
Last updated: ${LEGAL_LAST_UPDATED}

Your training data stays on your device. Drill progress, challenge history, settings, and your optional display name are stored locally (browser IndexedDB/localStorage on web, AsyncStorage on mobile). PropDrills has no email or password accounts, no analytics SDKs, no advertising, and no tracking. The app does not collect, sell, or share personal data.

Purchases. If you buy PropDrills Pro, the purchase is processed by Apple, Google, or Stripe, and subscription status is managed by RevenueCat using a random anonymous app user ID. We never see your name, email, or payment details. RevenueCat processes purchase history and the anonymous ID to deliver your entitlement; see RevenueCat's privacy policy (revenuecat.com/privacy) for details.

Cloud Sync (optional). If you turn on Cloud Sync, your progress backup (drill progress, challenge history, settings, optional display name, and the anonymous purchase ID) is stored on our servers keyed to a random sync code that only you hold — no email, no password, and nothing that identifies you personally. The cloud copy exists solely so your own devices can share progress and purchases; it is never used for anything else. "Delete cloud account" in Settings erases it immediately and permanently. If you never turn on Cloud Sync, nothing is uploaded.

Backups. Progress backups you export are plain files under your control; outside of optional Cloud Sync, the app never uploads them anywhere.

Notifications. Daily practice reminders are scheduled locally on your device. No push-notification service is used and nothing leaves your phone.

Data deletion. On-device data is in your hands: use "Reset all progress & stats" in Settings, or uninstall the app. If you used Cloud Sync, "Delete cloud account" in Settings erases the cloud copy. For purchase records, manage your account with Apple or Google directly.

Children. PropDrills is not directed at children under 13 and does not knowingly collect data from anyone (it collects no personal data at all).

Changes. If this policy changes materially, the "Last updated" date above changes.

Contact. Privacy questions: ${SUPPORT_EMAIL}`;
