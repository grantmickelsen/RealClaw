import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';

const TONES = ['Standard', 'Luxury', 'Approachable', 'Investor', 'First-Time Buyer'] as const;
export type Tone = typeof TONES[number];

interface Props {
  selected: Tone;
  onSelect(tone: Tone): void;
}

export function ToneSelector({ selected, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {TONES.map(tone => (
        <Pressable
          key={tone}
          style={[styles.chip, selected === tone && styles.chipActive]}
          onPress={() => onSelect(tone)}
        >
          <Text style={[styles.chipText, selected === tone && styles.chipTextActive]}>
            {tone}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, gap: 8, paddingVertical: 2 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#f0f0f5',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  chipText: { fontSize: 14, fontWeight: '500', color: '#444' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
});
