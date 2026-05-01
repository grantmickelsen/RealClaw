/**
 * RevenueCat SDK wrapper
 *
 * All RevenueCat interactions go through this module.  The rest of the app
 * imports from here — never from react-native-purchases directly — so mocking
 * and testing stay easy.
 *
 * Product IDs defined in RevenueCat dashboard (must match App Store Connect
 * and Google Play Console):
 *   rc_professional_monthly  — $79.99/mo with 14-day free trial
 *   rc_professional_annual   — $828.00/yr with 14-day free trial (~$69/mo)
 *   rc_brokerage_monthly     — negotiated pricing (future)
 *
 * Developer bypass:
 *   Set EXPO_PUBLIC_BYPASS_PAYWALL=true in .env.local to skip all RevenueCat
 *   calls and treat every user as Professional (for Expo Go / CI testing).
 */

import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type {
  CustomerInfo,
  Offerings,
  PurchasesPackage,
} from 'react-native-purchases';
import { Platform } from 'react-native';

// ─── Constants ────────────────────────────────────────────────────────────────

/** RevenueCat app API keys — set in app.config.js extra or env */
const RC_API_KEY_IOS = process.env.EXPO_PUBLIC_RC_API_KEY_IOS ?? '';
const RC_API_KEY_ANDROID = process.env.EXPO_PUBLIC_RC_API_KEY_ANDROID ?? '';

/** The RevenueCat entitlement that grants Professional access */
export const PROFESSIONAL_ENTITLEMENT = 'professional';

/** Product IDs for our offerings */
export const PRODUCT_IDS = {
  monthlyProfessional: 'rc_professional_monthly',
  annualProfessional: 'rc_professional_annual',
} as const;

// ─── Dev bypass ───────────────────────────────────────────────────────────────

export function isBypassEnabled(): boolean {
  return process.env.EXPO_PUBLIC_BYPASS_PAYWALL === 'true';
}

// ─── Initialization ───────────────────────────────────────────────────────────

let initialized = false;

/**
 * Initialize the RevenueCat SDK.
 * Call once after the user authenticates, passing their tenant/user ID.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initPurchases(userId: string): void {
  if (isBypassEnabled() || initialized) return;

  const apiKey = Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID;
  if (!apiKey) {
    console.warn('[Purchases] API key not configured — RevenueCat disabled');
    return;
  }

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  Purchases.configure({ apiKey, appUserID: userId });
  initialized = true;
}

// ─── Offerings ────────────────────────────────────────────────────────────────

/**
 * Fetch the current RevenueCat offerings.
 * Returns null when the SDK is not configured or bypass is active.
 */
export async function getOfferings(): Promise<Offerings | null> {
  if (isBypassEnabled()) return null;
  try {
    return await Purchases.getOfferings();
  } catch (err) {
    console.warn('[Purchases] getOfferings failed:', err);
    return null;
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

/**
 * Purchase a package.  Returns updated CustomerInfo on success.
 * Throws on user cancellation (check for PurchasesErrorCode.PurchaseCancelledError).
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const result = await Purchases.purchasePackage(pkg);
  return result.customerInfo;
}

// ─── Restore ──────────────────────────────────────────────────────────────────

/** Restore previous purchases (required button by App Store guidelines). */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

// ─── Customer info ────────────────────────────────────────────────────────────

/**
 * Get the latest CustomerInfo from RevenueCat.
 * Returns null when bypass is enabled.
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (isBypassEnabled()) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (err) {
    console.warn('[Purchases] getCustomerInfo failed:', err);
    return null;
  }
}

// ─── Entitlement check ────────────────────────────────────────────────────────

/**
 * Returns true if the CustomerInfo includes an active Professional entitlement.
 * Always returns true when EXPO_PUBLIC_BYPASS_PAYWALL is set.
 */
export function hasProfessionalEntitlement(info: CustomerInfo | null): boolean {
  if (isBypassEnabled()) return true;
  if (!info) return false;
  return !!info.entitlements.active[PROFESSIONAL_ENTITLEMENT];
}

// ─── Listener ────────────────────────────────────────────────────────────────

/**
 * Subscribe to CustomerInfo updates (e.g., after a purchase completes in the
 * background).  Returns an unsubscribe function.
 */
export function addPurchaseListener(
  callback: (info: CustomerInfo) => void,
): () => void {
  if (isBypassEnabled()) return () => {};
  const listener = Purchases.addCustomerInfoUpdateListener(callback);
  // Expo Go browser mode returns a listener without .remove() — guard defensively
  return () => { if (listener && typeof (listener as { remove?: () => void }).remove === 'function') (listener as { remove: () => void }).remove(); };
}
