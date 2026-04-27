import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DealSummary, DealMilestone, MilestoneStatus } from '../../store/deals';
import { formatDealPrice } from '../../lib/formatters';

interface Props {
  deal: DealSummary;
  onPress(): void;
}

// ─── Mini 5-dot train track ───────────────────────────────────────────────────

const KEY_MILESTONE_TYPES = ['earnest_money_due', 'inspection_removal', 'appraisal', 'loan_approval', 'closing'];

function milestoneColor(status: MilestoneStatus): string {
  if (status === 'complete') return '#10B981';
  if (status === 'overdue')  return '#EF4444';
  if (status === 'in_progress') return '#F59E0B';
  return '#D1D5DB';
}

function TrainTrack({ milestones }: { milestones: DealMilestone[] }) {
  const dots = KEY_MILESTONE_TYPES.map(type => {
    const m = milestones.find(x => x.milestone_type === type);
    return { type, status: m?.status ?? 'pending' as MilestoneStatus };
  });

  return (
    <View style={track.row}>
      {dots.map((dot, i) => (
        <View key={dot.type} style={track.segment}>
          {i > 0 && (
            <View style={[track.connector, { backgroundColor: dot.status === 'complete' ? '#10B981' : '#E5E7EB' }]} />
          )}
          <View style={[track.dot, { backgroundColor: milestoneColor(dot.status) }]} />
        </View>
      ))}
    </View>
  );
}

const track = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  segment: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  connector: { flex: 1, height: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});

// ─── Closing countdown ────────────────────────────────────────────────────────

function closingLabel(closingDate: string | null): string {
  if (!closingDate) return 'No closing date';
  const days = Math.ceil((new Date(closingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0)  return 'Closing overdue';
  if (days === 0) return 'Closing today';
  if (days === 1) return 'Closing tomorrow';
  return `Closes in ${days} days`;
}

function closingColor(closingDate: string | null): string {
  if (!closingDate) return '#9CA3AF';
  const days = Math.ceil((new Date(closingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0)   return '#EF4444';
  if (days <= 7)  return '#F59E0B';
  return '#10B981';
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DealCard({ deal, onPress }: Props) {
  const displayName = deal.deal_type === 'seller' ? deal.seller_name : deal.buyer_name;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      {/* Left accent */}
      <View style={styles.accent} />

      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.address} numberOfLines={1}>{deal.address}</Text>
          {deal.purchase_price && (
            <Text style={styles.price}>{formatDealPrice(deal.purchase_price)}</Text>
          )}
        </View>

        {displayName && (
          <Text style={styles.client} numberOfLines={1}>
            <Ionicons name="person-outline" size={12} color="#6B7280" /> {displayName}
          </Text>
        )}

        <View style={styles.closingRow}>
          <View style={[styles.closingDot, { backgroundColor: closingColor(deal.closing_date) }]} />
          <Text style={[styles.closingLabel, { color: closingColor(deal.closing_date) }]}>
            {closingLabel(deal.closing_date)}
          </Text>
        </View>

        {deal.milestones && deal.milestones.length > 0 && (
          <TrainTrack milestones={deal.milestones} />
        )}
      </View>

      <Ionicons name="chevron-forward" size={18} color="#D1D5DB" style={styles.chevron} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    flexDirection: 'row', alignItems: 'stretch',
    marginHorizontal: 16, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    overflow: 'hidden',
  },
  accent: { width: 4, backgroundColor: '#0066FF' },
  body: { flex: 1, padding: 14 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  address: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  price: { fontSize: 14, fontWeight: '600', color: '#0066FF' },
  client: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  closingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  closingDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  closingLabel: { fontSize: 12, fontWeight: '600' },
  chevron: { alignSelf: 'center', marginRight: 10 },
});
