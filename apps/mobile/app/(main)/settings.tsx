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
  Modal,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../../store/auth';
import { useIntegrationsStore } from '../../store/integrations';
import { usePreferencesStore, DEFAULT_AUTO_APPROVAL_SETTINGS, type AutoApprovalSettings } from '../../store/preferences';
import { useKioskStore, KIOSK_BIOMETRIC_KEY } from '../../store/kiosk';
import { useSubscriptionStore } from '../../store/subscription';
import { clearStoredTokens } from '../../lib/auth';
import { authedFetch } from '../../lib/api';
import { IntegrationRow } from '../../components/IntegrationRow';
import { API_BASE_URL } from '../../constants/api';

const PIN_STORE_KEY = 'claw_kiosk_pin';

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

// ─── Kiosk PIN modal ──────────────────────────────────────────────────────────

function KioskPinModal({ visible, onDone }: { visible: boolean; onDone(): void }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (visible) { setPin(''); setConfirm(''); setError(''); } }, [visible]);

  async function save() {
    if (pin.length !== 4) { setError('PIN must be 4 digits'); return; }
    if (pin !== confirm)  { setError('PINs do not match');    return; }
    setSaving(true);
    await SecureStore.setItemAsync(PIN_STORE_KEY, pin);
    setSaving(false);
    Alert.alert('PIN Updated', 'Your kiosk PIN has been saved.');
    onDone();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={pinModalStyles.overlay}>
        <View style={pinModalStyles.box}>
          <Text style={pinModalStyles.title}>Set Kiosk PIN</Text>
          <Text style={pinModalStyles.hint}>Enter a 4-digit PIN for Kiosk agent mode</Text>
          <TextInput
            style={pinModalStyles.input}
            value={pin}
            onChangeText={v => { setPin(v.replace(/\D/g, '').slice(0, 4)); setError(''); }}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="• • • •"
            placeholderTextColor="#ccc"
            maxLength={4}
            autoFocus
          />
          <TextInput
            style={pinModalStyles.input}
            value={confirm}
            onChangeText={v => { setConfirm(v.replace(/\D/g, '').slice(0, 4)); setError(''); }}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="Confirm PIN"
            placeholderTextColor="#ccc"
            maxLength={4}
          />
          {error ? <Text style={pinModalStyles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[pinModalStyles.btn, (pin.length < 4 || saving) && pinModalStyles.btnDisabled]}
            onPress={save}
            disabled={pin.length < 4 || saving}
          >
            <Text style={pinModalStyles.btnText}>{saving ? 'Saving…' : 'Save PIN'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDone} style={pinModalStyles.cancel}>
            <Text style={pinModalStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinSet, setPinSet] = useState(false);

  const requireBiometric = useKioskStore(s => s.requireBiometricForKiosk);
  const setRequireBiometric = useKioskStore(s => s.setRequireBiometric);

  const subscriptionTier   = useSubscriptionStore(s => s.tier);
  const subscriptionStatus = useSubscriptionStore(s => s.status);
  const isTrialing         = useSubscriptionStore(s => s.isTrialing);
  const trialEndsAt        = useSubscriptionStore(s => s.trialEndsAt);
  const setDevOverride     = useSubscriptionStore(s => s.setDevOverride);
  const devTierOverride    = useSubscriptionStore(s => s.devTierOverride);

  const { clearTokens, tenantId, accessToken } = useAuthStore();
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailAddress, setGmailAddress] = useState<string | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const { statuses, setStatuses } = useIntegrationsStore();
  const { displayName, brokerage, phone, primaryZip, llmTier, toneAnalyzedAt, autoApprovalSettings, setPreferences } = usePreferencesStore();
  const [toneAnalyzing, setToneAnalyzing] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(PIN_STORE_KEY).then(v => setPinSet(!!v)).catch(() => {});
    SecureStore.getItemAsync(KIOSK_BIOMETRIC_KEY)
      .then(v => { if (v !== null) setRequireBiometric(v === '1'); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const loadGmailStatus = useCallback(async () => {
    try {
      const res = await authedFetch('/v1/integrations/gmail/status');
      if (res.ok) {
        const data = await res.json() as { connected: boolean; gmailAddress: string | null };
        setGmailConnected(data.connected);
        setGmailAddress(data.gmailAddress);
      }
    } catch { /* show stale */ }
  }, []);

  useEffect(() => { void loadGmailStatus(); }, [loadGmailStatus]);

  // Generic preference saver
  const savePref = async (updates: Record<string, unknown>) => {
    await authedFetch('/v1/preferences', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    setPreferences(updates as Parameters<typeof setPreferences>[0]);
  };

  function handleToggleAutoApproval(key: keyof AutoApprovalSettings, enableAuto: boolean) {
    if (!enableAuto) {
      // Turning off auto-send — no confirmation needed
      const updated = { ...autoApprovalSettings, [key]: 'require' as const };
      void savePref({ autoApprovalSettings: updated });
      return;
    }
    const labels: Record<keyof AutoApprovalSettings, string> = {
      send_email: 'Emails',
      send_sms: 'Text Messages',
      send_linkedin_dm: 'LinkedIn Messages',
      modify_calendar: 'Calendar Changes',
      post_social: 'Social Media Posts',
      send_document: 'Document Delivery',
    };
    Alert.alert(
      `Auto-send ${labels[key]}?`,
      `Claw will send these without asking for your approval first. You can turn this off any time in Settings.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enable Auto-Send',
          onPress: () => {
            const updated = { ...autoApprovalSettings, [key]: 'auto' as const };
            void savePref({ autoApprovalSettings: updated });
          },
        },
      ],
    );
  }

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
    // Pass JWT as query param so the server can scope the OAuth connection to this tenant
    const tokenParam = accessToken ? `?token=${encodeURIComponent(accessToken)}` : '';
    const url = `${API_BASE_URL}/oauth/connect/${integrationId}${tokenParam}`;
    Linking.openURL(url);
  }

  function handleConnectGmail() {
    handleConnect('gmail');
    // Reload status after a brief delay to reflect the new connection
    setTimeout(() => void loadGmailStatus(), 4000);
  }

  async function handleDisconnectGmail() {
    Alert.alert(
      'Disconnect Gmail',
      'This will stop RealClaw from reading your Gmail inbox for lead detection. Your existing contacts and briefing items will remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setGmailLoading(true);
            try {
              await authedFetch('/v1/integrations/gmail', { method: 'DELETE' });
              setGmailConnected(false);
              setGmailAddress(null);
            } catch {
              Alert.alert('Error', 'Could not disconnect Gmail. Please try again.');
            } finally {
              setGmailLoading(false);
            }
          },
        },
      ],
    );
  }

  const refreshPreferences = useCallback(async () => {
    try {
      const res = await authedFetch('/v1/preferences');
      if (res.ok) {
        const data = await res.json() as Parameters<typeof setPreferences>[0];
        setPreferences(data);
      }
    } catch { /* best-effort */ }
  }, [setPreferences]);

  async function handleAnalyzeTone() {
    setToneAnalyzing(true);
    try {
      const res = await authedFetch('/v1/integrations/gmail/analyze-tone', { method: 'POST' });
      if (res.ok) {
        Alert.alert('Analyzing Tone', 'Running in the background. Check back in about a minute.');
        setTimeout(() => void refreshPreferences(), 90_000);
      } else {
        const d = await res.json() as { error?: string };
        Alert.alert('Error', d.error ?? 'Could not start analysis');
      }
    } catch {
      Alert.alert('Error', 'Network error — please try again');
    } finally {
      setToneAnalyzing(false);
    }
  }

  function daysSince(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
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

        {/* ── Approvals ── */}
        <Text style={styles.sectionHeader}>Approvals</Text>
        <Text style={styles.sectionSubheader}>
          Choose which actions Claw sends automatically vs. routes to your approval carousel.
        </Text>
        <View style={styles.card}>
          {(
            [
              { key: 'send_sms',          label: 'Text Messages',      subtitle: 'SMS to clients and leads' },
              { key: 'send_email',         label: 'Emails',             subtitle: 'Emails to contacts' },
              { key: 'send_linkedin_dm',   label: 'LinkedIn Messages',  subtitle: 'LinkedIn DMs' },
              { key: 'modify_calendar',    label: 'Calendar Changes',   subtitle: 'Showing bookings and updates' },
              { key: 'post_social',        label: 'Social Posts',       subtitle: 'Instagram, Facebook, LinkedIn posts' },
              { key: 'send_document',      label: 'Document Delivery',  subtitle: 'Disclosures and paperwork' },
            ] as { key: keyof AutoApprovalSettings; label: string; subtitle: string }[]
          ).map(({ key, label, subtitle }, i, arr) => (
            <View key={key}>
              <View style={styles.approvalRow}>
                <View style={styles.rowTextBlock}>
                  <Text style={styles.rowLabel}>{label}</Text>
                  <Text style={styles.rowSubtitle}>{subtitle}</Text>
                </View>
                <View style={styles.approvalToggleGroup}>
                  <Text style={styles.approvalModeLabel}>
                    {(autoApprovalSettings ?? DEFAULT_AUTO_APPROVAL_SETTINGS)[key] === 'auto' ? 'Auto-Send' : 'Require Approval'}
                  </Text>
                  <Switch
                    value={(autoApprovalSettings ?? DEFAULT_AUTO_APPROVAL_SETTINGS)[key] === 'auto'}
                    onValueChange={v => handleToggleAutoApproval(key, v)}
                    trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                    thumbColor={(autoApprovalSettings ?? DEFAULT_AUTO_APPROVAL_SETTINGS)[key] === 'auto' ? '#16A34A' : '#fff'}
                  />
                </View>
              </View>
              {i < arr.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.approvalRow}>
            <View style={styles.rowTextBlock}>
              <Text style={styles.rowLabel}>Financial Actions</Text>
              <Text style={styles.rowSubtitle}>Offers, price changes, financial commitments</Text>
            </View>
            <View style={styles.approvalLocked}>
              <Text style={styles.approvalLockedText}>Always Required</Text>
              <Text style={styles.lockIcon}>🔒</Text>
            </View>
          </View>
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

        {/* ── Gmail ── */}
        <Text style={styles.sectionHeader}>Gmail</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowTextBlock}>
              <Text style={styles.rowLabel}>Gmail Integration</Text>
              <Text style={styles.rowSubtitle}>
                {gmailConnected && gmailAddress
                  ? `Connected: ${gmailAddress}`
                  : 'Receive and process lead emails automatically'}
              </Text>
            </View>
            {gmailLoading ? (
              <ActivityIndicator size="small" color="#0066FF" />
            ) : gmailConnected ? (
              <TouchableOpacity onPress={() => void handleDisconnectGmail()}>
                <Text style={[styles.rowValue, { color: '#FF3B30' }]}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={handleConnectGmail}>
                <Text style={[styles.rowValue, { color: '#0066FF' }]}>Connect →</Text>
              </TouchableOpacity>
            )}
          </View>
          {gmailConnected && (
            <View style={styles.row}>
              <View style={styles.rowTextBlock}>
                <Text style={styles.rowLabel}>Writing Style</Text>
                <Text style={styles.rowSubtitle}>
                  {toneAnalyzedAt ? `Analyzed ${daysSince(toneAnalyzedAt)}` : 'Not yet analyzed'}
                </Text>
              </View>
              {toneAnalyzing ? (
                <ActivityIndicator size="small" color="#0066FF" />
              ) : (
                <TouchableOpacity onPress={() => void handleAnalyzeTone()}>
                  <Text style={[styles.rowValue, { color: '#0066FF' }]}>
                    {toneAnalyzedAt ? 'Re-analyze' : 'Analyze →'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ── Kiosk ── */}
        <Text style={styles.sectionHeader}>Open House Kiosk</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowTextBlock}>
              <Text style={styles.rowLabel}>Require Biometrics to Start</Text>
              <Text style={styles.rowSubtitle}>
                Turn off if handing the phone directly — skips Face ID / PIN when entering kiosk mode
              </Text>
            </View>
            <Switch
              value={requireBiometric}
              onValueChange={v => {
                setRequireBiometric(v);
                SecureStore.setItemAsync(KIOSK_BIOMETRIC_KEY, v ? '1' : '0').catch(() => {});
              }}
              trackColor={{ false: '#e0e0e0', true: '#0066FF' }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} onPress={() => setShowPinModal(true)}>
            <Text style={styles.rowLabel}>Kiosk PIN</Text>
            <Text style={styles.rowValue}>{pinSet ? 'Change PIN →' : 'Set PIN →'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Subscription ── */}
        <Text style={styles.sectionHeader}>Subscription</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/(main)/subscription' as Href)}>
            <View style={styles.rowTextBlock}>
              <Text style={styles.rowLabel}>
                {subscriptionTier === 'professional' ? 'Professional' : subscriptionTier === 'brokerage' ? 'Brokerage' : 'Starter'}
              </Text>
              <Text style={styles.rowSubtitle}>
                {isTrialing && trialEndsAt
                  ? `Free trial — ${Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))} days left`
                  : subscriptionStatus === 'active' ? 'Active' : subscriptionStatus}
              </Text>
            </View>
            <Text style={styles.rowValue}>Manage →</Text>
          </TouchableOpacity>
        </View>

        {/* ── Account ── */}
        <Text style={styles.sectionHeader}>Account</Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <KioskPinModal
          visible={showPinModal}
          onDone={() => { setShowPinModal(false); setPinSet(true); }}
        />

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
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  Alert.alert(
                    'Override Subscription Tier',
                    `Current: ${devTierOverride ?? subscriptionTier} (${devTierOverride ? 'overridden' : 'real'})\n\nChoose a tier to simulate:`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: '✦ Professional', onPress: () => { setDevOverride('professional'); Alert.alert('Dev', 'Tier set to Professional'); } },
                      { text: 'Starter', onPress: () => { setDevOverride('starter'); Alert.alert('Dev', 'Tier set to Starter'); } },
                      { text: 'Clear Override', onPress: () => { setDevOverride(null); Alert.alert('Dev', 'Override cleared'); } },
                    ],
                  );
                }}
              >
                <View style={styles.rowTextBlock}>
                  <Text style={styles.rowLabel}>Subscription Override</Text>
                  <Text style={styles.rowSubtitle}>
                    {devTierOverride ? `Overriding to: ${devTierOverride}` : 'No override active'}
                  </Text>
                </View>
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
  rowTextBlock: { flex: 1, paddingRight: 12 },
  rowSubtitle: { fontSize: 12, color: '#9CA3AF', marginTop: 2, lineHeight: 16 },
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
  sectionSubheader: {
    fontSize: 13,
    color: '#888',
    paddingHorizontal: 16,
    marginTop: -8,
    marginBottom: 10,
    lineHeight: 18,
  },
  approvalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    justifyContent: 'space-between',
  },
  approvalToggleGroup: {
    alignItems: 'flex-end',
    gap: 4,
  },
  approvalModeLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '500',
  },
  approvalLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  approvalLockedText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  lockIcon: { fontSize: 14 },
});

const pinModalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  box: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 10,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  hint: { fontSize: 14, color: '#888', textAlign: 'center' },
  input: {
    width: '100%',
    backgroundColor: '#f5f5fa',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    textAlign: 'center',
    letterSpacing: 12,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  error: { fontSize: 14, color: '#EF4444', fontWeight: '500' },
  btn: {
    width: '100%',
    backgroundColor: '#0066FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancel: { paddingVertical: 8 },
  cancelText: { color: '#9CA3AF', fontSize: 14 },
});
