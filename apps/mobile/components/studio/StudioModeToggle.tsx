import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { StudioMode } from '../../store/studio';

interface Props {
  mode: StudioMode;
  onSelect(mode: StudioMode): void;
}

const OPTIONS: { value: StudioMode; label: string }[] = [
  { value: 'content', label: 'Marketing Content' },
  { value: 'staging', label: 'Virtual Staging' },
];

export function StudioModeToggle({ mode, onSelect }: Props) {
  return (
    <View style={styles.container}>
      {OPTIONS.map(opt => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.option, mode === opt.value && styles.optionActive]}
          onPress={() => onSelect(opt.value)}
          activeOpacity={0.7}
        >
          <Text style={[styles.label, mode === opt.value && styles.labelActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f5',
    borderRadius: 12,
    padding: 3,
    marginHorizontal: 16,
    marginTop: 12,
  },
  option: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 10,
  },
  optionActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  label: { fontSize: 14, fontWeight: '500', color: '#888' },
  labelActive: { color: '#0066FF', fontWeight: '700' },
});
