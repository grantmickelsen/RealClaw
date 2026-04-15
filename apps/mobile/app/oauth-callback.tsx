/**
 * Handles the realclaw://oauth/success deep link.
 * This screen is shown briefly when the OAuth flow redirects back to the app.
 */
import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useIntegrationsStore } from '../store/integrations';
import { authedFetch } from '../lib/api';

export default function OAuthCallbackScreen() {
  const params = useLocalSearchParams<{ integration?: string; success?: string }>();
  const { setStatuses } = useIntegrationsStore();

  useEffect(() => {
    // Refresh integration statuses after OAuth completes
    authedFetch('/v1/integrations')
      .then(res => res.ok ? res.json() as Promise<{ integrations: Parameters<typeof setStatuses>[0] }> : null)
      .then(data => { if (data) setStatuses(data.integrations); })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => router.replace('/(main)/settings'), 1500);
      });
  }, [setStatuses]);

  const integrationName = params.integration ?? 'integration';
  const success = params.success !== 'false';

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{success ? '✅' : '❌'}</Text>
      <Text style={styles.title}>
        {success ? `${integrationName} connected!` : 'Connection failed'}
      </Text>
      <ActivityIndicator color="#0066FF" style={styles.loader} />
      <Text style={styles.subtitle}>Returning to settings…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 24 },
  loader: { marginBottom: 16 },
  subtitle: { fontSize: 15, color: '#888' },
});
