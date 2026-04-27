import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity,
  ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { authedFetch } from '../../lib/api';
import { useContactsStore, type ContactCard } from '../../store/contacts';
import { useSmsStore, type SmsConversation } from '../../store/sms';
import { DossierSheet } from '../../components/contacts/DossierSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CommsRow {
  type: 'conversation' | 'contact';
  key: string;
  contactId: string | null;
  phone: string | null;
  name: string;
  stage: string | null;
  preview: string;
  timestamp: string | null;
  unreadCount: number;
  initials: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const isThisYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(isThisYear ? {} : { year: 'numeric' }) });
}

function stageColor(stage: string | null): string {
  if (!stage) return '#9CA3AF';
  const s = stage.toLowerCase();
  if (s === 'hot' || s === 'active')   return '#EF4444';
  if (s === 'warm' || s === 'nurture') return '#F59E0B';
  if (s === 'closed')                  return '#10B981';
  return '#6B7280';
}

// ─── Row component ────────────────────────────────────────────────────────────

function CommsRow({ item, onPress }: { item: CommsRow; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.initials.toUpperCase()}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, item.unreadCount > 0 && styles.rowNameBold]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.rowTime}>{formatTimestamp(item.timestamp)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.rowPreview, item.unreadCount > 0 && styles.rowPreviewBold]} numberOfLines={1}>
            {item.preview}
          </Text>
          {item.stage && (
            <View style={[styles.stagePill, { borderColor: stageColor(item.stage) }]}>
              <Text style={[styles.stageText, { color: stageColor(item.stage) }]}>{item.stage}</Text>
            </View>
          )}
          {item.unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CommsScreen() {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [query, setQuery] = useState('');

  const contacts        = useContactsStore(s => s.contacts);
  const loading         = useContactsStore(s => s.loading);
  const setContacts     = useContactsStore(s => s.setContacts);
  const setLoading      = useContactsStore(s => s.setLoading);
  const openDossier     = useContactsStore(s => s.openDossier);
  const setPendingId    = useContactsStore(s => s.setPendingDossierCorrelationId);

  const conversations   = useSmsStore(s => s.conversations);
  const setConversations = useSmsStore(s => s.setConversations);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([
        authedFetch('/v1/contacts'),
        authedFetch('/v1/sms/conversations'),
      ]);
      if (cRes.ok) {
        const d = await cRes.json() as { contacts: ContactCard[] };
        setContacts(d.contacts);
      }
      if (sRes.ok) {
        const d = await sRes.json() as { conversations: SmsConversation[] };
        setConversations(d.conversations);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [setContacts, setLoading, setConversations]);

  useEffect(() => { void load(); }, [load]);

  // ─── Merge contacts + conversations into unified sections ─────────────────

  const sections = useMemo(() => {
    const q = query.toLowerCase();

    // Conversations: contacts that have an SMS thread
    const convRows: CommsRow[] = conversations
      .filter(c => {
        const name = c.contactName ?? c.phone ?? '';
        return !q || name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q);
      })
      .sort((a, b) => (b.lastMessageAt > a.lastMessageAt ? 1 : -1))
      .map(c => ({
        type: 'conversation' as const,
        key: `conv-${c.contactId ?? c.phone}`,
        contactId: c.contactId,
        phone: c.phone,
        name: c.contactName ?? c.phone ?? 'Unknown',
        stage: contacts.find(x => x.id === c.contactId)?.stage ?? null,
        preview: c.lastMessage,
        timestamp: c.lastMessageAt,
        unreadCount: c.unreadCount,
        initials: getInitials(c.contactName ?? c.phone ?? '?'),
      }));

    // Contacts without a thread
    const convContactIds = new Set(conversations.map(c => c.contactId).filter(Boolean));
    const contactRows: CommsRow[] = contacts
      .filter(c => !convContactIds.has(c.id) && (!q || (c.name ?? '').toLowerCase().includes(q)))
      .sort((a, b) => b.temperatureScore - a.temperatureScore)
      .map(c => ({
        type: 'contact' as const,
        key: `contact-${c.id}`,
        contactId: c.id,
        phone: c.phone,
        name: c.name ?? 'Unknown',
        stage: c.stage,
        preview: c.nextAction || 'No messages yet',
        timestamp: null,
        unreadCount: 0,
        initials: getInitials(c.name ?? '?'),
      }));

    const result = [];
    if (convRows.length) result.push({ title: 'CONVERSATIONS', data: convRows });
    if (contactRows.length) result.push({ title: 'CONTACTS', data: contactRows });
    return result;
  }, [conversations, contacts, query]);

  const handlePress = useCallback((item: CommsRow) => {
    if (item.type === 'conversation' || item.phone) {
      const target = item.contactId ?? item.phone ?? '';
      router.push(`/(main)/sms/${target}` as never);
    } else if (item.contactId) {
      openDossier(item.contactId);
      bottomSheetRef.current?.snapToIndex(0);
      const correlationId = uuidv4();
      setPendingId(correlationId);
      void authedFetch('/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Generate a relationship dossier for contact ${item.contactId}`,
          correlationId,
          platform: 'mobile',
        }),
      });
    }
  }, [openDossier, setPendingId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Comms</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search contacts & messages…"
          placeholderTextColor="#9CA3AF"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={16} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading && !contacts.length && !conversations.length ? (
        <ActivityIndicator style={{ marginTop: 48 }} color="#0066FF" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.key}
          renderItem={({ item }) => (
            <CommsRow item={item} onPress={() => handlePress(item)} />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No contacts or messages yet.</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 120 }}
        />
      )}

      {/* Dossier sheet (reuse existing component) */}
      <DossierSheet bottomSheetRef={bottomSheetRef} />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, fontSize: 15, color: '#111827' },
  sectionHeader: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
    backgroundColor: '#F9FAFB',
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6',
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#0066FF', alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  rowName: { fontSize: 15, color: '#111827', flex: 1 },
  rowNameBold: { fontWeight: '700' },
  rowTime: { fontSize: 12, color: '#9CA3AF', marginLeft: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center' },
  rowPreview: { flex: 1, fontSize: 13, color: '#6B7280' },
  rowPreviewBold: { color: '#374151' },
  stagePill: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 1, marginLeft: 6,
  },
  stageText: { fontSize: 10, fontWeight: '600' },
  badge: {
    backgroundColor: '#0066FF', borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, marginLeft: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 64 },
  emptyText: { color: '#9CA3AF', fontSize: 15 },
});
