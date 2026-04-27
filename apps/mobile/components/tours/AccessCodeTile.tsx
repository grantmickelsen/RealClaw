import { TouchableOpacity, View, Text, StyleSheet, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  code: string;
  label?: string;
}

export function AccessCodeTile({ code, label = 'Access Code' }: Props) {
  async function handleCopy() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert(label, code, [{ text: 'OK' }]);
  }

  return (
    <TouchableOpacity style={styles.tile} onPress={handleCopy} activeOpacity={0.8}>
      <View style={styles.labelRow}>
        <Ionicons name="key-outline" size={13} color="#92400E" />
        <Text style={styles.label}>{label.toUpperCase()}</Text>
      </View>
      <Text style={styles.code} selectable>{code}</Text>
      <Text style={styles.hint}>Tap to view · Long-press code to copy</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
    letterSpacing: 0.8,
  },
  code: {
    fontSize: 28,
    fontWeight: '800',
    color: '#78350F',
    letterSpacing: 5,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    fontSize: 10,
    color: '#B45309',
    marginTop: 6,
    opacity: 0.7,
  },
});
