import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';

interface Props {
  suggestions: string[];
  loading: boolean;
  onSelect(text: string): void;
  onRegenerate(): void;
}

export function SuggestionBar({ suggestions, loading, onSelect, onRegenerate }: Props) {
  if (!loading && suggestions.length === 0) return null;

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#6366F1" />
          <Text style={styles.loadingText}>Generating suggestions…</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={styles.chip}
              onPress={() => onSelect(s)}
              activeOpacity={0.75}
            >
              <Text style={styles.chipText} numberOfLines={1}>{s}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.regenBtn} onPress={onRegenerate} activeOpacity={0.7}>
            <Text style={styles.regenText}>↻</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
    backgroundColor: '#FAFAFA', paddingVertical: 8,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  loadingText: { fontSize: 13, color: '#9CA3AF' },
  scroll: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  chip: {
    backgroundColor: '#EEF2FF', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 7,
    maxWidth: 220,
  },
  chipText: { fontSize: 13, color: '#4338CA', fontWeight: '500' },
  regenBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  regenText: { fontSize: 16, color: '#6B7280' },
});
