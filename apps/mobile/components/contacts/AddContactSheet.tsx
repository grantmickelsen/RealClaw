import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { v4 as uuidv4 } from 'uuid';
import Voice, { type SpeechResultsEvent } from '@react-native-voice/voice';
import { authedFetch } from '../../lib/api';
import { savePendingContact } from '../../lib/db';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { WheelPicker } from './WheelPicker';

export interface ContactFormFields {
  name: string;
  email: string;
  phone: string;
  stage: string;
  source: string;
  budget: string;
  desiredLocation: string;
  bedBath: string;
  timeline: string;
  notes: string;
}

const STAGES = ['Lead', 'Active Buyer', 'Nurture', 'Under Contract', 'Past Client'];
const SOURCES = ['Referral', 'Open House', 'Social', 'Cold Outreach', 'Other'];

// ── Budget options ──────────────────────────────────────────────────────────
const BUDGET_OPTIONS = (() => {
  const opts: string[] = [];
  for (let k = 250; k <= 1000; k += 50) opts.push(k === 1000 ? '$1M' : `$${k}k`);
  for (let i = 1; i <= 10; i++) opts.push(`$${(1 + i / 10).toFixed(1)}M`);
  for (let i = 1; i <= 12; i++) {
    const v = 2 + i * 0.25;
    opts.push(`$${parseFloat(v.toFixed(2))}M`);
  }
  for (let m = 6; m <= 25; m++) opts.push(`$${m}M`);
  opts.push('$25M+');
  return opts;
})();

const BEDS_OPTIONS = ['Any', '1', '2', '3', '4', '5+'];
const BATHS_OPTIONS = ['Any', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5+'];
const TIMELINE_OPTIONS = [
  'Not set', '< 1 mo', '1 mo', '2 mo', '3 mo', '4 mo', '5 mo',
  '6 mo', '7 mo', '8 mo', '9 mo', '10 mo', '11 mo', '12 mo', '> 1 yr',
];

const EMPTY: ContactFormFields = {
  name: '', email: '', phone: '', stage: '', source: '',
  budget: '', desiredLocation: '', bedBath: '', timeline: '', notes: '',
};

// ── Phone formatting ────────────────────────────────────────────────────────
// Always takes first 10 digits so the field cannot grow beyond (555) 555-5555.
function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Strip country code then format (for device contact imports that may carry +1).
function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  return formatPhone(ten);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isCompletePhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length === 10;
}

interface Props {
  bottomSheetRef: React.RefObject<BottomSheet | null>;
  onSaved(): void;
  prefill?: Partial<ContactFormFields>;
}

export function AddContactSheet({ bottomSheetRef, onSaved, prefill }: Props) {
  const [form, setForm] = useState<ContactFormFields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof ContactFormFields, string>>>({});
  const [activeField, setActiveField] = useState<string | null>(null);
  const [beds, setBeds] = useState('Any');
  const [baths, setBaths] = useState('Any');
  const [saving, setSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const notesRef = useRef<TextInput>(null);
  const isOnline = useNetworkStatus();

  // Wire up voice recognition callbacks
  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = e.value?.[0] ?? '';
      if (text) {
        setForm(prev => ({
          ...prev,
          notes: prev.notes ? `${prev.notes} ${text}` : text,
        }));
      }
      setIsListening(false);
    };
    Voice.onSpeechError = () => { setIsListening(false); };
    return () => {
      Voice.onSpeechResults = undefined as unknown as typeof Voice.onSpeechResults;
      Voice.onSpeechError = undefined as unknown as typeof Voice.onSpeechError;
      Voice.destroy().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (prefill) {
      setForm(prev => ({
        ...prev,
        ...prefill,
        phone: prefill.phone ? normalizePhone(prefill.phone) : (prev.phone ?? ''),
      }));
      if (prefill.bedBath) {
        const bedsM = prefill.bedBath.match(/^(\d+\+?)BR/);
        const bathsM = prefill.bedBath.match(/(\d+\.?\d*\+?)BA/);
        if (bedsM?.[1]) setBeds(bedsM[1]);
        if (bathsM?.[1]) setBaths(bathsM[1]);
      }
    }
  }, [prefill]);

  const set = useCallback((field: keyof ContactFormFields, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }, []);

  const handlePhoneChange = useCallback((raw: string) => {
    set('phone', formatPhone(raw));
  }, [set]);

  const validateEmail = useCallback(() => {
    if (form.email.trim() && !isValidEmail(form.email)) {
      setErrors(prev => ({ ...prev, email: 'Enter a valid email address' }));
    }
  }, [form.email]);

  const validatePhone = useCallback(() => {
    const d = form.phone.replace(/\D/g, '');
    if (d.length > 0 && d.length !== 10) {
      setErrors(prev => ({ ...prev, phone: 'Enter a 10-digit US phone number' }));
    }
  }, [form.phone]);

  const toggleVoice = useCallback(async () => {
    if (isListening) {
      await Voice.stop().catch(() => {});
      setIsListening(false);
    } else {
      try {
        await Voice.start('en-US');
        setIsListening(true);
      } catch {
        Alert.alert(
          'Voice unavailable',
          'Speech recognition requires a development build. Use the keyboard dictation key instead.',
        );
      }
    }
  }, [isListening]);

  const resetLocal = useCallback(() => {
    setForm(EMPTY);
    setErrors({});
    setActiveField(null);
    setBeds('Any');
    setBaths('Any');
    setIsListening(false);
    Voice.stop().catch(() => {});
  }, []);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.close();
    resetLocal();
  }, [bottomSheetRef, resetLocal]);

  const handleSave = useCallback(async () => {
    const newErrors: Partial<Record<keyof ContactFormFields, string>> = {};
    if (!form.name.trim()) newErrors.name = 'Name is required';
    if (form.email.trim() && !isValidEmail(form.email)) newErrors.email = 'Enter a valid email address';
    const pd = form.phone.replace(/\D/g, '');
    if (pd.length > 0 && pd.length !== 10) newErrors.phone = 'Enter a 10-digit US phone number';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    const bedsVal = beds === 'Any' ? '' : beds;
    const bathsVal = baths === 'Any' ? '' : baths;
    const bedBath = [bedsVal && `${bedsVal}BR`, bathsVal && `${bathsVal}BA`].filter(Boolean).join(' ');
    const timeline = form.timeline === 'Not set' ? '' : form.timeline;

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    const payload = JSON.stringify({
      name:            form.name.trim(),
      email:           form.email.trim()           || undefined,
      phone:           isCompletePhone(form.phone) ? form.phone : undefined,
      stage:           form.stage                  || undefined,
      source:          form.source                 || undefined,
      budget:          form.budget                 || undefined,
      desiredLocation: form.desiredLocation.trim() || undefined,
      bedBath:         bedBath                     || undefined,
      timeline:        timeline                    || undefined,
      notes:           form.notes.trim()           || undefined,
    });

    try {
      if (isOnline) {
        const res = await authedFetch('/v1/contacts', { method: 'POST', body: payload });
        if (!res.ok) throw new Error('server error');
      } else {
        await savePendingContact({ id: uuidv4(), payload, created_at: new Date().toISOString() });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      handleClose();
      onSaved();
      Alert.alert(
        isOnline ? 'Contact saved' : 'Saved offline',
        isOnline
          ? `${form.name.trim()} has been added.`
          : `${form.name.trim()} will sync when you're back online.`,
      );
    } catch {
      Alert.alert('Error', 'Could not save contact. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [form, beds, baths, isOnline, handleClose, onSaved]);

  const togglePicker = useCallback((key: string) => {
    setActiveField(prev => (prev === key ? null : key));
  }, []);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={['90%']}
      enablePanDownToClose
      onClose={resetLocal}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
      keyboardBehavior={Platform.OS === 'ios' ? 'extend' : 'interactive'}
      keyboardBlurBehavior="restore"
    >
      <BottomSheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>New Contact</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={12}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Required */}
        <Field label="Name *" error={errors.name}>
          <TextInput
            style={[styles.input, errors.name ? styles.inputError : null]}
            value={form.name}
            onChangeText={v => set('name', v)}
            placeholder="Full name"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="words"
            returnKeyType="done"
          />
        </Field>

        {/* Contact info */}
        <SectionHeader label="CONTACT INFO" />
        <Field label="Email" error={errors.email}>
          <TextInput
            style={[styles.input, errors.email ? styles.inputError : null]}
            value={form.email}
            onChangeText={v => set('email', v)}
            onBlur={validateEmail}
            placeholder="email@example.com"
            placeholderTextColor="#9CA3AF"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <TextInput
            style={[styles.input, errors.phone ? styles.inputError : null]}
            value={form.phone}
            onChangeText={handlePhoneChange}
            onBlur={validatePhone}
            placeholder="(555) 000-0000"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
            returnKeyType="done"
          />
        </Field>

        {/* Classification */}
        <SectionHeader label="CLASSIFICATION" />
        <Field label="Stage">
          <ChipRow options={STAGES} selected={form.stage} onSelect={v => set('stage', v)} />
        </Field>
        <Field label="Source">
          <ChipRow options={SOURCES} selected={form.source} onSelect={v => set('source', v)} />
        </Field>

        {/* Buying criteria */}
        <SectionHeader label="BUYING CRITERIA" />

        <PickerField
          label="Budget"
          value={form.budget}
          placeholder="Tap to select…"
          fieldKey="budget"
          activeField={activeField}
          onToggle={togglePicker}
        >
          <WheelPicker
            items={BUDGET_OPTIONS}
            selected={form.budget || BUDGET_OPTIONS[0]!}
            onChange={v => set('budget', v)}
          />
        </PickerField>

        <Field label="Area">
          <TextInput
            style={styles.input}
            value={form.desiredLocation}
            onChangeText={v => set('desiredLocation', v)}
            placeholder="Ventura, Oxnard, Santa Barbara…"
            placeholderTextColor="#9CA3AF"
            returnKeyType="done"
          />
        </Field>

        <View style={styles.bedBathRow}>
          <View style={styles.bedBathHalf}>
            <PickerField
              label="Beds"
              value={beds === 'Any' ? '' : `${beds} bed`}
              placeholder="Any"
              fieldKey="beds"
              activeField={activeField}
              onToggle={togglePicker}
            >
              <WheelPicker
                items={BEDS_OPTIONS}
                selected={beds}
                onChange={v => setBeds(v)}
              />
            </PickerField>
          </View>
          <View style={styles.bedBathHalf}>
            <PickerField
              label="Baths"
              value={baths === 'Any' ? '' : `${baths} bath`}
              placeholder="Any"
              fieldKey="baths"
              activeField={activeField}
              onToggle={togglePicker}
            >
              <WheelPicker
                items={BATHS_OPTIONS}
                selected={baths}
                onChange={v => setBaths(v)}
              />
            </PickerField>
          </View>
        </View>

        <PickerField
          label="Timeline"
          value={form.timeline === 'Not set' ? '' : form.timeline}
          placeholder="Tap to select…"
          fieldKey="timeline"
          activeField={activeField}
          onToggle={togglePicker}
        >
          <WheelPicker
            items={TIMELINE_OPTIONS}
            selected={form.timeline || TIMELINE_OPTIONS[0]!}
            onChange={v => set('timeline', v)}
          />
        </PickerField>

        {/* Notes + voice */}
        <View style={styles.notesSectionRow}>
          <Text style={styles.sectionLabel}>NOTES</Text>
          <TouchableOpacity
            onPress={() => { void toggleVoice(); }}
            hitSlop={12}
            style={[styles.micBtn, isListening && styles.micBtnActive]}
          >
            <Ionicons
              name={isListening ? 'stop-circle' : 'mic-outline'}
              size={20}
              color={isListening ? '#EF4444' : '#6B7280'}
            />
            {isListening && <Text style={styles.micLabel}>Listening…</Text>}
          </TouchableOpacity>
        </View>
        <TextInput
          ref={notesRef}
          style={[styles.input, styles.notesInput]}
          value={form.notes}
          onChangeText={v => set('notes', v)}
          placeholder="Dog named Max, hates two-story houses, prefers weekends for showings…"
          placeholderTextColor="#9CA3AF"
          multiline
          textAlignVertical="top"
          returnKeyType="done"
          blurOnSubmit
        />

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={() => { void handleSave(); }}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>
              {isOnline ? 'Save Contact' : 'Save Offline'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function PickerField({ label, value, placeholder, fieldKey, activeField, onToggle, children }: {
  label: string;
  value: string;
  placeholder: string;
  fieldKey: string;
  activeField: string | null;
  onToggle(key: string): void;
  children: React.ReactNode;
}) {
  const isOpen = activeField === fieldKey;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, styles.pickerDisplay, isOpen && styles.pickerDisplayOpen]}
        onPress={() => onToggle(fieldKey)}
        activeOpacity={0.7}
      >
        <Text style={[styles.pickerDisplayText, !value && styles.pickerPlaceholder]}>
          {value || placeholder}
        </Text>
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
      </TouchableOpacity>
      {isOpen && <View style={styles.wheelWrapper}>{children}</View>}
    </View>
  );
}

function ChipRow({ options, selected, onSelect }: {
  options: string[];
  selected: string;
  onSelect(v: string): void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt}
          style={[styles.chip, selected === opt && styles.chipActive]}
          onPress={() => onSelect(selected === opt ? '' : opt)}
          activeOpacity={0.75}
        >
          <Text style={[styles.chipText, selected === opt && styles.chipTextActive]}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { backgroundColor: '#D1D5DB', width: 36 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  cancelText: { fontSize: 16, color: '#0066FF', fontWeight: '500' },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#9CA3AF',
    letterSpacing: 0.8, marginTop: 20, marginBottom: 10,
  },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    backgroundColor: '#F9FAFB', borderRadius: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#1a1a1a',
  },
  inputError: { borderColor: '#EF4444', backgroundColor: '#FFF5F5' },
  errorText: { fontSize: 12, color: '#EF4444', marginTop: 4, marginLeft: 2 },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  notesSectionRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 20, marginBottom: 10,
  },
  micBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6, borderRadius: 8 },
  micBtnActive: { backgroundColor: '#FEE2E2' },
  micLabel: { fontSize: 12, color: '#EF4444', fontWeight: '600' },
  pickerDisplay: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  pickerDisplayOpen: { borderColor: '#0066FF', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  pickerDisplayText: { fontSize: 15, color: '#1a1a1a' },
  pickerPlaceholder: { color: '#9CA3AF' },
  wheelWrapper: {
    borderWidth: 1, borderTopWidth: 0, borderColor: '#0066FF',
    borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
    overflow: 'hidden', backgroundColor: '#fff',
  },
  bedBathRow: { flexDirection: 'row', gap: 10 },
  bedBathHalf: { flex: 1 },
  chipRow: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  chipText: { fontSize: 13, fontWeight: '500', color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  saveBtn: {
    backgroundColor: '#0066FF', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.55 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
