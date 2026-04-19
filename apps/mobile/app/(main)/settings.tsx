import { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import { useAuthStore } from '../../store/auth';
import { useIntegrationsStore } from '../../store/integrations';
import { usePreferencesStore } from '../../store/preferences';
import { clearStoredTokens } from '../../lib/auth';
import { authedFetch } from '../../lib/api';
import { IntegrationRow } from '../../components/IntegrationRow';
import { API_BASE_URL } from '../../constants/api';

// ─── Editable row ─────────────────────────────────────────────────────────────

function EditableRow({
  label,
  value,
  placeholder,
  onSave,
  keyboardType = 'default',
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onSave: (v: string) => Promise<void>;
  keyboardType?: 'default' | 'phone-pad' | 'numeric';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch {
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <View style={styles.editRow}>
        <Text style={styles.rowLabel}>{label}</Text>
        <View style={styles.editControls}>
          <TextInput
            style={styles.inlineInput}
            value={draft}
            onChangeText={setDraft}
            keyboardType={keyboardType}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
          <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>{saving ? '…' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setDraft(value ?? ''); setEditing(false); }}>
            <Text style={styles.cancelText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.row} onPress={() => { setDraft(value ?? ''); setEditing(true); }}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={value ? styles.rowValue : styles.rowValueEmpty}>
        {value || placeholder}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { clearTokens, tenantId } = useAuthStore();
  const { statuses, setStatuses } = useIntegrationsStore();
  const { displayName, brokerage, phone, primaryZip, llmTier, setPreferences } = usePreferencesStore();

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await authedFetch('/v1/integrations');
      if (res.ok) {
        const data = await res.json() as { integrations: typeof statuses };
        setStatuses(data.integrations);
      }
    } catch { /* show stale data */ }
  }, [setStatuses]);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  // Generic preference saver
  const savePref = async (updates: Record<string, unknown>) => {
    await authedFetch('/v1/preferences', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    setPreferences(updates as Parameters<typeof setPreferences>[0]);
  };

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

        {/* ── My Profile ── */}
        <Text style={styles.sectionHeader}>My Profile</Text>
        <View style={styles.card}>
          <EditableRow
            label="Name"
            value={displayName}
            placeholder="Add your name"
            onSave={v => savePref({ displayName: v })}
          />
          <View style={styles.divider} />
          <EditableRow
            label="Brokerage"
            value={brokerage}
            placeholder="Add your brokerage"
            onSave={v => savePref({ brokerage: v })}
          />
          <View style={styles.divider} />
          <EditableRow
            label="Phone"
            value={phone}
            placeholder="Add phone number"
            keyboardType="phone-pad"
            onSave={v => savePref({ phone: v })}
          />
          <View style={styles.divider} />
          <EditableRow
            label="Primary Market ZIP"
            value={primaryZip}
            placeholder="5-digit ZIP"
            keyboardType="numeric"
            onSave={async v => {
              if (v && !/^\d{5}$/.test(v)) {
                Alert.alert('Invalid ZIP', 'Please enter a 5-digit ZIP code.');
                throw new Error('invalid zip');
              }
              await savePref({ primaryZip: v || undefined });
            }}
          />
        </View>

        {/* ── AI Quality ── */}
        <Text style={styles.sectionHeader}>AI Quality</Text>
        <View style={styles.card}>
          {(['fast', 'balanced', 'best'] as const).map((tier, i, arr) => (
            <View key={tier}>
              <TouchableOpacity
                style={styles.tierRow}
                onPress={() => savePref({ llmTier: tier })}
              >
                <View>
                  <Text style={[styles.tierLabel, llmTier === tier && styles.tierLabelActive]}>
                    {tier === 'fast' ? '⚡ Fast' : tier === 'balanced' ? '⚖️ Balanced' : '🧠 Best'}
                  </Text>
                  <Text style={styles.tierDesc}>
                    {tier === 'fast'
                      ? 'Quick responses, great for real-time help'
                      : tier === 'balanced'
                      ? 'Smart and responsive — the default'
                      : 'Maximum quality for important communications'}
                  </Text>
                </View>
                {llmTier === tier && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {/* ── Integrations ── */}
        <Text style={styles.sectionHeader}>Integrations</Text>
        {statuses.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No integrations configured</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {statuses.map((s, i) => (
              <View key={s.id}>
                <IntegrationRow integration={s} onConnect={handleConnect} />
                {i < statuses.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        )}

        {/* ── Account ── */}
        <Text style={styles.sectionHeader}>Account</Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* ── Developer (dev builds only) ── */}
        {__DEV__ && (
          <>
            <Text style={styles.sectionHeader}>Developer</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  Alert.alert(
                    'Reset Onboarding',
                    'This will clear onboarding state and take you back to the setup wizard.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Reset',
                        style: 'destructive',
                        onPress: async () => {
                          await authedFetch('/v1/preferences', {
                            method: 'PUT',
                            body: JSON.stringify({ onboardingDone: false }),
                          });
                          setPreferences({ onboardingDone: false });
                          router.replace('/onboarding' as Href);
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={styles.rowLabel}>Reset Onboarding</Text>
                <Text style={styles.rowValue}>→</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  header: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
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
  card: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#e0e0e0', marginLeft: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  editRow: { paddingHorizontal: 16, paddingVertical: 12 },
  rowLabel: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  rowValue: { fontSize: 15, color: '#0066FF' },
  rowValueEmpty: { fontSize: 15, color: '#bbb' },
  editControls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  inlineInput: {
    flex: 1,
    backgroundColor: '#f5f5fa',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#1a1a1a',
  },
  saveBtn: {
    backgroundColor: '#0066FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cancelText: { color: '#aaa', fontSize: 18, paddingHorizontal: 4 },
  tierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  tierLabel: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 2 },
  tierLabelActive: { color: '#0066FF' },
  tierDesc: { fontSize: 13, color: '#888' },
  checkmark: { fontSize: 18, color: '#0066FF', fontWeight: '700' },
  empty: { paddingHorizontal: 16, paddingVertical: 16 },
  emptyText: { fontSize: 15, color: '#aaa' },
  signOutButton: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
  },
  signOutText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
