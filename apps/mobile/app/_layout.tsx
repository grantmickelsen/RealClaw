import '../global.css';
import { useEffect, useCallback } from 'react';
import { Stack, Redirect } from 'expo-router';
import { useAuthStore } from '../store/auth';
import { useWsStore } from '../store/ws';
import { loadStoredTokens, storeTokens } from '../lib/auth';
import { connect as wsConnect, disconnect as wsDisconnect } from '../lib/ws';
import { enforceDeviceIntegrity } from '../lib/security';
import { useAppState } from '../hooks/useAppState';

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
  }, [setTokens, clearTokens]);

  useEffect(() => {
    if (status === 'authenticated' && wsStatus === 'disconnected') {
      wsConnect();
    } else if (status === 'unauthenticated' && wsStatus !== 'disconnected') {
      wsDisconnect();
    }
  }, [status, wsStatus]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(main)" />
        <Stack.Screen name="approval/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="oauth-callback" options={{ presentation: 'modal' }} />
      </Stack>
      {status !== 'authenticated' && <Redirect href="/(auth)/sign-in" />}
      {status === 'authenticated' && <Redirect href="/(main)/chat" />}
    </>
  );
}
