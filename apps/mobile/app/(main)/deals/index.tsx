import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SectionList, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, ActionSheetIOS, Platform, Modal,
  KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useDealsStore, type DealAlert, type DealSummary } from '../../../store/deals';
import { useSubscriptionStore } from '../../../store/subscription';
import { PaywallModal } from '../../../components/paywall/PaywallModal';
import { PriorityCarousel } from '../../../components/deals/PriorityCarousel';
import { DealCard } from '../../../components/deals/DealCard';

// ─── Stage grouping ───────────────────────────────────────────────────────────

const STAGE_ORDER = [
  'contingency', 'mutual_acceptance', 'offer_drafting', 'pre_offer',
  'clear_to_close', 'closed', 'cancelled',
];

const STAGE_LABELS: Record<string, string> = {
  pre_offer:         'Pre-Offer',
  offer_drafting:    'Offer Drafting',
  mutual_acceptance: 'In Escrow',
  contingency:       'Contingency',
  clear_to_close:    'Clear to Close',
  closed:            'Closed',
  cancelled:         'Cancelled',
};

function sectionizeDeal(deals: DealSummary[]): { title: string; data: DealSummary[] }[] {
  const groups: Record<string, DealSummary[]> = {};
  for (const deal of deals) {
    const key = deal.stage;
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(deal);
  }
  return STAGE_ORDER
    .filter(s => groups[s]?.length)
    .map(s => ({ title: STAGE_LABELS[s] ?? s, data: groups[s]! }));
}

// ─── Contract ingest sheet ────────────────────────────────────────────────────

function IngestSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const [text, setText] = useState('');
  const ingest      = useDealsStore(s => s.ingestContract);
  const loading     = useDealsStore(s => s.ingestLoading);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    const result = await ingest(text.trim());
    Alert.alert(result.dealId ? 'Deal Created' : 'Error', result.message, [
      { text: 'OK', onPress: () => { setText(''); onClose(); } },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <SafeAreaView style={ingestStyles.container} edges={['top', 'bottom']}>
          <View style={ingestStyles.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={ingestStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={ingestStyles.title}>New Deal</Text>
            <TouchableOpacity onPress={() => void handleSubmit()} disabled={loading || !text.trim()}>
              {loading
                ? <ActivityIndicator size="small" color="#0066FF" />
                : <Text style={[ingestStyles.done, !text.trim() && { opacity: 0.3 }]}>Create</Text>
              }
            </TouchableOpacity>
          </View>

          <Text style={ingestStyles.hint}>
            Paste the ratified contract details or type key deal terms. Include: address, price, closing date, buyer/seller names.
          </Text>
          <Text style={ingestStyles.example}>
            Example: "123 Main St, accepted 4/25, closing 6/10, $875k, 3% EMD, buyer Sarah Chen, inspection 10 days, HOA"
          </Text>

          <TextInput
            style={ingestStyles.input}
            placeholder="Paste or type contract details…"
            placeholderTextColor="#9CA3AF"
            multiline
            value={text}
            onChangeText={setText}
            autoFocus
            textAlignVertical="top"
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const ingestStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  title: { fontSize: 17, fontWeight: '600', color: '#111827' },
  cancel: { fontSize: 16, color: '#6B7280' },
  done: { fontSize: 16, fontWeight: '600', color: '#0066FF' },
  hint: { fontSize: 14, color: '#374151', marginHorizontal: 16, marginTop: 16, lineHeight: 20 },
  example: { fontSize: 12, color: '#9CA3AF', marginHorizontal: 16, marginTop: 6, fontStyle: 'italic', lineHeight: 18 },
  input: { flex: 1, margin: 16, marginTop: 12, fontSize: 15, color: '#111827', lineHeight: 22 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DealsScreen() {
  const [sheetVisible, setSheetVisible] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const isProfessional = useSubscriptionStore(s => s.isProfessional);

  function handleAddDeal() {
    if (!isProfessional) { setPaywallVisible(true); return; }
    setSheetVisible(true);
  }

  const alerts        = useDealsStore(s => s.alerts);
  const activeDeals   = useDealsStore(s => s.activeDeals);
  const loadingList   = useDealsStore(s => s.loadingList);
  const loadAlerts    = useDealsStore(s => s.loadAlerts);
  const loadDeals     = useDealsStore(s => s.loadDeals);
  const dismissAlert  = useDealsStore(s => s.dismissAlert);

  const load = useCallback(async () => {
    await Promise.all([loadAlerts(), loadDeals()]);
  }, [loadAlerts, loadDeals]);

  useEffect(() => { void load(); }, [load]);

  const handleAlertAction = useCallback((alert: DealAlert) => {
    router.push(`/(main)/deals/${alert.deal_id}` as never);
  }, []);

  const sections = sectionizeDeal(activeDeals);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Deals</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleAddDeal}
          activeOpacity={0.8}
          accessible={true}
          accessibilityLabel="Add new deal"
          accessibilityRole="button"
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {loadingList && !activeDeals.length ? (
        <ActivityIndicator style={{ marginTop: 48 }} color="#0066FF" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={d => d.id}
          refreshControl={<RefreshControl refreshing={loadingList} onRefresh={load} tintColor="#0066FF" />}
          ListHeaderComponent={
            <View style={styles.carousel}>
              <PriorityCarousel
                alerts={alerts}
                deals={activeDeals}
                onDismiss={id => void dismissAlert(id)}
                onAction={handleAlertAction}
              />
            </View>
          }
          renderItem={({ item }) => (
            <DealCard
              deal={item}
              onPress={() => router.push(`/(main)/deals/${item.id}` as never)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No Active Deals</Text>
              <Text style={styles.emptySub}>Tap + to paste a ratified contract and create your first deal.</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 120 }}
        />
      )}

      <IngestSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} />
      <PaywallModal visible={paywallVisible} onClose={() => setPaywallVisible(false)} contextTitle="Unlock Contract Ingest" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#0066FF', alignItems: 'center', justifyContent: 'center',
  },
  carousel: { paddingTop: 4, paddingBottom: 16 },
  sectionHeader: {
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
    backgroundColor: '#F9FAFB',
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.8 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#374151', marginTop: 12 },
  emptySub: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
