import { create } from 'zustand';
import { authedFetch } from '../lib/api';
import { getCustomerInfo, hasProfessionalEntitlement, addPurchaseListener, isBypassEnabled } from '../lib/purchases';

// ─── Types ─────────────────────────���───────────────────────────────���──────────

export type SubscriptionTier = 'starter' | 'professional' | 'brokerage';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused';

interface SubscriptionResponse {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  expiresAt: string | null;
  trialEndsAt: string | null;
  isTrialing: boolean;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface SubscriptionState {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  expiresAt: string | null;
  trialEndsAt: string | null;
  isTrialing: boolean;
  loading: boolean;

  /** Dev-only override — set via the hidden developer menu in settings. */
  devTierOverride: SubscriptionTier | null;

  /**
   * True when the user has active Professional (or higher) access.
   * Reads devTierOverride when set; otherwise derived from tier + status.
   * This is the single boolean all feature gates read.
   */
  isProfessional: boolean;

  /** Fetch current subscription state from /v1/subscription and RevenueCat. */
  loadSubscription(): Promise<void>;

  /** Called after a purchase event to refresh state from RevenueCat + backend. */
  syncAfterPurchase(): Promise<void>;

  /** DEV ONLY — override tier locally without a backend call. */
  setDevOverride(tier: SubscriptionTier | null): void;

  /** Remove purchase listener (call on unmount of root layout). */
  _unsubscribePurchaseListener: (() => void) | null;
  _setupPurchaseListener(): void;
}

function deriveIsProfessional(
  tier: SubscriptionTier,
  status: SubscriptionStatus,
  devOverride: SubscriptionTier | null,
): boolean {
  if (isBypassEnabled()) return true;
  const effectiveTier = devOverride ?? tier;
  const isActive =
    status === 'trialing' || status === 'active' || status === 'past_due';
  return isActive && (effectiveTier === 'professional' || effectiveTier === 'brokerage');
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  tier: 'professional',           // default to professional until /v1/subscription returns
  status: 'trialing',
  expiresAt: null,
  trialEndsAt: null,
  isTrialing: true,
  loading: false,
  devTierOverride: null,
  isProfessional: true,           // optimistic until first load
  _unsubscribePurchaseListener: null,

  async loadSubscription() {
    set({ loading: true });
    let backendLoaded = false;
    let backendStatus: SubscriptionStatus | null = null;

    try {
      const res = await authedFetch('/v1/subscription');
      if (res.ok) {
        const data = (await res.json()) as SubscriptionResponse;
        const isPro = deriveIsProfessional(data.tier, data.status, get().devTierOverride);
        set({
          tier: data.tier,
          status: data.status,
          expiresAt: data.expiresAt,
          trialEndsAt: data.trialEndsAt,
          isTrialing: data.isTrialing,
          isProfessional: isPro,
          loading: false,
        });
        backendLoaded = true;
        backendStatus = data.status;
      }
    } catch {
      // Network error — leave existing state
    } finally {
      set({ loading: false });
    }

    // Cross-check with RevenueCat SDK.
    // RC is used to grant access when the backend fails (e.g. network error).
    // RC is NOT used to override a definitive backend cancellation — doing so
    // would allow cancelled users to retain access during the SDK cache window.
    const info = await getCustomerInfo();
    if (info && hasProfessionalEntitlement(info)) {
      const definitivelyInactive = backendLoaded &&
        (backendStatus === 'cancelled' || backendStatus === 'paused');
      if (!definitivelyInactive) {
        set(s => ({
          isProfessional: s.isProfessional || deriveIsProfessional('professional', 'active', s.devTierOverride),
        }));
      }
    }
  },

  async syncAfterPurchase() {
    // After a purchase completes the backend webhook fires asynchronously.
    // Give it a moment, then reload from both sources.
    await new Promise(r => setTimeout(r, 1500));
    await get().loadSubscription();
  },

  setDevOverride(tier: SubscriptionTier | null) {
    const s = get();
    set({
      devTierOverride: tier,
      isProfessional: deriveIsProfessional(
        tier ?? s.tier,
        s.status,
        tier,
      ),
    });
  },

  _setupPurchaseListener() {
    const unsub = addPurchaseListener(() => {
      void get().syncAfterPurchase();
    });
    set({ _unsubscribePurchaseListener: unsub });
  },
}));
