import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Switch, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, TouchableWithoutFeedback, Keyboard, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { v4 as uuidv4 } from 'uuid';
import { saveGuest, type StoredGuest } from '../../lib/db';
import { authedFetch } from '../../lib/api';
import { useKioskStore } from '../../store/kiosk';

const PIN_STORE_KEY = 'claw_kiosk_pin';

// ─── PIN modal (inline for self-containment) ─────────────────────────────────

function PinModal({
  visible,
  onSuccess,
  onDismiss,
}: {
  visible: boolean;
  onSuccess(): void;
  onDismiss(): void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) { setPin(''); setError(''); }
  }, [visible]);

  async function handleSubmit() {
    const stored = await SecureStore.getItemAsync(PIN_STORE_KEY);
    if (!stored || pin === stored) { onSuccess(); return; }
    setError('Incorrect PIN');
    setPin('');
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={pinStyles.overlay}>
        <View style={pinStyles.box}>
          <Text style={pinStyles.title}>Agent Access</Text>
          <Text style={pinStyles.subtitle}>Enter your PIN to exit kiosk mode</Text>
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
          {error ? <Text style={pinStyles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[pinStyles.btn, pin.length < 4 && pinStyles.btnDisabled]}
            onPress={handleSubmit}
            disabled={pin.length < 4}
          >
            <Text style={pinStyles.btnText}>Unlock</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={pinStyles.cancelLink}>
            <Text style={pinStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function KioskLockedView() {
  const unlock = useKioskStore(s => s.unlock);
  const addGuest = useKioskStore(s => s.addGuest);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [workingWithAgent, setWorkingWithAgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);

  async function handleGuestSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    Keyboard.dismiss();
    const guest: StoredGuest = {
      id: uuidv4(),
      name: name.trim(),
      phone: phone.trim() || null,
      working_with_agent: workingWithAgent ? 1 : 0,
      brain_dump_text: null,
      created_at: Date.now(),
      synced: 0,
    };
    await saveGuest(guest);
    addGuest(guest);
    setSubmitSuccess(true);
    setSubmitting(false);
    setTimeout(() => {
      setSubmitSuccess(false);
      setName('');
      setPhone('');
      setWorkingWithAgent(false);
    }, 1800);
    try {
      await authedFetch('/v1/open-house/guests', {
        method: 'POST',
        body: JSON.stringify({
          name: guest.name,
          phone: guest.phone,
          workingWithAgent: !!guest.working_with_agent,
        }),
      });
    } catch { /* queued locally */ }
  }

  async function handleExitPress() {
    try {
      const hasBio = await LocalAuthentication.hasHardwareAsync();
      if (hasBio && await LocalAuthentication.isEnrolledAsync()) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify to exit kiosk mode',
          fallbackLabel: 'Use PIN',
        });
        if (result.success) { unlock(); return; }
      }
    } catch { /* fall through to PIN */ }
    setShowPinModal(true);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.logoArea}>
              <Text style={styles.logoText}>🏠</Text>
              <Text style={styles.title}>Welcome!</Text>
              <Text style={styles.subtitle}>Please sign in below</Text>
            </View>

            {submitSuccess ? (
              <View style={styles.successState}>
                <Text style={styles.successIcon}>✓</Text>
                <Text style={styles.successText}>Thank you for signing in!</Text>
              </View>
            ) : (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>Your Name *</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={name}
                  onChangeText={setName}
                  placeholder="First and last name"
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="next"
                  autoCapitalize="words"
                />

                <Text style={styles.fieldLabel}>Phone Number</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="(555) 555-5555"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />

                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Working with an agent?</Text>
                  <Switch
                    value={workingWithAgent}
                    onValueChange={setWorkingWithAgent}
                    trackColor={{ false: '#e0e0e0', true: '#0066FF' }}
                    thumbColor="#fff"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, (!name.trim() || submitting) && styles.btnDisabled]}
                  onPress={handleGuestSubmit}
                  disabled={!name.trim() || submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.submitBtnText}>Sign In →</Text>
                  }
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 80 }} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* Small, discreet exit button in the bottom-right */}
      <TouchableOpacity style={styles.exitBtn} onPress={handleExitPress} hitSlop={16}>
        <Text style={styles.exitText}>Agent Exit</Text>
      </TouchableOpacity>

      <PinModal
        visible={showPinModal}
        onSuccess={() => { setShowPinModal(false); unlock(); }}
        onDismiss={() => setShowPinModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 40 },
  logoArea: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  logoText: { fontSize: 64 },
  title: { fontSize: 32, fontWeight: '800', color: '#1a1a1a' },
  subtitle: { fontSize: 18, color: '#888' },
  formCard: {
    width: '100%', maxWidth: 420,
    backgroundColor: '#f8f8fb', borderRadius: 20, padding: 24, gap: 4,
  },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#444', marginTop: 10, marginBottom: 4 },
  fieldInput: {
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#e0e0e0',
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, color: '#1a1a1a',
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 14, paddingVertical: 6,
  },
  toggleLabel: { fontSize: 16, color: '#1a1a1a' },
  submitBtn: {
    backgroundColor: '#0066FF', borderRadius: 14,
    paddingVertical: 18, alignItems: 'center', marginTop: 20,
  },
  submitBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },
  successState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  successIcon: { fontSize: 72, color: '#22C55E' },
  successText: { fontSize: 22, fontWeight: '700', color: '#22C55E' },
  exitBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  exitText: { fontSize: 12, color: '#aaa', fontWeight: '500' },
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
