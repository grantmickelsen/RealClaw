import { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/auth';
import { useIntegrationsStore } from '../../store/integrations';
import { clearStoredTokens } from '../../lib/auth';
import { authedFetch } from '../../lib/api';
import { IntegrationRow } from '../../components/IntegrationRow';
import { API_BASE_URL } from '../../constants/api';

export default function SettingsScreen() {
  const { clearTokens, tenantId } = useAuthStore();
  const { statuses, setStatuses } = useIntegrationsStore();

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await authedFetch('/v1/integrations');
      if (res.ok) {
        const data = await res.json() as { integrations: typeof statuses };
        setStatuses(data.integrations);
      }
    } catch {
      // ignore — show stale data
    }
  }, [setStatuses]);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  async function handleSignOut() {
    Alert.alert(
      'Sign Out',
      'Sign out from all devices?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await authedFetch('/v1/auth/revoke', { method: 'POST' });
            } catch { /* best-effort */ }
            await clearStoredTokens();
            clearTokens();
          },
        },
      ],
    );
  }

  function handleConnect(integrationId: string) {
    const url = `${API_BASE_URL}/oauth/connect/${integrationId}`;
    Linking.openURL(url);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          {tenantId && <Text style={styles.tenantId}>Tenant: {tenantId}</Text>}
        </View>

        <Text style={styles.sectionHeader}>Integrations</Text>
        {statuses.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No integrations configured</Text>
          </View>
        ) : (
          statuses.map(s => (
            <IntegrationRow key={s.id} integration={s} onConnect={handleConnect} />
          ))
        )}

        <Text style={styles.sectionHeader}>Account</Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  tenantId: { fontSize: 13, color: '#888', marginTop: 4 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empty: { paddingHorizontal: 16, paddingVertical: 16 },
  emptyText: { fontSize: 15, color: '#aaa' },
  signOutButton: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
  },
  signOutText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
