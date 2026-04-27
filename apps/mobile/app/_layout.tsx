import '../global.css';
import { useEffect, useCallback } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../store/auth';
import { usePreferencesStore } from '../store/preferences';
import { useSubscriptionStore } from '../store/subscription';
import { loadStoredTokens, storeTokens } from '../lib/auth';
import { connect as wsConnect, disconnect as wsDisconnect } from '../lib/ws';
import { enforceDeviceIntegrity } from '../lib/security';
import { authedFetch } from '../lib/api';
import { initPurchases } from '../lib/purchases';
import { useAppState } from '../hooks/useAppState';

export default function RootLayout() {
  const status = useAuthStore(s => s.status);
  const tenantId = useAuthStore(s => s.tenantId);
  const setTokens = useAuthStore(s => s.setTokens);
  const clearTokens = useAuthStore(s => s.clearTokens);
  const setPreferences = usePreferencesStore(s => s.setPreferences);
  const clearPreferences = usePreferencesStore(s => s.clear);
  const loadSubscription = useSubscriptionStore(s => s.loadSubscription);
  const setupPurchaseListener = useSubscriptionStore(s => s._setupPurchaseListener);
  const unsubscribePurchaseListener = useSubscriptionStore(s => s._unsubscribePurchaseListener);

  const handleForeground = useCallback(async () => {
    const compromised = await enforceDeviceIntegrity();
    if (compromised) clearTokens();
  }, [clearTokens]);

  useAppState(handleForeground);

  // Bootstrap once: read persisted tokens and set auth status
  useEffect(() => {
    async function init() {
      try {
        const compromised = await enforceDeviceIntegrity();
        if (!compromised) {
          const tokens = await loadStoredTokens();
          if (tokens) {
            setTokens(tokens);
            await storeTokens(tokens);
          } else {
            clearTokens();
          }
        } else {
          clearTokens();
        }
        try {
          const { setupNotificationHandlers } = await import('../lib/push');
          await setupNotificationHandlers();
        } catch {}
      } catch (err) {
        console.error('[RootLayout] init failed:', err);
        clearTokens();
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket lifecycle: connect when authenticated, disconnect when not
  useEffect(() => {
    if (status === 'authenticated') {
      wsConnect();
    } else if (status === 'unauthenticated') {
      wsDisconnect();
    }
  }, [status]);

  // RevenueCat + subscription lifecycle
  useEffect(() => {
    if (status === 'authenticated' && tenantId) {
      initPurchases(tenantId);
      void loadSubscription();
      setupPurchaseListener();
    }
    return () => {
      if (status === 'unauthenticated' && unsubscribePurchaseListener) {
        unsubscribePurchaseListener();
      }
    };
  }, [status, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preferences lifecycle: fetch when authenticated, clear when signed out
  useEffect(() => {
    if (status === 'authenticated') {
      authedFetch('/v1/preferences')
        .then(r => r.json())
        .then((d: {
          primaryZip?: string | null;
          displayName?: string | null;
          brokerage?: string | null;
          phone?: string | null;
          llmTier?: 'fast' | 'balanced' | 'best';
          tonePrefs?: Record<string, unknown>;
          onboardingDone?: boolean;
        }) => setPreferences({ ...d, status: 'loaded' }))
        .catch(() => setPreferences({ status: 'loaded' }));
    } else if (status === 'unauthenticated') {
      clearPreferences();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(main)" />
        <Stack.Screen name="approval/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="oauth-callback" options={{ presentation: 'modal' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
