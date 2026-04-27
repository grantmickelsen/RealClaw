import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useDealsStore } from '../../../store/deals';
import { useSubscriptionStore } from '../../../store/subscription';
import { MilestoneTrack } from '../../../components/deals/MilestoneTrack';
import { ComplianceChecklist } from '../../../components/deals/ComplianceChecklist';
import { ContractXRay } from '../../../components/deals/ContractXRay';
import { FeatureLock } from '../../../components/paywall/FeatureLock';
import { PaywallModal } from '../../../components/paywall/PaywallModal';
import type { DocumentStatus } from '../../../store/deals';
import { formatDealPrice } from '../../../lib/formatters';

type Tab = 'timeline' | 'documents' | 'xray';

// ─── Segment control ──────────────────────────────────────────────────────────

function SegmentControl({ active, onChange, blockingDocCount }: {
  active: Tab;
  onChange(t: Tab): void;
  blockingDocCount: number;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'timeline',  label: 'Timeline' },
    { id: 'documents', label: 'Documents' },
    { id: 'xray',      label: 'X-Ray' },
  ];

  return (
    <View style={seg.wrap}>
      {tabs.map(tab => (
        <TouchableOpacity
          key={tab.id}
          style={[seg.tab, active === tab.id && seg.tabActive]}
          onPress={() => onChange(tab.id)}
          activeOpacity={0.7}
        >
          <Text style={[seg.label, active === tab.id && seg.labelActive]}>
            {tab.label}
          </Text>
          {tab.id === 'documents' && blockingDocCount > 0 && (
            <View style={seg.badge}>
              <Text style={seg.badgeText}>{blockingDocCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const seg = StyleSheet.create({
  wrap: {
    flexDirection: 'row', backgroundColor: '#F3F4F6',
    borderRadius: 10, padding: 3, marginHorizontal: 16, marginBottom: 12,
  },
  tab: { flex: 1, borderRadius: 8, paddingVertical: 7, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  tabActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 1 },
  label: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  labelActive: { fontWeight: '700', color: '#111827' },
  badge: { backgroundColor: '#EF4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, marginLeft: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('timeline');
  const [paywallVisible, setPaywallVisible] = useState(false);
  const isProfessional = useSubscriptionStore(s => s.isProfessional);

  const deal          = useDealsStore(s => s.dealDetail);
  const loading       = useDealsStore(s => s.loadingDetail);
  const loadDeal      = useDealsStore(s => s.loadDeal);
  const complete      = useDealsStore(s => s.completeMilestone);
  const waive         = useDealsStore(s => s.waiveMilestone);
  const updateDoc     = useDealsStore(s => s.updateDocument);

  const load = useCallback(() => {
    if (id) void loadDeal(id);
  }, [id, loadDeal]);

  useEffect(() => { load(); }, [load]);

  const blockingDocCount = deal?.documents.filter(d => d.is_blocking && d.status === 'required').length ?? 0;

  const formatPrice = (p: string | null) => {
    const s = formatDealPrice(p);
    return s ? ` · ${s}` : '';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessible={true} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color="#0066FF" />
        </TouchableOpacity>
        <View style={styles.headerMid}>
          <Text style={styles.headerAddress} numberOfLines={1}>
            {deal?.address ?? 'Loading…'}
          </Text>
          {deal && (
            <Text style={styles.headerSub}>
              {deal.deal_type === 'seller' ? 'Seller' : 'Buyer'}
              {formatPrice(deal.purchase_price)}
              {deal.closing_date ? ` · Closes ${new Date(deal.closing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
            </Text>
          )}
        </View>
      </View>

      {loading && !deal ? (
        <ActivityIndicator style={{ marginTop: 48 }} color="#0066FF" />
      ) : !deal ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>Deal not found.</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <SegmentControl active={activeTab} onChange={setActiveTab} blockingDocCount={blockingDocCount} />

          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {activeTab === 'timeline' && (
              <MilestoneTrack
                milestones={deal.milestones}
                onComplete={mid => void complete(deal.id, mid)}
                onWaive={mid => void waive(deal.id, mid)}
              />
            )}

            {activeTab === 'documents' && (
              <ComplianceChecklist
                documents={deal.documents}
                onUpdateStatus={(docId, status) => void updateDoc(deal.id, docId, status as DocumentStatus)}
              />
            )}

            {activeTab === 'xray' && (
              <FeatureLock featureLabel="Contract X-Ray" onUpgrade={() => setPaywallVisible(true)}>
                <ContractXRay deal={deal} />
              </FeatureLock>
            )}
          </ScrollView>
        </>
      )}
      <PaywallModal visible={paywallVisible} onClose={() => setPaywallVisible(false)} contextTitle="Unlock Contract X-Ray" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
    marginBottom: 8,
  },
  headerMid: { flex: 1, marginHorizontal: 10 },
  headerAddress: { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSub: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: '#6B7280' },
  backLink: { color: '#0066FF', fontSize: 16, marginTop: 8 },
});
