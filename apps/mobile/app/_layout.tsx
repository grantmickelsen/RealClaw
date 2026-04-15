import { useEffect, useCallback } from 'react';
import { SplashScreen, Stack, Redirect } from 'expo-router';
import { useAuthStore } from '../store/auth';
import { useWsStore } from '../store/ws';
import { loadStoredTokens, storeTokens } from '../lib/auth';
import { connect as wsConnect, disconnect as wsDisconnect } from '../lib/ws';
import { setupNotificationHandlers } from '../lib/push';
import { enforceDeviceIntegrity } from '../lib/security';
import { useAppState } from '../hooks/useAppState';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { status, setTokens, clearTokens } = useAuthStore();
  const wsStatus = useWsStore(s => s.status);

  const handleForeground = useCallback(async () => {
    const compromised = await enforceDeviceIntegrity();
    if (compromised) clearTokens();
  }, [clearTokens]);

  useAppState(handleForeground);

  useEffect(() => {
    async function init() {
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
      await setupNotificationHandlers();
      SplashScreen.hideAsync();
    }
    init();
  }, [setTokens, clearTokens]);

  useEffect(() => {
    if (status === 'authenticated' && wsStatus === 'disconnected') {
      wsConnect();
    } else if (status === 'unauthenticated' && wsStatus !== 'disconnected') {
      wsDisconnect();
    }
  }, [status, wsStatus]);

  if (status === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {status === 'unauthenticated' ? (
        <>
          <Stack.Screen name="(auth)" />
          <Redirect href="/(auth)/sign-in" />
        </>
      ) : (
        <>
          <Stack.Screen name="(main)" />
          <Stack.Screen name="approval/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="oauth-callback" options={{ presentation: 'modal' }} />
        </>
      )}
    </Stack>
  );
}
