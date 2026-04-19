import { Stack, Redirect } from 'expo-router';
import type { Href } from 'expo-router';
import { useAuthStore } from '../../store/auth';
import { usePreferencesStore } from '../../store/preferences';

export default function AuthLayout() {
  const status = useAuthStore(s => s.status);
  const prefStatus = usePreferencesStore(s => s.status);
  const onboardingDone = usePreferencesStore(s => s.onboardingDone);

  if (status === 'authenticated') {
    if (prefStatus === 'loading') return null;  // wait for prefs to load
    if (!onboardingDone) return <Redirect href={'/onboarding' as Href} />;
    return <Redirect href="/(main)/chat" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
