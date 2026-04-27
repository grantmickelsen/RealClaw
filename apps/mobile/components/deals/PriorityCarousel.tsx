import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AlertCard } from './AlertCard';
import type { DealAlert, DealSummary } from '../../store/deals';

interface Props {
  alerts: DealAlert[];
  deals: DealSummary[];
  onDismiss(alertId: string): void;
  onAction(alert: DealAlert): void;
}

function AllClearCard() {
  return (
    <View style={styles.clearCard}>
      <Ionicons name="checkmark-circle" size={32} color="#10B981" />
      <Text style={styles.clearTitle}>All Clear</Text>
      <Text style={styles.clearSub}>No urgent deal deadlines right now.</Text>
    </View>
  );
}

export function PriorityCarousel({ alerts, deals, onDismiss, onAction }: Props) {
  const dealMap = Object.fromEntries(deals.map(d => [d.id, d]));

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>PRIORITY ACTIONS</Text>
      {alerts.length === 0 ? (
        <AllClearCard />
      ) : (
        <FlatList
          horizontal
          pagingEnabled={false}
          showsHorizontalScrollIndicator={false}
          data={alerts}
          keyExtractor={a => a.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <AlertCard
              alert={item}
              address={dealMap[item.deal_id]?.address ?? 'Unknown Property'}
              onDismiss={() => onDismiss(item.id)}
              onAction={() => onAction(item)}
            />
          )}
          ListFooterComponent={<View style={{ width: 10 }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 4 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#9CA3AF',
    letterSpacing: 0.8, paddingHorizontal: 16, marginBottom: 8,
  },
  list: { paddingLeft: 10 },
  clearCard: {
    marginHorizontal: 16, backgroundColor: '#F0FDF4',
    borderRadius: 14, borderWidth: 1, borderColor: '#BBF7D0',
    alignItems: 'center', paddingVertical: 20, paddingHorizontal: 24,
  },
  clearTitle: { fontSize: 16, fontWeight: '700', color: '#065F46', marginTop: 8 },
  clearSub: { fontSize: 13, color: '#047857', marginTop: 4, textAlign: 'center' },
});
