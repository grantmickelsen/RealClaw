import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { saveGuest, loadTodayGuests, type StoredGuest } from '../../lib/db';
import { authedFetch } from '../../lib/api';
import { VoiceInput } from '../../components/VoiceInput';
import { useAuthStore } from '../../store/auth';
import { useKioskStore, KIOSK_BIOMETRIC_KEY } from '../../store/kiosk';
import { useSubscriptionStore } from '../../store/subscription';
import { PaywallModal } from '../../components/paywall/PaywallModal';
import { useWsStore } from '../../store/ws';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { DebriefCarousel } from '../../components/kiosk/DebriefCarousel';

const PIN_STORE_KEY = 'claw_kiosk_pin';

// ─── PIN modal ────────────────────────────────────────────────────────────────

function PinModal({
  visible,
  onSuccess,
  onDismiss,
  mode,
}: {
  visible: boolean;
  onSuccess(): void;
  onDismiss(): void;
  mode: 'verify' | 'set';
}) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) { setPin(''); setConfirmPin(''); setError(''); }
  }, [visible]);

  async function handleSubmit() {
    if (mode === 'set') {
      if (pin.length !== 4) { setError('PIN must be 4 digits'); return; }
      if (pin !== confirmPin) { setError('PINs do not match'); return; }
      await SecureStore.setItemAsync(PIN_STORE_KEY, pin);
      onSuccess();
    } else {
      const stored = await SecureStore.getItemAsync(PIN_STORE_KEY);
      if (!stored || pin === stored) { onSuccess(); return; }
      setError('Incorrect PIN');
      setPin('');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={pinStyles.overlay}>
        <View style={pinStyles.box}>
          <Text style={pinStyles.title}>
            {mode === 'set' ? 'Set Kiosk PIN' : 'Agent Verification'}
          </Text>
          <Text style={pinStyles.subtitle}>
            {mode === 'set' ? 'Enter a 4-digit PIN to use as a fallback' : 'Enter your 4-digit PIN'}
          </Text>
          <TextInput
            style={pinStyles.input}
            value={pin}
            onChangeText={v => { setPin(v.replace(/\D/g, '').slice(0, 4)); setError(''); }}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="• • • •"
            placeholderTextColor="#ccc"
            maxLength={4}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          {mode === 'set' && (
            <TextInput
              style={pinStyles.input}
              value={confirmPin}
              onChangeText={v => { setConfirmPin(v.replace(/\D/g, '').slice(0, 4)); setError(''); }}
              keyboardType="number-pad"
              secureTextEntry
              placeholder="Confirm PIN"
              placeholderTextColor="#ccc"
              maxLength={4}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          )}
          {error ? <Text style={pinStyles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[pinStyles.btn, pin.length < 4 && pinStyles.btnDisabled]}
            onPress={handleSubmit}
            disabled={pin.length < 4}
          >
            <Text style={pinStyles.btnText}>
              {mode === 'set' ? 'Set PIN' : 'Confirm'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={pinStyles.cancelLink}>
            <Text style={pinStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function KioskScreen() {
  const isProfessional = useSubscriptionStore(s => s.isProfessional);
  const [paywallVisible, setPaywallVisible] = useState(false);

  useEffect(() => {
    if (!isProfessional) setPaywallVisible(true);
  }, [isProfessional]);

  const [showDebrief, setShowDebrief] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinModalMode, setPinModalMode] = useState<'verify' | 'set'>('verify');

  const lock = useKioskStore(s => s.lock);
  const guests = useKioskStore(s => s.guests);
  const setGuests = useKioskStore(s => s.setGuests);
  const requireBiometric = useKioskStore(s => s.requireBiometricForKiosk);
  const setRequireBiometric = useKioskStore(s => s.setRequireBiometric);
  const wsStatus = useWsStore(s => s.status);
  const { isConnected } = useNetworkStatus();
  void useAuthStore(s => s.tenantId);

  const [selectedGuest, setSelectedGuest] = useState<StoredGuest | null>(null);
  const [brainDump, setBrainDump] = useState('');
  const [savingDump, setSavingDump] = useState(false);

  const refreshGuests = useCallback(async () => {
    const today = await loadTodayGuests();
    setGuests(today);
  }, [setGuests]);

  useEffect(() => {
    void refreshGuests();
    // Load persisted biometric preference
    SecureStore.getItemAsync(KIOSK_BIOMETRIC_KEY)
      .then(v => { if (v !== null) setRequireBiometric(v === '1'); })
      .catch(() => {});
  }, [refreshGuests, setRequireBiometric]);

  // ── Start open house kiosk mode ──

  async function handleStartKiosk() {
    if (!requireBiometric) { lock(); return; }
    try {
      const hasBio = await LocalAuthentication.hasHardwareAsync();
      if (hasBio && await LocalAuthentication.isEnrolledAsync()) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify to start open house kiosk',
          fallbackLabel: 'Use PIN',
        });
        if (result.success) { lock(); return; }
      }
    } catch { /* fall through */ }
    const stored = await SecureStore.getItemAsync(PIN_STORE_KEY);
    setPinModalMode(stored ? 'verify' : 'set');
    setShowPinModal(true);
  }

  // ── Brain dump ──

  async function handleSaveBrainDump() {
    if (!brainDump.trim() || !selectedGuest) return;
    setSavingDump(true);
    try {
      await saveGuest({ ...selectedGuest, brain_dump_text: brainDump.trim() });
      await authedFetch('/v1/open-house/guests', {
        method: 'POST',
        body: JSON.stringify({
          name: selectedGuest.name, phone: selectedGuest.phone,
          workingWithAgent: !!selectedGuest.working_with_agent,
          brainDumpText: brainDump.trim(),
        }),
      });
      setBrainDump('');
      setSelectedGuest(null);
      await refreshGuests();
    } catch {
      Alert.alert('Error', 'Failed to save notes. Please try again.');
    } finally {
      setSavingDump(false);
    }
  }

  function handleConclude() {
    Alert.alert(
      'Conclude Open House',
      `Review notes for ${guests.length} guest${guests.length !== 1 ? 's' : ''} and generate follow-up drafts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Conclude & Debrief',
          onPress: () => {
            authedFetch('/v1/open-house/conclude', { method: 'POST' }).catch(() => {});
            setShowDebrief(true);
          },
        },
      ],
    );
  }

  // ── Render ──

  if (showDebrief) {
    return (
      <DebriefCarousel
        guests={guests}
        onComplete={() => { setShowDebrief(false); void refreshGuests(); }}
        isConnected={isConnected}
        wsConnected={wsStatus === 'connected'}
      />
    );
  }

  if (!isProfessional) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
        <PaywallModal visible={paywallVisible} onClose={() => setPaywallVisible(false)} contextTitle="Unlock Open House Kiosk" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Open House</Text>
        <TouchableOpacity
          style={styles.kioskBtn}
          onPress={() => { void handleStartKiosk(); }}
          activeOpacity={0.8}
        >
          <Text style={styles.kioskBtnText}>Start Kiosk Mode</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {/* Guest list */}
            <Text style={styles.sectionLabel}>Today's Guests ({guests.length})</Text>
            {guests.length === 0 ? (
              <Text style={styles.emptyGuests}>
                No guests yet. Start kiosk mode so visitors can sign in.
              </Text>
            ) : (
              <View style={styles.guestList}>
                {guests.map((g, i) => (
                  <TouchableOpacity
                    key={g.id}
                    style={[
                      styles.guestRow,
                      selectedGuest?.id === g.id && styles.guestRowSelected,
                      i < guests.length - 1 && styles.guestRowBorder,
                    ]}
                    onPress={() => setSelectedGuest(selectedGuest?.id === g.id ? null : g)}
                  >
                    <View>
                      <Text style={styles.guestName}>{g.name}</Text>
                      {g.phone ? <Text style={styles.guestPhone}>{g.phone}</Text> : null}
                      {g.brain_dump_text ? (
                        <Text style={styles.guestNotes} numberOfLines={1}>
                          📝 {g.brain_dump_text}
                        </Text>
                      ) : null}
                    </View>
                    {g.working_with_agent === 1 && (
                      <Text style={styles.agentBadge}>Has Agent</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Brain dump */}
            <Text style={styles.sectionLabel}>Brain Dump</Text>
            <Text style={styles.sectionHint}>
              {selectedGuest
                ? `Adding notes for ${selectedGuest.name}`
                : 'Select a guest above to attach notes'}
            </Text>
            <View style={styles.brainDumpRow}>
              <VoiceInput
                onTranscript={text => setBrainDump(prev => prev ? `${prev} ${text}` : text)}
                disabled={!selectedGuest}
              />
              <TextInput
                style={[styles.brainDumpInput, !selectedGuest && styles.inputDisabled]}
                value={brainDump}
                onChangeText={setBrainDump}
                placeholder="Loves big backyard, two kids, dog, schools important…"
                placeholderTextColor="#9CA3AF"
                multiline
                maxLength={600}
                editable={!!selectedGuest}
                textAlignVertical="top"
                returnKeyType="done"
                blurOnSubmit
              />
            </View>

            {selectedGuest && brainDump.trim() ? (
              <TouchableOpacity
                style={[styles.saveNoteBtn, savingDump && styles.btnDisabled]}
                onPress={handleSaveBrainDump}
                disabled={savingDump}
              >
                <Text style={styles.saveNoteBtnText}>
                  {savingDump ? 'Saving…' : `Save notes for ${selectedGuest.name} →`}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Conclude */}
            {guests.length > 0 && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity style={styles.concludeBtn} onPress={handleConclude}>
                  <Text style={styles.concludeBtnText}>Conclude Open House →</Text>
                </TouchableOpacity>
                <Text style={styles.concludeHint}>
                  Generates personalized follow-ups for all {guests.length} guest{guests.length !== 1 ? 's' : ''}
                </Text>
              </>
            )}

            <View style={{ height: 60 }} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <PinModal
        visible={showPinModal}
        mode={pinModalMode}
        onSuccess={() => { setShowPinModal(false); lock(); }}
        onDismiss={() => setShowPinModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  kioskBtn: {
    backgroundColor: '#0066FF',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  kioskBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  scroll: { paddingBottom: 40 },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: 16, marginTop: 20, marginBottom: 8,
  },
  sectionHint: { fontSize: 13, color: '#aaa', paddingHorizontal: 16, marginBottom: 8 },
  emptyGuests: { fontSize: 15, color: '#aaa', paddingHorizontal: 16, lineHeight: 22 },
  guestList: {
    marginHorizontal: 16, backgroundColor: '#fff',
    borderRadius: 12, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#e0e0e0',
  },
  guestRow: {
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  guestRowSelected: { backgroundColor: '#EFF6FF' },
  guestRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0' },
  guestName: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  guestPhone: { fontSize: 13, color: '#888', marginTop: 2 },
  guestNotes: { fontSize: 12, color: '#0066FF', marginTop: 2 },
  agentBadge: {
    fontSize: 11, fontWeight: '700', color: '#F97316',
    backgroundColor: '#FFF3E8', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  brainDumpRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16 },
  brainDumpInput: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#e0e0e0',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#1a1a1a', minHeight: 80,
  },
  inputDisabled: { opacity: 0.5 },
  saveNoteBtn: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#0066FF', borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  saveNoteBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  divider: {
    height: StyleSheet.hairlineWidth, backgroundColor: '#e0e0e0',
    marginHorizontal: 16, marginVertical: 24,
  },
  concludeBtn: {
    marginHorizontal: 16, backgroundColor: '#22C55E',
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  concludeBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  concludeHint: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginTop: 8 },
});

const pinStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  box: {
    backgroundColor: '#fff', borderRadius: 20, padding: 28,
    width: '100%', maxWidth: 360, alignItems: 'center', gap: 12,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center' },
  input: {
    width: '100%', backgroundColor: '#f5f5fa', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 22, textAlign: 'center', letterSpacing: 12,
    color: '#1a1a1a', borderWidth: 1, borderColor: '#e0e0e0',
  },
  error: { fontSize: 14, color: '#EF4444', fontWeight: '500' },
  btn: {
    width: '100%', backgroundColor: '#0066FF', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cancelLink: { paddingVertical: 8 },
  cancelText: { color: '#9CA3AF', fontSize: 14 },
});
