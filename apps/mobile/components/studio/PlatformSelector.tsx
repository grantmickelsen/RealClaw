import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface Props {
  selected: string[];
  onToggle(platform: string): void;
}

const PLATFORMS = ['MLS', 'Instagram', 'Facebook', 'Email', 'SMS'];

export function PlatformSelector({ selected, onToggle }: Props) {
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {PLATFORMS.map(p => {
          const active = selected.includes(p);
          return (
            <TouchableOpacity
              key={p}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onToggle(p)}
              activeOpacity={0.7}
            >
              <Text style={[styles.label, active && styles.labelActive]}>{p}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <Text style={styles.count}>
        {selected.length} platform{selected.length !== 1 ? 's' : ''} selected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  chipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  label: { fontSize: 14, fontWeight: '500', color: '#444' },
  labelActive: { color: '#fff', fontWeight: '700' },
  count: {
    fontSize: 12,
    color: '#aaa',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
});
