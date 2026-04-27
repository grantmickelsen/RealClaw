import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, ActionSheetIOS, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import * as Contacts from 'expo-contacts';
import { authedFetch } from '../../lib/api';
import { useContactsStore, type ContactCard } from '../../store/contacts';
import { TemperatureCard } from '../../components/contacts/TemperatureCard';
import { DossierSheet } from '../../components/contacts/DossierSheet';
import { AddContactSheet, type ContactFormFields } from '../../components/contacts/AddContactSheet';

function pairWarm(warm: ContactCard[]): [ContactCard, ContactCard | null][] {
  const pairs: [ContactCard, ContactCard | null][] = [];
  for (let i = 0; i < warm.length; i += 2) {
    pairs.push([warm[i]!, warm[i + 1] ?? null]);
  }
  return pairs;
}

export default function ContactsScreen() {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const addSheetRef = useRef<BottomSheet>(null);
  const [query, setQuery] = useState('');
  const [prefill, setPrefill] = useState<Partial<ContactFormFields> | undefined>();

  const contacts     = useContactsStore(s => s.contacts);
  const loading      = useContactsStore(s => s.loading);
  const setContacts  = useContactsStore(s => s.setContacts);
  const setLoading   = useContactsStore(s => s.setLoading);
  const openDossier  = useContactsStore(s => s.openDossier);
  const setPendingId = useContactsStore(s => s.setPendingDossierCorrelationId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/v1/contacts');
      if (res.ok) {
        const data = await res.json() as { contacts: ContactCard[] };
        setContacts(data.contacts);
      }
    } catch { /* silent — show empty state */ } finally {
      setLoading(false);
    }
  }, [setContacts, setLoading]);

  useEffect(() => { void load(); }, [load]);

  const handleCardPress = useCallback(async (contact: ContactCard) => {
    openDossier(contact.id);
    bottomSheetRef.current?.snapToIndex(0);

    const correlationId = uuidv4();
    setPendingId(correlationId);
    try {
      await authedFetch('/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'mobile',
          content: `Generate contact dossier for contact ${contact.id}`,
          structuredData: { taskType: 'contact_dossier', contactId: contact.id },
          correlationId,
        }),
      });
    } catch {
      useContactsStore.getState().setDossierResult('Could not load summary. Check your connection.', []);
    }
  }, [openDossier, setPendingId]);

  async function handleImportFromPhone() {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Allow contacts access in Settings to import.');
        return;
      }
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return;

      const phone = (picked as { phoneNumbers?: Array<{ number?: string }> }).phoneNumbers?.[0]?.number ?? '';
      const email = (picked as { emails?: Array<{ email?: string }> }).emails?.[0]?.email ?? '';
      const firstName = (picked as { firstName?: string }).firstName ?? '';
      const lastName = (picked as { lastName?: string }).lastName ?? '';

      setPrefill({
        name: [firstName, lastName].filter(Boolean).join(' '),
        phone,
        email,
        stage: '',
        source: 'Referral',
        budget: '',
        desiredLocation: '',
        bedBath: '',
        timeline: '',
        notes: '',
      });
      addSheetRef.current?.snapToIndex(0);
    } catch {
      Alert.alert('Error', 'Could not access contacts. Please try again.');
    }
  }

  function handleAddPress() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'New Contact', 'Import from Phone'], cancelButtonIndex: 0 },
        (idx) => {
          if (idx === 1) { setPrefill(undefined); addSheetRef.current?.snapToIndex(0); }
          if (idx === 2) { void handleImportFromPhone(); }
        },
      );
    } else {
      Alert.alert('Add Contact', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'New Contact', onPress: () => { setPrefill(undefined); addSheetRef.current?.snapToIndex(0); } },
        { text: 'Import from Phone', onPress: () => { void handleImportFromPhone(); } },
      ]);
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? contacts.filter(c =>
        (c.name ?? '').toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.contactType.toLowerCase().includes(q) ||
        c.nextAction.toLowerCase().includes(q),
      )
    : contacts;

  const hot  = filtered.filter(c => c.temperatureScore >= 70);
  const warm = filtered.filter(c => c.temperatureScore >= 40 && c.temperatureScore < 70);
  const cold = filtered.filter(c => c.temperatureScore < 40);
  const warmPairs = pairWarm(warm);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => { void load(); }} hitSlop={12}>
            <Ionicons name="refresh-outline" size={22} color="#0066FF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleAddPress} hitSlop={12}>
            <Ionicons name="add" size={26} color="#0066FF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts…"
          placeholderTextColor="#9CA3AF"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : contacts.length === 0 ? (
        <View style={styles.emptyCenter}>
          <Text style={styles.emptyText}>
            No active contacts yet.{'\n'}Briefing will surface leads as they're added.
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyCenter}>
          <Text style={styles.emptyText}>No contacts match "{query}".</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Hot cards — full width */}
          {hot.map(c => (
            <TemperatureCard
              key={c.id}
              contact={c}
              variant="hot"
              onPress={() => { void handleCardPress(c); }}
            />
          ))}

          {/* Warm cards — two per row */}
          {warm.length > 0 && (
            <>
              {hot.length > 0 && <View style={styles.sectionGap} />}
              {warmPairs.map((pair, i) => (
                <View key={i} style={styles.warmRow}>
                  <TemperatureCard
                    contact={pair[0]}
                    variant="warm"
                    onPress={() => { void handleCardPress(pair[0]); }}
                  />
                  {pair[1] ? (
                    <TemperatureCard
                      contact={pair[1]}
                      variant="warm"
                      onPress={() => { void handleCardPress(pair[1]!); }}
                    />
                  ) : (
                    <View style={styles.warmPlaceholder} />
                  )}
                </View>
              ))}
            </>
          )}

          {/* Cold chips — horizontal scroll */}
          {cold.length > 0 && (
            <>
              <View style={styles.sectionGap} />
              <Text style={styles.sectionLabel}>DORMANT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {cold.map(c => (
                  <TemperatureCard
                    key={c.id}
                    contact={c}
                    variant="cold"
                    onPress={() => { void handleCardPress(c); }}
                  />
                ))}
              </ScrollView>
            </>
          )}

          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      <DossierSheet bottomSheetRef={bottomSheetRef} />
      <AddContactSheet
        bottomSheetRef={addSheetRef}
        onSaved={() => { void load(); }}
        prefill={prefill}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontSize: 15, color: '#9CA3AF', textAlign: 'center', lineHeight: 24 },
  scroll: { padding: 12, gap: 10 },
  sectionGap: { height: 4 },
  warmRow: {
    flexDirection: 'row',
    gap: 10,
  },
  warmPlaceholder: { flex: 1 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  chipRow: { gap: 8, paddingVertical: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
});
