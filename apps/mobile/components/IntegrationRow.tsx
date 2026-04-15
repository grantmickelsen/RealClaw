import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { IntegrationStatusEntry } from '../store/integrations';

const STATUS_COLORS: Record<IntegrationStatusEntry['status'], string> = {
  connected: '#34c759',
  degraded: '#ff9500',
  disconnected: '#ff3b30',
  not_configured: '#8e8e93',
};

const STATUS_LABELS: Record<IntegrationStatusEntry['status'], string> = {
  connected: 'Connected',
  degraded: 'Degraded',
  disconnected: 'Disconnected',
  not_configured: 'Not configured',
};

interface Props {
  integration: IntegrationStatusEntry;
  onConnect: (id: string) => void;
}

export function IntegrationRow({ integration, onConnect }: Props) {
  const canConnect = integration.status === 'not_configured' || integration.status === 'disconnected';

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <Text style={styles.name}>{integration.id}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLORS[integration.status] }]} />
          <Text style={styles.status}>{STATUS_LABELS[integration.status]}</Text>
        </View>
      </View>

      {canConnect && (
        <TouchableOpacity style={styles.button} onPress={() => onConnect(integration.id)}>
          <Text style={styles.buttonText}>Connect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '500', color: '#1a1a1a', textTransform: 'capitalize' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 13, color: '#666' },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#0066FF',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
