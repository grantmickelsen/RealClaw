import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DealAlert } from '../../store/deals';

interface Props {
  alert: DealAlert;
  address: string;
  onAction(): void;
  onDismiss(): void;
}

export function AlertCard({ alert, address, onAction, onDismiss }: Props) {
  const isP0 = alert.priority === 0;

  return (
    <View style={[styles.card, isP0 ? styles.cardP0 : styles.cardP1]}>
      <View style={[styles.header, isP0 ? styles.headerP0 : styles.headerP1]}>
        <Ionicons
          name={isP0 ? 'alert-circle' : 'warning-outline'}
          size={14}
          color="#fff"
        />
        <Text style={styles.priorityLabel}>{isP0 ? 'P0 — CRITICAL' : 'P1 — URGENT'}</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={12} accessible={true} accessibilityLabel="Dismiss alert" accessibilityRole="button">
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <Text style={styles.address} numberOfLines={1}>{address}</Text>
        <Text style={styles.message}>{alert.message}</Text>
      </View>

      {alert.action_label && (
        <TouchableOpacity
          style={[styles.actionBtn, isP0 ? styles.actionBtnP0 : styles.actionBtnP1]}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text style={styles.actionLabel}>{alert.action_label}</Text>
          <Ionicons name="arrow-forward" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    overflow: 'hidden',
    width: 280,
    marginHorizontal: 6,
  },
  cardP0: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  cardP1: { backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6, gap: 6,
  },
  headerP0: { backgroundColor: '#EF4444' },
  headerP1: { backgroundColor: '#F59E0B' },
  priorityLabel: { color: '#fff', fontSize: 11, fontWeight: '700', flex: 1 },
  body: { padding: 12, paddingBottom: 8 },
  address: { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 4 },
  message: { fontSize: 13, color: '#374151', lineHeight: 18 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 12, marginBottom: 12, borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 12, gap: 6,
  },
  actionBtnP0: { backgroundColor: '#EF4444' },
  actionBtnP1: { backgroundColor: '#F59E0B' },
  actionLabel: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
