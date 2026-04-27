import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface Props {
  selected: string;
  onSelect(style: string): void;
}

const STYLES = ['Modern', 'Mid-Century', 'Coastal', 'Minimalist'];

export function StyleSelector({ selected, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {STYLES.map(s => (
        <TouchableOpacity
          key={s}
          style={[styles.chip, selected === s && styles.chipActive]}
          onPress={() => onSelect(s)}
          activeOpacity={0.7}
        >
          <Text style={[styles.label, selected === s && styles.labelActive]}>{s}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  chipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  label: { fontSize: 14, fontWeight: '500', color: '#444' },
  labelActive: { color: '#fff', fontWeight: '700' },
});
